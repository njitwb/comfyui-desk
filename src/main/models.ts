import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { paths } from './settings'
import { t } from './i18n'
import type { ModelCategory, ModelItem, ModelSource, OnlineModel, OnlineModelFile, OnlineSearchResult } from '../shared/api'

const CATEGORIES = [
  'checkpoints', 'clip', 'clip_vision', 'configs', 'controlnet', 'diffusion_models',
  'embeddings', 'loras', 'style_models', 'text_encoders', 'unet', 'upscale_models', 'vae', 'vae_approx'
]

/** 扫描模型目录（含子目录，最多两层） */
export function scanModels(): ModelCategory[] {
  const root = paths().models
  const result: ModelCategory[] = []
  if (!fs.existsSync(root)) return result
  for (const cat of CATEGORIES) {
    const dir = path.join(root, cat)
    if (!fs.existsSync(dir)) continue
    const files: ModelItem[] = []
    const walk = (d: string, depth: number): void => {
      if (depth > 2) return
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full, depth + 1)
        else {
          try {
            const st = fs.statSync(full)
            files.push({ name: e.name, relPath: full, category: cat, size: st.size, mtime: st.mtimeMs })
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(dir, 0)
    files.sort((a, b) => b.mtime - a.mtime)
    result.push({ name: cat, count: files.length, files })
  }
  return result
}

export function deleteModel(relPath: string): void {
  const root = paths().models
  if (!path.resolve(relPath).startsWith(path.resolve(root))) throw new Error(t('m.models.invalidPath'))
  fs.rmSync(relPath, { force: true })
}

/** 把模型文件移动到另一个类别目录（目标已有同名文件时拒绝，避免覆盖），返回新路径 */
export function moveModel(relPath: string, category: string): string {
  const root = paths().models
  if (!path.resolve(relPath).startsWith(path.resolve(root))) throw new Error(t('m.models.invalidPath'))
  if (!CATEGORIES.includes(category)) throw new Error(t('m.models.errBadCategory', { category }))
  if (!fs.existsSync(relPath)) throw new Error(t('m.models.errMoveMissing', { path: relPath }))
  const name = path.basename(relPath)
  const dest = path.join(path.resolve(root), category, name)
  if (dest === path.resolve(relPath)) return relPath
  if (fs.existsSync(dest)) throw new Error(t('m.models.errMoveExists', { name, category }))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  try {
    fs.renameSync(relPath, dest)
  } catch {
    // 跨盘符（模型目录与目标不在同一分区）时 rename 会失败，退化为复制后删源
    fs.copyFileSync(relPath, dest)
    fs.rmSync(relPath, { force: true })
  }
  return dest
}

export function modelCategories(): string[] {
  return CATEGORIES
}

// ---- 在线模型库：HuggingFace（可切国内镜像 hf-mirror.com）与魔搭 ModelScope（国内直连） ----

/** 模型文件扩展名（用于把权重文件排在文件列表前面） */
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i

/** 魔搭搜索单页条数（服务端上限 20） */
const MS_PAGE_SIZE = 20

/** 查看文件（列仓库文件列表）的超时：大仓库详情返回体较大，给 30s */
const FILES_TIMEOUT = 30000

/** HF 主机：开启镜像走国内站点，否则走官方站 */
function hfHost(useMirror: boolean): string {
  return useMirror ? 'hf-mirror.com' : 'huggingface.co'
}

/** 相对路径逐段编码（文件名可能含子目录） */
function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

/** HF 搜索接口（走官方默认的相关度排序：按下载量排会把精确命中的长尾仓库挤出前几页） */
export function hfSearchUrl(query: string, useMirror: boolean, limit = 30): string {
  return `https://${hfHost(useMirror)}/api/models?search=${encodeURIComponent(query)}&limit=${limit}`
}

/** HF 仓库详情（blobs=true 才会返回文件大小） */
export function hfFilesUrl(repoId: string, useMirror: boolean, blobs = true): string {
  return `https://${hfHost(useMirror)}/api/models/${repoId}${blobs ? '?blobs=true' : ''}`
}

/** HF 仓库内文件直链（main 分支） */
export function hfResolveUrl(repoId: string, filename: string, useMirror: boolean): string {
  return `https://${hfHost(useMirror)}/${repoId}/resolve/main/${encodePath(filename)}`
}

/** 魔搭搜索接口（PUT + JSON body，匿名可用） */
export const MS_SEARCH_URL = 'https://modelscope.cn/api/v1/models'

/** 魔搭搜索请求体：按下载量倒序 */
export function msSearchBody(query: string, pageSize = MS_PAGE_SIZE): Record<string, unknown> {
  return { PageSize: pageSize, PageNumber: 1, SortBy: 'DownloadsCount', Name: query }
}

/** 魔搭仓库文件列表（Recursive 才返回子目录文件） */
export function msFilesUrl(repoId: string, revision: string): string {
  return `https://modelscope.cn/api/v1/models/${repoId}/repo/files?Revision=${encodeURIComponent(revision)}&Recursive=true`
}

/** 魔搭仓库内文件直链 */
export function msResolveUrl(repoId: string, revision: string, filename: string): string {
  return `https://modelscope.cn/models/${repoId}/resolve/${encodeURIComponent(revision)}/${encodePath(filename)}`
}

/** 校验仓库 ID 形如 owner/name，非法时抛错（防止把任意内容拼进 URL） */
export function normalizeRepoId(input: string): string {
  const id = (input || '').trim().replace(/^\/+|\/+$/g, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(id)) throw new Error(t('m.dl.errBadRepo', { id: input }))
  return id
}

/** 关键词分词（下划线 / 短横线 / 点 / 空格） */
export function queryTokens(query: string): string[] {
  return query.split(/[\s_\-./]+/).filter(Boolean)
}

/**
 * 规范化检索词：粘贴链接时取出仓库 ID；直接搜文件名时去掉模型扩展名。
 * 用户常把文件名（minimax_h3_xxx.safetensors）或页面链接直接粘进搜索框。
 */
export function normalizeQuery(input: string): string {
  const q = (input || '').trim()
  const url = /^https?:\/\/[^/]+\/(?:models\/)?([\w.-]+\/[\w.-]+)/.exec(q)
  if (url) return url[1]
  return q.replace(MODEL_EXT, '')
}

/** 魔搭搜索只按模型名匹配（不支持 owner/name）：仓库 ID 取最后一段 */
export function msNameQuery(query: string): string {
  const seg = query.split('/').filter(Boolean)
  return seg.length > 1 ? seg[seg.length - 1] : query
}

/** HF 兜底检索词：关键词多于两个时收敛到前两个（minimax_h3_ref2va_pruned → minimax_h3）；词太少返回空串 */
export function hfFallbackQuery(query: string): string {
  const tokens = queryTokens(query)
  if (tokens.length < 3) return ''
  return tokens.slice(0, 2).join('_')
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** HF 搜索结果 → 统一结构（字段缺失按 0 / 空处理） */
export function mapHfSearch(raw: unknown): OnlineModel[] {
  if (!Array.isArray(raw)) return []
  const list: OnlineModel[] = []
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || !str(r.id)) continue
    list.push({
      id: str(r.id),
      source: 'hf',
      revision: 'main',
      downloads: num(r.downloads),
      likes: num(r.likes),
      tag: str(r.pipeline_tag),
      gated: Boolean(r.gated)
    })
  }
  return list
}

/** 魔搭搜索结果 → 统一结构（仓库 ID = Path/Name，点赞数为 Stars） */
export function mapMsSearch(raw: unknown): OnlineModel[] {
  const models = (raw as { Data?: { Models?: unknown } })?.Data?.Models
  if (!Array.isArray(models)) return []
  const list: OnlineModel[] = []
  for (const m of models as Record<string, unknown>[]) {
    const owner = str(m?.Path)
    const name = str(m?.Name)
    if (!owner || !name) continue
    const tasks = Array.isArray(m.Tasks) ? (m.Tasks as Record<string, unknown>[]) : []
    list.push({
      id: `${owner}/${name}`,
      source: 'ms',
      revision: str(m.Revision) || 'master',
      downloads: num(m.Downloads),
      likes: num(m.Stars),
      tag: tasks.length ? str(tasks[0].Name) : ''
    })
  }
  return list
}

/** HF 仓库详情 → 文件列表 */
export function mapHfFiles(raw: unknown, repoId: string, useMirror: boolean): OnlineModelFile[] {
  const siblings = (raw as { siblings?: unknown })?.siblings
  if (!Array.isArray(siblings)) return []
  const files: OnlineModelFile[] = []
  for (const s of siblings as Record<string, unknown>[]) {
    const name = str(s?.rfilename)
    if (!name || name.startsWith('.')) continue
    files.push({ name, size: num(s.size), url: hfResolveUrl(repoId, name, useMirror) })
  }
  return sortFiles(files)
}

/** 魔搭仓库详情 → 文件列表（只取文件，忽略目录项） */
export function mapMsFiles(raw: unknown, repoId: string, revision: string): OnlineModelFile[] {
  const list = (raw as { Data?: { Files?: unknown } })?.Data?.Files
  if (!Array.isArray(list)) return []
  const files: OnlineModelFile[] = []
  for (const f of list as Record<string, unknown>[]) {
    const name = str(f?.Path)
    if (!name || name.startsWith('.') || str(f.Type) !== 'blob') continue
    files.push({ name, size: num(f.Size), url: msResolveUrl(repoId, revision, name) })
  }
  return sortFiles(files)
}

/** 权重文件优先，其余按名称排序 */
function sortFiles(files: OnlineModelFile[]): OnlineModelFile[] {
  const rank = (f: OnlineModelFile): number => (MODEL_EXT.test(f.name) ? 0 : 1)
  return files.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** 请求 JSON：有 body 走 PUT（魔搭搜索用），否则 GET；跟随重定向，404 返回 null */
function requestJson(url: string, body?: unknown, redirects = 3, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const req = https.request(
      url,
      {
        method: payload ? 'PUT' : 'GET',
        headers: {
          'user-agent': 'comfyui-desk',
          accept: 'application/json',
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {})
        }
      },
      res => {
        const code = res.statusCode || 0
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume()
          if (redirects <= 0) return reject(new Error(t('m.dl.errTooManyRedirects')))
          return resolve(requestJson(new URL(res.headers.location, url).toString(), body, redirects - 1, timeoutMs))
        }
        let data = ''
        res.setEncoding('utf-8')
        res.on('data', d => (data += d))
        res.on('end', () => {
          if (code === 404) return resolve(null)
          if (code < 200 || code >= 300) return reject(new Error(`HTTP ${code}`))
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(t('m.dl.errInvalidJson')))
          }
        })
      }
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(t('m.dl.errTimeout'))))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** 回校验预算：只查前若干个结果、并发受限、单请求超时更短，避免搜索卡住 */
const VERIFY_MAX = 10
const VERIFY_CONCURRENCY = 5
const VERIFY_TIMEOUT = 6000

