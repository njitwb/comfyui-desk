/**
 * 整合包导入引擎：预检（只读）→ 执行（节点 / 资源 / pip / 模型 / 工作流）。
 * 复用现有能力：git clone（nodes.ts）、pip（python.ts）、模型下载管理器（downloads.ts）、
 * 在线模型搜索（models.ts）。所有写入都限制在 custom_nodes / workflows / models 根下。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { paths, loadSettings, isInstalled, installedVersion, PIP_MIRRORS } from './settings'
import { compareSemver, run } from './util'
import { t } from './i18n'
import { comfy } from './process'
import { pip } from './python'
import {
  type CancelToken,
  cancelToken,
  createToken,
  installDeps,
  installNodeAtRef,
  installNodeFromBundle,
  nodeDirExists
} from './nodes'
import { startDownload, listDownloads, cancelDownload } from './downloads'
import { hfResolveUrl, msResolveUrl, searchOnlineModels, listOnlineModelFiles } from './models'
import { extractZip } from './pack-zip'
import {
  builtinPackDir,
  hasBuiltinPack,
  resolveModelSources,
  sourceLabel
} from './pack-catalog'
import {
  effectiveComponents,
  isSafeRelPath,
  isSafeTargetPath,
  validatePackManifest,
  type PackApplyRequest,
  type PackApplyResult,
  type PackComponent,
  type PackComponentSummary,
  type PackEnvState,
  type PackInspectResult,
  type PackItemState,
  type PackItemStatus,
  type PackManifest,
  type PackModel,
  type PackModelSource,
  type PackNode,
  type PackProgressEvent,
  type PackRecord
} from '../shared/pack'

const BUILTIN_PREFIX = 'builtin:'

interface ResolvedPack {
  root: string
  /** 包文件/目录体积（字节） */
  size: number
  builtin: boolean
  cleanup: () => void
}

function dirSize(root: string): number {
  let total = 0
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          total += fs.statSync(p).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  try {
    walk(root)
  } catch {
    /* ignore */
  }
  return total
}

export function isBuiltinRef(ref: string): boolean {
  return ref.startsWith(BUILTIN_PREFIX)
}

/** 把 builtin:xxx 或 zip 路径解析成可读的包根目录 */
async function resolvePack(ref: string): Promise<ResolvedPack> {
  if (isBuiltinRef(ref)) {
    const id = ref.slice(BUILTIN_PREFIX.length) || 'infinite-canvas'
    if (!hasBuiltinPack(id)) throw new Error(t('m.pack.errNoManifestFile', { id }))
    const root = builtinPackDir(id)
    comfy.pushLog('sys', t('m.pack.logFoundBuiltin', { id }))
    return { root, size: dirSize(root), builtin: true, cleanup: () => {} }
  }
  const stat = fs.statSync(ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-pack-'))
  try {
    await extractZip(ref, temp)
  } catch (e) {
    fs.rmSync(temp, { recursive: true, force: true })
    throw e
  }
  return {
    root: temp,
    size: stat.size,
    builtin: false,
    cleanup: () => fs.rmSync(temp, { recursive: true, force: true })
  }
}

function readManifest(root: string): PackManifest {
  const file = path.join(root, 'comfyui-pack.json')
  if (!fs.existsSync(file)) throw new Error(t('m.pack.errMissingManifest'))
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    throw new Error(t('m.pack.errInvalidManifest', { detail: (e as Error).message }))
  }
  const v = validatePackManifest(raw)
  if (v.errors.length) throw new Error(t('m.pack.errInvalidManifest', { detail: v.errors.join('; ') }))
  return raw as PackManifest
}

/** 安全解析包内相对路径 */
function underPack(root: string, rel: string): string {
  if (!isSafeRelPath(rel)) throw new Error(t('m.pack.errTargetUnsafe', { target: rel }))
  const full = path.resolve(root, rel)
  const base = path.resolve(root)
  if (!full.startsWith(base + path.sep)) throw new Error(t('m.pack.errTargetUnsafe', { target: rel }))
  return full
}

/** 安全解析目标路径（custom_nodes / workflows / models 根） */
function underBase(base: string, rel: string): string {
  if (!isSafeTargetPath(rel)) throw new Error(t('m.pack.errTargetUnsafe', { target: rel }))
  const full = path.resolve(base, rel)
  const root = path.resolve(base)
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(t('m.pack.errTargetUnsafe', { target: rel }))
  return full
}

