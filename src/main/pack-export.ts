/**
 * 整合包导出：来源可以是「官方内置包」或「当前环境」。
 * 能查到云端来源的模型只写链接；没有来源的按用户策略打包或跳过。
 * 写出 zip 使用 pack-zip 的无依赖实现（限制 4GB）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, dialog } from 'electron'
import { paths, installedVersion } from './settings'
import { t } from './i18n'
import { comfy } from './process'
import { createZip, walkFiles } from './pack-zip'
import { listNodes } from './nodes'
import { scanModels } from './models'
import { builtinPackDir, hasBuiltinPack, resolveModelSources, sourceLabel } from './pack-catalog'
import { scanWorkflowFiles } from './pack'
import {
  effectiveComponents,
  validatePackManifest,
  type PackComponent,
  type PackComponentSummary,
  type PackExportCandidate,
  type PackExportRequest,
  type PackExportResult,
  type PackManifest,
  type PackModel,
  type PackModelSource,
  type PackProgressEvent,
  type PackWorkflow
} from '../shared/pack'

type Progress = (e: PackProgressEvent) => void

function readManifest(root: string): PackManifest {
  const file = path.join(root, 'comfyui-pack.json')
  if (!fs.existsSync(file)) throw new Error(t('m.pack.errMissingManifest'))
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as PackManifest
  return raw
}

function copyFileOrDir(src: string, dest: string): void {
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.isSymbolicLink() || e.name === '__pycache__' || e.name === '.git') continue
      copyFileOrDir(path.join(src, e.name), path.join(dest, e.name))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function modelKey(m: { category: string; filename: string }): string {
  return `${m.category}/${m.filename}`
}

function summarize(manifest: PackManifest): PackComponentSummary[] {
  return effectiveComponents(manifest).map(c => {
    const models = c.models || []
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      defaultSelected: c.defaultSelected !== false,
      nodeCount: (c.nodes || []).length,
      modelCount: models.length,
      workflowCount: (c.workflows || []).length,
      downloadBytes: models.reduce((n, m) => n + (m.size || 0), 0),
      missingModels: 0,
      blocked: Boolean(c.blockedReason),
      blockReason: c.blockedReason
    }
  })
}

function baseSources(md: PackModel): PackModelSource[] {
  return md.sources && md.sources.length ? md.sources : resolveModelSources(md.filename, md.category)
}

function modelLine(md: PackModel): PackExportCandidate['models'][number] {
  const sources = baseSources(md)
  const src = sources.find(s => s.type !== 'manual')
  return {
    filename: md.filename,
    category: md.category,
    size: md.size || 0,
    hasLink: Boolean(src),
    sourceLabel: src ? sourceLabel(src) : sourceLabel({ type: 'manual' })
  }
}

/** 导出前的候选项：组件与模型列表（只读） */
export async function previewExport(source: 'builtin' | 'current', builtinId = 'infinite-canvas'): Promise<PackExportCandidate> {
  if (source === 'builtin') {
    if (!hasBuiltinPack(builtinId)) throw new Error(t('m.pack.errNoManifestFile', { id: builtinId }))
    const manifest = readManifest(builtinPackDir(builtinId))
    const models = new Map<string, PackExportCandidate['models'][number]>()
    for (const c of effectiveComponents(manifest)) {
      for (const md of c.models || []) if (!models.has(modelKey(md))) models.set(modelKey(md), modelLine(md))
    }
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      components: summarize(manifest),
      models: [...models.values()]
    }
  }

  // 当前环境
  const mroot = paths().models
  const nodes = await listNodes()
  const models: PackExportCandidate['models'][number][] = []
  for (const cat of scanModels()) {
    for (const f of cat.files) {
      const rel = path.relative(mroot, f.relPath).split(path.sep).join('/')
      const dir = path.posix.dirname(rel)
      const category = dir === '.' ? cat.name : dir
      const md: PackModel = { filename: f.name, category, size: f.size, sources: [] }
      models.push(modelLine(md))
    }
  }
  const wfs = scanWorkflowFiles()
  const comp: PackComponentSummary = {
    id: 'current',
    name: '当前环境',
    description: '从本机 ComfyUI 采集',
    defaultSelected: true,
    nodeCount: nodes.length,
    modelCount: models.length,
    workflowCount: wfs.length,
    downloadBytes: models.reduce((n, m) => n + m.size, 0),
    missingModels: models.filter(m => !m.hasLink).length,
    blocked: false
  }
  return {
    id: 'current',
    name: '当前环境整合包',
    version: '1.0.0',
    description: '由本机 ComfyUI 环境导出',
    components: [comp],
    models
  }
}

interface Staging {
  root: string
  addFile(rel: string, abs: string): void
  addBuffer(rel: string, data: string | Buffer): void
  cleanup(): void
}