/** 并发受限地跑异步任务（回校验要打多个仓库的文件列表，避免一次性打满） */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

/** 回校验专用：只取文件名（不带 blobs，请求更轻） */
async function hfFileNames(repoId: string, useMirror: boolean): Promise<string[]> {
  const raw = await requestJson(hfFilesUrl(repoId, useMirror, false), undefined, 3, VERIFY_TIMEOUT)
  const siblings = (raw as { siblings?: unknown })?.siblings
  if (!Array.isArray(siblings)) return []
  return (siblings as Record<string, unknown>[]).map(s => str(s?.rfilename)).filter(Boolean)
}

/**
 * 降级搜索的结果按文件名回校验：只看仓库文件列表里是否真含原检索词，
 * 命中则只保留命中的仓库；一个都没命中时原样返回（避免把结果清空）。
 * 只校验相关度最高的前 VERIFY_MAX 个仓库，兼顾准确与响应速度。
 */
async function verifyByFileName(
  models: OnlineModel[],
  useMirror: boolean,
  needle: string
): Promise<OnlineModel[]> {
  const n = needle.trim().toLowerCase()
  if (!n || !models.length) return models
  const checked = await mapLimit(models.slice(0, VERIFY_MAX), VERIFY_CONCURRENCY, async m => {
    try {
      const names = await hfFileNames(m.id, useMirror)
      return names.some(name => name.toLowerCase().includes(n)) ? m : null
    } catch {
      return null // 单个仓库列文件失败按未命中处理，不影响整体
    }
  })
  const matched = checked.filter((m): m is OnlineModel => m !== null)
  return matched.length ? matched : models
}