/** 建立 models 根下「文件名 → 实际路径/大小」索引 */
function indexModels(root: string): Map<string, { path: string; size: number }> {
  const out = new Map<string, { path: string; size: number }>()
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.isFile() && !out.has(e.name)) {
        try {
          out.set(e.name, { path: p, size: fs.statSync(p).size })
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(root, 0)
  return out
}

function workflowTarget(packId: string, componentId: string, workflowFile: string, target?: string): string {
  const base = paths().workflows
  if (target) return underBase(base, target)
  return underBase(base, `${packId}/${componentId}/${path.basename(workflowFile)}`)
}

function itemIdOf(kind: string, key: string): string {
  return `${kind}:${key}`
}

function firstSource(md: PackModel): PackModelSource | undefined {
  return md.sources.find(s => s.type !== 'manual') || md.sources[0]
}

/** 合并清单自带来源与 catalog 兜底，去重并把 manual 放到最后 */
function effectiveSources(md: PackModel): PackModelSource[] {
  const all: PackModelSource[] = []
  const push = (s: PackModelSource): void => {
    if (!all.some(x => JSON.stringify(x) === JSON.stringify(s))) all.push(s)
  }
  for (const s of md.sources) push(s)
  for (const s of resolveModelSources(md.filename, md.category)) push(s)
  return [...all.filter(s => s.type !== 'manual'), ...all.filter(s => s.type === 'manual').slice(0, 1)]
}

async function pythonVersion(): Promise<string> {
  const p = paths()
  if (!fs.existsSync(p.venvPython)) return ''
  try {
    const r = await run(p.venvPython, ['-V'], { timeoutMs: 15000 })
    return (r.out + r.err).trim()
  } catch {
    return ''
  }
}

function diskFree(root: string): number {
  try {
    const st = fs.statfsSync(root)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return 0
  }
}

/** 读取 ComfyUI 工作流目录（导出「当前环境」时用） */
export function scanWorkflowFiles(): Array<{ rel: string; abs: string; format: 'api' | 'ui' | 'unknown' }> {
  const root = paths().workflows
  const out: Array<{ rel: string; abs: string; format: 'api' | 'ui' | 'unknown' }> = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      if (!e.name.toLowerCase().endsWith('.json')) continue
      let format: 'api' | 'ui' | 'unknown' = 'unknown'
      try {
        const d = JSON.parse(fs.readFileSync(abs, 'utf-8'))
        if (Array.isArray((d as { nodes?: unknown }).nodes)) format = 'ui'
        else if (Object.values(d as Record<string, unknown>).some(v => v && typeof v === 'object' && typeof (v as Record<string, unknown>).class_type === 'string')) format = 'api'
      } catch {
        /* ignore */
      }
      out.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs, format })
    }
  }
  walk(root, 0)
  return out
}

// ---- 预检 ----