function openStaging(): Staging {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-pack-export-'))
  return {
    root,
    addFile(rel, abs) {
      const dest = path.join(root, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(abs, dest)
    },
    addBuffer(rel, data) {
      const dest = path.join(root, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, data)
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

interface ExportContext {
  manifest: PackManifest
  staging: Staging
  modelsRoot: string
  /** 官方包源目录：复制包内已有 bundle 文件时用 */
  srcPackRoot?: string
  bundled: number
  missingLinks: string[]
  modelCount: number
}

/** 按策略处理模型：link 保留云端来源；bundle 复制文件；skip 直接移除 */
function applyModelStrategy(
  md: PackModel,
  strategy: 'link' | 'bundle' | 'skip',
  ctx: ExportContext,
  componentId: string
): PackModel | null {
  if (strategy === 'skip') return null
  const sources = baseSources(md)
  const cloud = sources.filter(s => s.type !== 'manual')
  if (strategy === 'link') {
    if (!cloud.length) {
      ctx.missingLinks.push(md.filename)
      return null
    }
    ctx.modelCount++
    return { ...md, sources: [...cloud, { type: 'manual' }] }
  }
  // bundle：优先用本机已有文件；官方包里本身带 bundle 的则沿用
  const idx = findModel(md.filename, ctx.modelsRoot)
  let bundledSource: PackModelSource | null = null
  if (idx) {
    if (fs.statSync(idx).size > 2 * 1024 * 1024 * 1024) throw new Error(t('m.pack.errExportTooLarge'))
    const rel = `payload/models/${componentId}/${md.filename}`
    ctx.staging.addFile(rel, idx)
    bundledSource = { type: 'bundle', path: rel }
  } else {
    const existing = (md.sources || []).find(s => s.type === 'bundle')
    if (!existing || !ctx.srcPackRoot) {
      ctx.missingLinks.push(md.filename)
      return null
    }
    const from = path.join(ctx.srcPackRoot, existing.path)
    if (!fs.existsSync(from)) {
      ctx.missingLinks.push(md.filename)
      return null
    }
    ctx.staging.addFile(existing.path, from)
    bundledSource = existing
  }
  ctx.bundled++
  ctx.modelCount++
  return { ...md, sources: [bundledSource] }
}

function findModel(filename: string, root: string): string | null {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && e.name === filename) return p
    }
  }
  return null
}

function writeManifest(ctx: ExportContext): void {
  ctx.staging.addBuffer('comfyui-pack.json', JSON.stringify(ctx.manifest, null, 2) + '\n')
  const lines = [
    `# ${ctx.manifest.name}`,
    '',
    `- id: ${ctx.manifest.id}`,
    `- version: ${ctx.manifest.version}`,
    `- createdAt: ${ctx.manifest.createdAt}`,
    '',
    '## 组件',
    ...effectiveComponents(ctx.manifest).map(c => `- ${c.id}: ${c.name}`),
    '',
    '## 说明',
    '大模型默认只写云端链接，导入时由 ComfyUI Desk 下载。'
  ]
  ctx.staging.addBuffer('README.md', lines.join('\n') + '\n')
}

export async function exportPack(req: PackExportRequest, onProgress: Progress): Promise<PackExportResult> {
  const comps = req.components || []
  if (!comps.length) throw new Error(t('m.pack.errExportEmpty'))
  let outPath = req.outPath || ''
  if (!outPath) {
    const r = await dialog.showSaveDialog({
      defaultPath: path.join(
        app.getPath('downloads'),
        `${req.source === 'builtin' ? req.builtinId || 'infinite-canvas' : 'current-env'}-pack.zip`
      ),
      filters: [{ name: 'zip', extensions: ['zip'] }]
    })
    if (r.canceled || !r.filePath) throw new Error(t('m.pack.errExportEmpty'))
    outPath = r.filePath
  }
  const staging = openStaging()
  const p = paths()
  const ctx: ExportContext = {
    manifest: null as unknown as PackManifest,
    staging,
    modelsRoot: p.models,
    bundled: 0,
    missingLinks: [],
    modelCount: 0
  }
  try {
    onProgress({ kind: 'stage', stage: 'prepare', message: '准备导出', percent: 2 })
    if (req.source === 'builtin') {
      const id = req.builtinId || 'infinite-canvas'
      if (!hasBuiltinPack(id)) throw new Error(t('m.pack.errNoManifestFile', { id }))
      const srcRoot = builtinPackDir(id)
      ctx.srcPackRoot = srcRoot
      const srcManifest = readManifest(srcRoot)
      const compsAll = effectiveComponents(srcManifest)
      const selected = compsAll.filter(c => comps.includes(c.id))
      if (!selected.length) throw new Error(t('m.pack.errExportEmpty'))
      const outComponents: PackComponent[] = []
      let i = 0
      for (const c of selected) {
        const models: PackModel[] = []
        for (const md of c.models || []) {
          const strategy = req.modelStrategies?.[modelKey(md)] || (baseSources(md).some(s => s.type !== 'manual') ? 'link' : 'skip')
          const next = applyModelStrategy(md, strategy, ctx, c.id)
          if (next) models.push(next)
        }
        const workflows: PackWorkflow[] = []
        for (const w of c.workflows || []) {
          if (w.format === 'ui' && !req.includeUiWorkflows) continue
          const src = path.join(srcRoot, w.file)
          if (!fs.existsSync(src)) continue
          const rel = `payload/workflows/${c.id}/${path.basename(w.file)}`
          staging.addFile(rel, src)
          workflows.push({ ...w, file: rel })
        }
        // 包内节点（无 git 来源）原样复制
        for (const n of c.nodes || []) {
          if (n.source.type !== 'bundle') continue
          const src = path.join(srcRoot, n.source.path)
          if (!fs.existsSync(src)) continue
          copyFileOrDir(src, path.join(staging.root, n.source.path))
        }
        // 包内资源
        for (const a of c.assets || []) {
          const src = path.join(srcRoot, a.path)
          if (!fs.existsSync(src)) continue
          copyFileOrDir(src, path.join(staging.root, a.path))
        }
        outComponents.push({ ...c, models, workflows })
        onProgress({ kind: 'stage', stage: 'workflows', message: `打包组件 ${c.name}`, percent: 5 + Math.round((i++ / selected.length) * 60) })
      }
      ctx.manifest = { ...srcManifest, components: outComponents }
    } else {
      // 当前环境：单组件
      const nodes = await listNodes()
      const outNodes = []
      for (const n of nodes) {
        if (n.git && n.remote && /^(https?:\/\/|git@)/.test(n.remote)) {
          outNodes.push({ key: n.name, name: n.name, source: { type: 'git', url: n.remote } as const, requirements: true, installPy: true })
        } else {
          const rel = `payload/custom_nodes/${n.name}`
          copyFileOrDir(n.path, path.join(staging.root, rel))
          outNodes.push({ key: n.name, name: n.name, source: { type: 'bundle', path: rel } as const, requirements: true })
          ctx.bundled++
        }
      }
      const models: PackModel[] = []
      const seen = new Set<string>()
      for (const cat of scanModels()) {
        for (const f of cat.files) {
          if (seen.has(f.name)) continue
          seen.add(f.name)
          const rel = path.relative(p.models, f.relPath).split(path.sep).join('/')
          const category = path.posix.dirname(rel) === '.' ? cat.name : path.posix.dirname(rel)
          const md: PackModel = { filename: f.name, category, size: f.size, sources: [] }
          const strategy = req.modelStrategies?.[modelKey(md)] || 'link'
          const next = applyModelStrategy(md, strategy, ctx, 'current')
          if (next) models.push(next)
        }
      }
      const workflows: PackWorkflow[] = []
      for (const wf of scanWorkflowFiles()) {
        let format: 'api' | 'ui' | 'unknown' = wf.format
        if (format === 'ui' && !req.includeUiWorkflows) continue
        if (format === 'unknown') format = 'api'
        const rel = `payload/workflows/current/${path.basename(wf.abs)}`
        staging.addFile(rel, wf.abs)
        workflows.push({ name: path.basename(wf.abs, '.json'), format, file: rel })
      }
      ctx.manifest = {
        schema: 'comfyui-desk/pack@1',
        id: 'current-env',
        name: '当前环境整合包',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        author: 'ComfyUI Desk',
        description: '由本机 ComfyUI 环境导出',
        requirements: {
          comfyui: { min: installedVersion() || undefined },
          diskFreeGB: Math.ceil((models.reduce((n, m) => n + (m.size || 0), 0) + 100 * 1024 * 1024) / 1073741824)
        },
        components: [{ id: 'current', name: '当前环境', defaultSelected: true, nodes: outNodes, models, workflows }]
      }
      onProgress({ kind: 'stage', stage: 'workflows', message: '写入工作流', percent: 60 })
    }

    writeManifest(ctx)
    const v = validatePackManifest(ctx.manifest)
    if (v.errors.length) throw new Error(t('m.pack.errInvalidManifest', { detail: v.errors.join('; ') }))
    onProgress({ kind: 'stage', stage: 'done', message: '写入 zip', percent: 70 })
    const files = walkFiles(staging.root)
    const total = files.reduce((n, f) => n + f.size, 0)
    if (total > 4 * 1024 * 1024 * 1024) throw new Error(t('m.pack.errExportTooLarge'))
    await createZip(files.map(f => ({ name: f.rel, file: f.abs })), outPath)
    const size = fs.statSync(outPath).size
    onProgress({ kind: 'stage', stage: 'done', message: '导出完成', percent: 100 })
    comfy.pushLog('sys', t('m.pack.logDone', { ok: String(ctx.modelCount), skip: '0', fail: String(ctx.missingLinks.length) }))
    return {
      outPath,
      size,
      modelCount: ctx.modelCount,
      bundledCount: ctx.bundled,
      missingLinks: [...new Set(ctx.missingLinks)]
    }
  } catch (e) {
    if ((e as Error).message.includes('解压后体积超出上限') || (e as Error).message.includes('超出上限')) {
      throw new Error(t('m.pack.errExportTooLarge'))
    }
    throw new Error(t('m.pack.errExportWrite', { detail: (e as Error).message || String(e) }))
  } finally {
    staging.cleanup()
  }
}

export { findModel }