/** 搜索在线模型库：hf 由镜像开关决定搜索站点，ms 走魔搭；返回实际生效的检索词便于界面提示 */
export async function searchOnlineModels(
  source: ModelSource,
  query: string,
  useMirror: boolean
): Promise<OnlineSearchResult> {
  const q = normalizeQuery(query)
  if (!q) return { query: '', models: [] }
  if (source === 'ms') {
    const name = msNameQuery(q)
    return { query: name, models: mapMsSearch(await requestJson(MS_SEARCH_URL, msSearchBody(name))) }
  }
  const models = mapHfSearch(await requestJson(hfSearchUrl(q, useMirror)))
  if (models.length) return { query: q, models }
  // HF 只按仓库 ID 匹配，搜文件名通常为空：退回前两个关键词再搜一次（魔搭不适用，宽泛词会返回大量无关仓库）
  const short = hfFallbackQuery(q)
  if (!short) return { query: q, models: [] }
  const candidates = mapHfSearch(await requestJson(hfSearchUrl(short, useMirror)))
  const verified = await verifyByFileName(candidates, useMirror, q)
  return { query: short, models: verified, fileFiltered: verified.length !== candidates.length }
}

/** 列出在线仓库内可下载文件（直链按 source / 镜像拼好） */
export async function listOnlineModelFiles(
  source: ModelSource,
  repoId: string,
  revision: string,
  useMirror: boolean
): Promise<OnlineModelFile[]> {
  const id = normalizeRepoId(repoId)
  if (source === 'ms') {
    const rev = (revision || '').trim() || 'master'
    return mapMsFiles(await requestJson(msFilesUrl(id, rev), undefined, 3, FILES_TIMEOUT), id, rev)
  }
  return mapHfFiles(await requestJson(hfFilesUrl(id, useMirror), undefined, 3, FILES_TIMEOUT), id, useMirror)
}