export async function inspectPack(ref: string): Promise<PackInspectResult> {
  const pack = await resolvePack(ref)
  try {
    const manifest = readManifest(pack.root)
    const v = validatePackManifest(manifest)
    const warnings = [...v.warnings]
    const p = paths()
    const mt = indexModels(p.models)
    const env: PackEnvState = {
      comfyInstalled: isInstalled(),
      comfyVersion: installedVersion(),
      versionOk: true,
      venvOk: fs.existsSync(p.venvPython),
      pythonVersion: await pythonVersion(),
      modelsRoot: p.models,
      diskFreeBytes: diskFree(p.root)
    }
    const min = manifest.requirements?.comfyui?.min
    if (env.comfyInstalled && min) env.versionOk = compareSemver(env.comfyVersion, min) >= 0
    if (!env.comfyInstalled) warnings.push(t('m.pack.errNotInstalled'))
    if (!env.venvOk) warnings.push(t('m.pack.errNoVenv'))
    if (env.comfyInstalled && min && !env.versionOk) {
      warnings.push(`ComfyUI ${env.comfyVersion} < ${min}，建议先升级（仍可继续导入）`)
    }
    const need = (manifest.requirements?.diskFreeGB || 0) * 1073741824
    if (need && env.diskFreeBytes && env.diskFreeBytes < need) {
      warnings.push(`磁盘剩余 ${(env.diskFreeBytes / 1073741824).toFixed(1)}GB，低于建议的 ${manifest.requirements?.diskFreeGB}GB`)
    }

    const items: PackItemState[] = []
    const components: PackComponentSummary[] = []
    const comps = effectiveComponents(manifest)

    for (const c of comps) {
      let downloadBytes = 0
      let missingModels = 0
      for (const n of c.nodes || []) {
        const target = path.join(p.customNodes, n.key)
        const exists = nodeDirExists(n.key)
        const status: PackItemStatus = exists ? 'ok' : 'missing'
        items.push({
          id: itemIdOf('node', n.key),
          kind: 'node',
          componentId: c.id,
          name: n.name || n.key,
          target,
          status,
          message: exists ? '目录已存在' : n.optional ? '可选，未安装' : undefined
        })
      }
      for (const md of c.models || []) {
        const target = path.join(p.models, md.category, md.filename)
        const hit = mt.get(md.filename)
        let status: PackItemStatus
        let message: string | undefined
        if (hit) {
          status = 'ok'
          if (md.size && Math.abs(hit.size - md.size) > Math.max(1048576, md.size * 0.01)) {
            status = 'mismatch'
            message = `已有文件大小 ${(hit.size / 1048576).toFixed(1)}MB，清单为 ${(md.size / 1048576).toFixed(1)}MB`
          } else {
            message = hit.path
          }
        } else if (md.sources.every(s => s.type === 'manual')) {
          status = 'manual'
        } else {
          status = 'missing'
        }
        if (!hit) {
          missingModels++
          downloadBytes += md.size || 0
        }
        const src = firstSource(md)
        items.push({
          id: itemIdOf('model', `${md.category}/${md.filename}`),
          kind: 'model',
          componentId: c.id,
          name: md.filename,
          target,
          status,
          message,
          size: md.size,
          sourceLabel: src ? sourceLabel(src) : undefined
        })
      }
      for (const w of c.workflows || []) {
        const target = workflowTarget(manifest.id, c.id, w.file, w.target)
        const exists = fs.existsSync(target)
        items.push({
          id: itemIdOf('workflow', w.file),
          kind: 'workflow',
          componentId: c.id,
          name: w.name,
          target,
          status: exists ? 'ok' : 'missing',
          message: exists ? '已存在' : undefined
        })
      }
      for (const a of c.assets || []) {
        const base = a.root === 'models' ? p.models : p.comfy
        const target = underBase(base, a.target)
        const exists = fs.existsSync(target)
        items.push({
          id: itemIdOf('asset', a.path),
          kind: 'asset',
          componentId: c.id,
          name: a.path,
          target,
          status: exists ? 'ok' : 'missing'
        })
      }
      components.push({
        id: c.id,
        name: c.name,
        description: c.description,
        defaultSelected: c.defaultSelected !== false,
        nodeCount: (c.nodes || []).length,
        modelCount: (c.models || []).length,
        workflowCount: (c.workflows || []).length,
        downloadBytes,
        missingModels,
        blocked: Boolean(c.blockedReason),
        blockReason: c.blockedReason
      })
    }

    return { zipPath: ref, packSize: pack.size, manifest, components, env, items, warnings }
  } finally {
    pack.cleanup()
  }
}

// ---- 执行 ----

interface ActiveJob {
  cancelled: boolean
  token: CancelToken
  downloads: Set<string>
}

let activeJob: ActiveJob | null = null

