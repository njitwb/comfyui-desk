/**
 * 节点仓库 / 模型来源目录。
 * 数据在 src/shared/pack-catalog.json，便于 scripts/build-pack.mjs 与主进程共用同一份事实。
 * 运行时解析顺序：显式条目 → 家族仓库模板 → 在线按名搜索 → 手动放置。
 */
import path from 'node:path'
import fs from 'node:fs'
import catalog from '../shared/pack-catalog.json'
import type { PackModelSource } from '../shared/pack'

interface NodePackEntry {
  url?: string
  commit?: string
  required?: boolean
  optional?: boolean
}

interface FamilyRule {
  match: string
  repo: string
  prefix: string
}

interface ModelEntry {
  category: string
  sources: PackModelSource[]
}

interface CatalogShape {
  nodePacks: Record<string, NodePackEntry>
  bundledNodes: Record<string, { localDir: string; required?: boolean }>
  unknownNodes: Record<string, { reason: string }>
  familyRules: FamilyRule[]
  models: Record<string, ModelEntry>
}

export const CATALOG = catalog as unknown as CatalogShape

/** 内置包根目录：打包后在 resources/packs，开发时在仓库 resources/packs */
export function builtinPacksDir(): string {
  const candidates = [path.join(process.resourcesPath || '', 'packs'), path.join(process.cwd(), 'resources', 'packs')]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return candidates[candidates.length - 1]
}

export function builtinPackDir(id: string): string {
  return path.join(builtinPacksDir(), id)
}

export function hasBuiltinPack(id: string): boolean {
  return fs.existsSync(path.join(builtinPackDir(id), 'comfyui-pack.json'))
}

/** 节点目录名对应的 git 仓库信息 */
export function nodePackEntry(key: string): NodePackEntry | undefined {
  return CATALOG.nodePacks[key]
}

/** 没有云端 git 来源、只能随包分发的节点目录 */
export function bundledNodeEntry(key: string): { localDir: string; required?: boolean } | undefined {
  return CATALOG.bundledNodes[key]
}

export function unknownNodeEntry(key: string): { reason: string } | undefined {
  return CATALOG.unknownNodes[key]
}

/** 显式模型条目（可能含 manual/search） */
export function modelCatalogEntry(filename: string): ModelEntry | undefined {
  return CATALOG.models[filename]
}

/** 按模型家族推导一个 HF 候选来源 */
function familyCandidate(filename: string, category: string): PackModelSource | null {
  for (const rule of CATALOG.familyRules) {
    try {
      if (!new RegExp(rule.match).test(filename)) continue
    } catch {
      continue
    }
    const file = rule.prefix ? `${rule.prefix}/${category}/${filename}` : `${category}/${filename}`
    return { type: 'hf', repo: rule.repo, file, revision: 'main' }
  }
  return null
}

function sameSource(a: PackModelSource, b: PackModelSource): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'hf' || a.type === 'ms') {
    const bb = b as Extract<PackModelSource, { type: 'hf' | 'ms' }>
    return a.repo === bb.repo && a.file === bb.file && (a.revision || '') === (bb.revision || '')
  }
  if (a.type === 'url') return a.url === (b as { url: string }).url
  if (a.type === 'search') return a.query === (b as { query: string }).query && a.source === (b as { source: string }).source
  if (a.type === 'bundle') return a.path === (b as { path: string }).path
  return true
}

/** 解析某个模型可用的来源列表（去重；显式直链 → 家族模板 → 在线搜索 → 手动兜底） */
export function resolveModelSources(filename: string, category: string): PackModelSource[] {
  const out: PackModelSource[] = []
  const fallback: PackModelSource[] = []
  const push = (s: PackModelSource): void => {
    if (!out.some(x => sameSource(x, s))) out.push(s)
  }
  const entry = modelCatalogEntry(filename)
  if (entry) {
    for (const s of entry.sources) {
      // search/manual 是兜底，必须排在家族仓库候选之后，避免把可推导的直链跳过
      if (s.type === 'search' || s.type === 'manual') fallback.push(s)
      else push(s)
    }
  }
  const fam = familyCandidate(filename, category)
  if (fam) push(fam)
  for (const s of fallback) {
    if (s.type === 'manual') continue
    if (s.type === 'search' && out.some(x => x.type === 'search')) continue
    push(s)
  }
  if (!out.some(s => s.type === 'search')) {
    push({ type: 'search', source: 'hf', query: filename.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i, '') })
  }
  push({ type: 'manual' })
  return out
}

/** 是否至少有一个非手动来源 */
export function hasCloudSource(sources: PackModelSource[]): boolean {
  return sources.some(s => s.type !== 'manual')
}

/** 来源展示文案 */
export function sourceLabel(s: PackModelSource): string {
  switch (s.type) {
    case 'hf':
      return `HF ${s.repo}`
    case 'ms':
      return `魔搭 ${s.repo}`
    case 'url':
      return '直链'
    case 'search':
      return `在线搜索 ${s.query}`
    case 'bundle':
      return '包内文件'
    case 'manual':
      return '需手动放置'
  }
}

/** 节点 key → 默认 git 来源 */
export function nodeSourceOf(key: string): { url: string; commit?: string } | null {
  const e = nodePackEntry(key)
  if (!e?.url) return null
  return { url: e.url, commit: e.commit }
}