export function cancelPack(): void {
  if (!activeJob) return
  activeJob.cancelled = true
  cancelToken(activeJob.token)
  for (const dest of activeJob.downloads) {
    const task = listDownloads().find(x => x.dest === dest)
    if (task && task.status === 'downloading') cancelDownload(task.id)
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(file)
    s.on('data', d => h.update(d as Buffer))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

async function waitForDownload(dest: string, job: ActiveJob, onTick: (received: number, total: number) => void): Promise<void> {
  for (;;) {
    if (job.cancelled) throw new Error(t('m.nodes.cancelled'))
    const task = listDownloads().find(x => x.dest === dest)
    if (!task) {
      if (fs.existsSync(dest)) return
      throw new Error(t('m.pack.errModelDownload', { name: path.basename(dest), detail: 'task disappeared' }))
    }
    if (task.status === 'completed') return
    if (task.status === 'error') throw new Error(t('m.pack.errModelDownload', { name: task.filename, detail: task.error || 'error' }))
    onTick(task.received, task.total)
    await sleep(500)
  }
}

/** 用现有在线搜索按文件名回校验：只接受 basename 完全一致的仓库文件 */
async function resolveBySearch(filename: string, query: string, source: 'hf' | 'ms'): Promise<string | null> {
  const mirror = loadSettings().hfMirror
  const r = await searchOnlineModels(source, query, mirror)
  for (const m of r.models.slice(0, 5)) {
    try {
      const files = await listOnlineModelFiles(m.source, m.id, m.revision, mirror)
      const hit = files.find(f => path.basename(f.name) === filename)
      if (hit) return hit.url
    } catch {
      /* 单个仓库失败不影响后续 */
    }
  }
  return null
}

function copyFileOrDir(src: string, dest: string): void {
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.isSymbolicLink() || e.name === '__pycache__') continue
      copyFileOrDir(path.join(src, e.name), path.join(dest, e.name))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function loadRecords(): PackRecord[] {
  const file = path.join(app.getPath('userData'), 'packs.json')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(raw) ? (raw as PackRecord[]) : []
  } catch {
    return []
  }
}

export function listInstalledPacks(): PackRecord[] {
  return loadRecords().sort((a, b) => (b.installedAt || '').localeCompare(a.installedAt || ''))
}

function recordInstalled(rec: PackRecord): void {
  const file = path.join(app.getPath('userData'), 'packs.json')
  const list = loadRecords().filter(r => r.id !== rec.id)
  list.push(rec)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf-8')
}

interface ItemProgress {
  (e: PackProgressEvent): void
}

function stagePercent(stage: string, ratio = 0): number {
  const base: Record<string, [number, number]> = {
    prepare: [0, 5],
    nodes: [5, 45],
    assets: [45, 50],
    pip: [50, 55],
    models: [55, 90],
    workflows: [90, 99],
    done: [99, 100]
  }
  const [lo, hi] = base[stage] || [0, 100]
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, ratio)))
}

export async function applyPack(req: PackApplyRequest, onProgress: ItemProgress): Promise<PackApplyResult> {
  if (activeJob) throw new Error('另一个整合包任务正在进行')
  const job: ActiveJob = { cancelled: false, token: createToken(), downloads: new Set() }
  activeJob = job
  const result: PackApplyResult = { ok: false, cancelled: false, installed: [], skipped: [], failed: [], manual: [], restartRequired: false }
  let pack: ResolvedPack | null = null
  type PackStageName = 'prepare' | 'nodes' | 'assets' | 'pip' | 'models' | 'workflows' | 'done'
  let stage: PackStageName = 'prepare'
  try {
    pack = await resolvePack(req.zipPath)
    const packRoot = pack.root
    const manifest = readManifest(packRoot)
    const p = paths()
    const emitStage = (name: PackStageName, message: string, ratio = 0): void => {
      stage = name
      onProgress({ kind: 'stage', stage: name, message, percent: stagePercent(name, ratio) })
    }
    const emitItem = (item: PackItemState, percent?: number): void => onProgress({ kind: 'item', item, percent })
    const log = (message: string): void => {
      comfy.pushLog('sys', message)
      onProgress({ kind: 'log', message })
    }

    emitStage('prepare', '检查环境', 0)
    if (!isInstalled()) throw new Error(t('m.pack.errNotInstalled'))
    if (!fs.existsSync(p.venvPython)) throw new Error(t('m.pack.errNoVenv'))

    const comps = effectiveComponents(manifest).filter(c => req.components.includes(c.id) && !c.blockedReason)
    if (!comps.length) throw new Error(t('m.pack.errExportEmpty'))

    // 去重：同一节点/模型在多个组件里只处理一次
    const nodeMap = new Map<string, { node: PackNode; componentId: string }>()
    const modelMap = new Map<string, { model: PackModel; componentId: string }>()
    const assetMap = new Map<string, { asset: NonNullable<PackComponent['assets']>[number]; componentId: string }>()
    const workflowMap = new Map<string, { wf: NonNullable<PackComponent['workflows']>[number]; componentId: string }>()
    for (const c of comps) {
      for (const n of c.nodes || []) if (!nodeMap.has(n.key)) nodeMap.set(n.key, { node: n, componentId: c.id })
      for (const m of c.models || []) {
        const key = `${m.category}/${m.filename}`
        if (!modelMap.has(key)) modelMap.set(key, { model: m, componentId: c.id })
      }
      for (const a of c.assets || []) if (!assetMap.has(a.target)) assetMap.set(a.target, { asset: a, componentId: c.id })
      for (const w of c.workflows || []) if (!workflowMap.has(w.file)) workflowMap.set(w.file, { wf: w, componentId: c.id })
    }

    // ---- 节点 ----
    emitStage('nodes', '安装自定义节点', 0)
    const nodeList = [...nodeMap.values()]
    for (let i = 0; i < nodeList.length; i++) {
      if (job.cancelled) break
      const { node } = nodeList[i]
      const target = path.join(p.customNodes, node.key)
      const baseItem: PackItemState = {
        id: itemIdOf('node', node.key),
        kind: 'node',
        componentId: nodeMap.get(node.key)!.componentId,
        name: node.name || node.key,
        target,
        status: 'missing'
      }
      if (nodeDirExists(node.key)) {
        result.skipped.push(node.key)
        log(t('m.pack.logSkipNode', { name: node.key }))
        emitItem({ ...baseItem, status: 'ok', message: '目录已存在' })
        continue
      }
      emitItem({ ...baseItem, status: 'missing', message: '安装中…' }, stagePercent('nodes', i / Math.max(1, nodeList.length)))
      log(t('m.pack.logInstallNode', { name: node.key }))
      try {
        const src = node.source
        if (src.type === 'git') {
          await installNodeAtRef(node.key, src, log, job.token)
        } else if (src.type === 'bundle') {
          await installNodeFromBundle(node.key, underPack(packRoot, src.path), log, job.token)
        } else {
          const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-node-'))
          try {
            await extractZip(underPack(packRoot, src.path), tmp)
            const entries = fs.readdirSync(tmp)
            const single = entries.length === 1 && fs.statSync(path.join(tmp, entries[0])).isDirectory()
            const from = single ? path.join(tmp, entries[0]) : tmp
            fs.mkdirSync(target, { recursive: true })
            copyFileOrDir(from, target)
          } finally {
            fs.rmSync(tmp, { recursive: true, force: true })
          }
          await installDeps(target, log, job.token)
        }
        result.installed.push(node.key)
        result.restartRequired = true
        emitItem({ ...baseItem, status: 'ok', message: '已安装' })
      } catch (e) {
        if (job.cancelled) break
        const msg = (e as Error).message || String(e)
        result.failed.push({ name: node.key, error: msg })
        emitItem({ ...baseItem, status: 'unknown', message: msg })
      }
      emitItem({ ...baseItem, status: job.cancelled ? 'unknown' : 'ok' }, stagePercent('nodes', (i + 1) / Math.max(1, nodeList.length)))
    }

    if (job.cancelled) return finishCancelled()

    // ---- 资源 ----
    emitStage('assets', '拷贝包内资源', 0)
    const assetList = [...assetMap.values()]
    for (let i = 0; i < assetList.length; i++) {
      if (job.cancelled) break
      const { asset, componentId } = assetList[i]
      const base = asset.root === 'models' ? p.models : p.comfy
      const target = underBase(base, asset.target)
      const item: PackItemState = {
        id: itemIdOf('asset', asset.path),
        kind: 'asset',
        componentId,
        name: asset.path,
        target,
        status: 'missing'
      }
      try {
        copyFileOrDir(underPack(packRoot, asset.path), target)
        emitItem({ ...item, status: 'ok' })
        if (asset.root === 'comfy' && target.startsWith(p.customNodes)) result.restartRequired = true
      } catch (e) {
        result.failed.push({ name: asset.path, error: (e as Error).message })
        emitItem({ ...item, status: 'unknown', message: (e as Error).message })
      }
    }

    // ---- pip ----
    emitStage('pip', '安装额外 Python 依赖', 0)
    const specs: Array<{ spec: string; optional?: boolean; platforms?: string[] }> = []
    for (const c of comps) for (const e of c.pip || []) specs.push(e)
    const wheels = path.join(packRoot, 'payload', 'wheels')
    if (specs.length) {
      const applicable = specs.filter(s => !s.platforms || s.platforms.includes(process.platform))
      const reqFile = path.join(os.tmpdir(), `comfyui-pack-pip-${Date.now()}.txt`)
      fs.writeFileSync(reqFile, applicable.map(s => s.spec).join('\n'), 'utf-8')
      try {
        const mirror = PIP_MIRRORS[loadSettings().pipMirror]
        const r = await pip(['install', '-r', reqFile, ...(mirror ? ['-i', mirror] : []), ...(fs.existsSync(wheels) ? ['-f', wheels] : [])], {
          onData: log,
          timeoutMs: 30 * 60 * 1000,
          onSpawn: k => {
            if (job.token.cancelled) k()
            else job.token.kills.push(k)
          }
        })
        if (r.code !== 0 && !applicable.every(s => s.optional)) throw new Error(t('m.pack.errPip', { detail: r.out.slice(-300) }))
      } finally {
        fs.rmSync(reqFile, { force: true })
      }
    }

    if (job.cancelled) return finishCancelled()

    // ---- 模型 ----
    emitStage('models', '下载模型', 0)
    const modelList = [...modelMap.values()]
    const index = indexModels(p.models)
    let modelDone = 0
    const pending: Array<{ model: PackModel; componentId: string }> = []
    for (const entry of modelList) {
      const md = entry.model
      const target = path.join(p.models, md.category, md.filename)
      const hit = index.get(md.filename)
      const item: PackItemState = {
        id: itemIdOf('model', `${md.category}/${md.filename}`),
        kind: 'model',
        componentId: entry.componentId,
        name: md.filename,
        target,
        status: hit ? 'ok' : 'missing',
        size: md.size,
        message: hit?.path,
        sourceLabel: firstSource(md) ? sourceLabel(firstSource(md)!) : undefined
      }
      if (hit) {
        result.skipped.push(md.filename)
        log(t('m.pack.logSkipModel', { name: md.filename }))
        emitItem(item)
        modelDone++
      } else {
        pending.push(entry)
      }
    }

    const downloadOne = async (entry: { model: PackModel; componentId: string }, slot: number, total: number): Promise<void> => {
      const md = entry.model
      const target = path.join(p.models, md.category, md.filename)
      const item: PackItemState = {
        id: itemIdOf('model', `${md.category}/${md.filename}`),
        kind: 'model',
        componentId: entry.componentId,
        name: md.filename,
        target,
        status: 'missing',
        size: md.size,
        sourceLabel: firstSource(md) ? sourceLabel(firstSource(md)!) : undefined
      }
      const sources = effectiveSources(md)
      if (!sources.length) {
        result.failed.push({ name: md.filename, error: 'no source' })
        emitItem({ ...item, status: 'unknown', message: t('m.pack.errNoSources', { name: md.filename }) })
        return
      }
      let lastError = ''
      for (const src of sources) {
        if (job.cancelled) return
        try {
          if (src.type === 'manual') {
            result.manual.push({ name: md.filename, target })
            log(t('m.pack.logManual', { name: md.filename, target }))
            emitItem({ ...item, status: 'manual', message: t('m.pack.logManual', { name: md.filename, target }) })
            return
          }
          if (src.type === 'bundle') {
            const from = underPack(packRoot, src.path)
            if (!fs.existsSync(from)) throw new Error(t('m.pack.errModelBundle', { path: src.path }))
            fs.mkdirSync(path.dirname(target), { recursive: true })
            fs.copyFileSync(from, target)
            if (md.size && Math.abs(fs.statSync(target).size - md.size) > Math.max(1048576, md.size * 0.01)) {
              throw new Error('bundle size mismatch')
            }
            result.installed.push(md.filename)
            emitItem({ ...item, status: 'ok', message: '已从包内拷贝' })
            return
          }
          const url =
            src.type === 'hf'
              ? hfResolveUrl(src.repo, src.file, loadSettings().hfMirror)
              : src.type === 'ms'
                ? msResolveUrl(src.repo, src.revision || 'master', src.file)
                : src.type === 'url'
                  ? src.url
                  : await resolveBySearch(md.filename, src.query, src.source)
          if (!url) {
            lastError = 'search miss'
            continue
          }
          log(t('m.pack.logDownload', { name: md.filename, source: sourceLabel(src) }))
          const task = await startDownload({ url, filename: md.filename, destRelPath: md.category })
          job.downloads.add(task.dest)
          try {
            await waitForDownload(task.dest, job, (received, size) => {
              const ratio = size ? received / size : 0
              emitItem({ ...item, status: 'missing', message: `下载中 ${Math.round(ratio * 100)}%` }, stagePercent('models', (modelDone + ratio) / Math.max(1, pending.length)))
            })
          } finally {
            job.downloads.delete(task.dest)
          }
          if (md.size && Math.abs(fs.statSync(task.dest).size - md.size) > Math.max(1048576, md.size * 0.01)) {
            lastError = 'size mismatch'
            continue
          }
          if (md.sha256 && fs.statSync(task.dest).size <= 2 * 1024 * 1024 * 1024) {
            const got = await sha256File(task.dest)
            if (got !== md.sha256.toLowerCase()) {
              lastError = 'sha256 mismatch'
              continue
            }
          }
          result.installed.push(md.filename)
          emitItem({ ...item, status: 'ok' })
          return
        } catch (e) {
          if (job.cancelled) return
          lastError = (e as Error).message || String(e)
        }
      }
      if (lastError) {
        result.failed.push({ name: md.filename, error: lastError })
        emitItem({ ...item, status: 'unknown', message: lastError })
      }
      void slot
      void total
    }

    // 模型下载并发 3
    let cursor = 0
    const workers = Array.from({ length: Math.min(3, Math.max(1, pending.length)) }, async () => {
      for (;;) {
        if (job.cancelled) return
        const idx = cursor++
        if (idx >= pending.length) return
        await downloadOne(pending[idx], idx, pending.length)
        modelDone++
        emitStage('models', '下载模型', modelDone / Math.max(1, pending.length))
      }
    })
    await Promise.all(workers)

    if (job.cancelled) return finishCancelled()

    // ---- 工作流 ----
    emitStage('workflows', '导入工作流', 0)
    const wfList = [...workflowMap.values()]
    for (let i = 0; i < wfList.length; i++) {
      if (job.cancelled) break
      const { wf, componentId } = wfList[i]
      const item: PackItemState = {
        id: itemIdOf('workflow', wf.file),
        kind: 'workflow',
        componentId,
        name: wf.name,
        target: '',
        status: 'missing'
      }
      try {
        const src = underPack(packRoot, wf.file)
        let target = workflowTarget(manifest.id, componentId, wf.file, wf.target)
        item.target = target
        if (fs.existsSync(target)) {
          const same = fs.readFileSync(src, 'utf-8') === fs.readFileSync(target, 'utf-8')
          if (same) {
            emitItem({ ...item, status: 'ok', message: '已存在' })
            continue
          }
          const ext = path.extname(target)
          const base = target.slice(0, -ext.length)
          let n = 1
          while (fs.existsSync(`${base}_${n}${ext}`)) n++
          target = `${base}_${n}${ext}`
          item.target = target
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(src, target)
        log(t('m.pack.logWorkflow', { name: wf.name }))
        emitItem({ ...item, status: 'ok' })
      } catch (e) {
        result.failed.push({ name: wf.name, error: (e as Error).message })
        emitItem({ ...item, status: 'unknown', message: (e as Error).message })
      }
    }

    emitStage('done', '完成', 1)
    result.ok = result.failed.length === 0
    recordInstalled({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      components: req.components,
      zipPath: req.zipPath
    })
    log(t('m.pack.logDone', { ok: String(result.installed.length), skip: String(result.skipped.length), fail: String(result.failed.length) }))
    return result
  } catch (e) {
    if (job.cancelled) return result
    result.error = (e as Error).message || String(e)
    onProgress({ kind: 'stage', stage, message: result.error, percent: 100 })
    return result
  } finally {
    activeJob = null
    pack?.cleanup()
  }

  function finishCancelled(): PackApplyResult {
    result.cancelled = true
    result.error = undefined
    return result
  }
}
