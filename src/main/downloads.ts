import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import { paths } from './settings'
import { comfy } from './process'
import { modelCategories } from './models'
import { t as tr } from './i18n'
import type { DownloadTask } from '../shared/api'

/** 模型文件扩展名（用于校验返回内容是否为模型） */
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i

interface TaskState {
  task: DownloadTask
  lastBytes: number
  lastBytesAt: number
  req?: http.ClientRequest
  file?: fs.WriteStream
  /** 主动中断标记：pause / cancel 时 req.destroy 触发的错误不计为失败 */
  halt: 'none' | 'pause' | 'cancel'
}

const states = new Map<string, TaskState>()
let broadcast: (list: DownloadTask[]) => void = () => {}
let throttle: NodeJS.Timeout | null = null

/** 由 ipc.ts 注入广播通道；同时恢复上次退出时未完成的任务 */
export function initDownloads(fn: (list: DownloadTask[]) => void): void {
  broadcast = fn
  restore()
}

function snapshot(): DownloadTask[] {
  return [...states.values()].map(s => ({ ...s.task })).sort((a, b) => b.startedAt - a.startedAt)
}
export function listDownloads(): DownloadTask[] {
  return snapshot()
}
/** 高频进度：300ms 合并推送一次 */
function emitSoon(): void {
  if (!throttle) throttle = setTimeout(() => { throttle = null; broadcast(snapshot()) }, 300)
}
/** 状态切换：立即推送 */
function emitNow(): void {
  if (throttle) { clearTimeout(throttle); throttle = null }
  broadcast(snapshot())
  persist()
}

// ---- 任务持久化：退出不丢任务，重启后按临时文件大小断点续传 ----

let storePath = ''
function storeFile(): string {
  if (!storePath) storePath = path.join(app.getPath('userData'), 'downloads.json')
  return storePath
}

/** 元数据落盘（进度不持久，续传偏移以临时文件大小为准） */
function persist(): void {
  try {
    const list = snapshot().filter(t => t.status !== 'completed')
    fs.writeFileSync(storeFile(), JSON.stringify(list), 'utf-8')
  } catch {
    /* 落盘失败不影响下载 */
  }
}

/** 启动时恢复未完成任务：下载中的自动续传，暂停 / 出错的还原状态待用户操作 */
function restore(): void {
  let list: DownloadTask[] = []
  try {
    if (!fs.existsSync(storeFile())) return
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')) as unknown
    if (Array.isArray(raw)) list = raw as DownloadTask[]
  } catch {
    return
  }
  let resumed = 0
  for (const t of list) {
    if (!t || typeof t.url !== 'string' || typeof t.dest !== 'string' || !t.filename || !t.category) continue
    if (states.has(t.dest)) continue
    if (fs.existsSync(t.dest)) continue
    const st: TaskState = {
      task: { ...t, id: t.id || crypto.randomUUID(), speed: 0 },
      lastBytes: 0,
      lastBytesAt: Date.now(),
      halt: 'none'
    }
    // 进度以临时文件实际大小为准（比落盘快照新）
    const tmp = t.dest + '.downloading'
    try { if (fs.existsSync(tmp)) st.task.received = fs.statSync(tmp).size } catch { /* noop */ }
    states.set(t.dest, st)
    if (t.status === 'downloading') {
      resumed++
      comfy.pushLog('sys', tr('m.dl.logResume', { filename: t.filename }))
      void runTask(st)
    } else if (t.status !== 'paused') {
      st.task.status = 'error'
    }
  }
  if (states.size) emitNow()
}

/** 规范化下载地址：HF 镜像切换 + 网页链接（/blob/）转直链（/resolve/），避免把 HTML 页面存成模型 */
function normalizeUrl(input: string): string {
  let u = input.trim()
  // HuggingFace 绕国内墙：页面链接 /blob/ 转直链 /resolve/（先转镜像再处理，两个 host 统一走一遍）
  u = u.replace(/^(https?:\/\/)(?:huggingface\.co|hf-mirror\.com)(\/[^/]+\/[^/]+)\/blob\//i, '$1hf-mirror.com$2/resolve/')
  u = u.replace(/^(https?:\/\/)huggingface\.co/i, '$1hf-mirror.com')
  // ModelScope 页面链接 → 直链
  u = u.replace(/^(https?:\/\/)(www\.)?modelscope\.cn(\/models\/[^/]+\/[^/]+)\/blob\//i, '$1$2modelscope.cn$3/resolve/')
  return u
}

function guessName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '')
  } catch {
    return ''
  }
}

/** 已知的模型类别目录名（URL 路径段精确匹配用） */
const KNOWN_CATS = [
  'checkpoints', 'clip', 'clip_vision', 'controlnet', 'diffusion_models',
  'embeddings', 'loras', 'style_models', 'text_encoders', 'unet',
  'upscale_models', 'vae', 'vae_approx', 'configs'
]

/** 按文件名 / URL 关键词推断模型类别（抓取不到目录时的兜底） */
export function inferCategory(filename: string, url = ''): string {
  // 仓库直链常带类别目录段（如 …/resolve/main/diffusion_models/x.safetensors），优先采用
  try {
    for (const seg of new URL(url).pathname.split('/')) {
      const s = decodeURIComponent(seg).toLowerCase()
      if (KNOWN_CATS.includes(s)) return s
    }
  } catch { /* 非标准 URL 时走关键词兜底 */ }
  const s = `${filename} ${url}`.toLowerCase()
  if (s.includes('lora')) return 'loras'
  if (s.includes('controlnet')) return 'controlnet'
  if (s.includes('vae')) return 'vae'
  if (s.includes('upscale') || s.includes('esrgan')) return 'upscale_models'
  if (s.includes('embedding') || s.includes('embedding')) return 'embeddings'
  if (s.includes('text_encoder') || s.includes('t5') || s.includes('qwen')) return 'text_encoders'
  if (s.includes('clip')) return 'clip'
  if (s.includes('unet') || s.includes('diffusion')) return 'diffusion_models'
  return 'checkpoints'
}

/** 发起一次 HTTP 请求下载，自动跟随重定向（最多 5 次） */
function requestOnce(st: TaskState, redirectsLeft: number): Promise<void> {
  const t = st.task
  const tmp = t.dest + '.downloading'
  return new Promise<void>((resolve, reject) => {
    const offset = st.halt === 'none' && fs.existsSync(tmp) ? fs.statSync(tmp).size : 0
    t.received = offset
    const headers: Record<string, string> = { 'user-agent': 'comfyui-desk' }
    if (offset > 0) headers.range = `bytes=${offset}-`
    const lib = t.url.startsWith('http://') ? http : https

    const req = lib.get(t.url, { headers }, (res) => {
      // 跟随重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirectsLeft <= 0) return reject(new Error(tr('m.dl.errTooManyRedirects')))
        t.url = new URL(res.headers.location, t.url).toString()
        return resolve(requestOnce(st, redirectsLeft - 1))
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      // 请求了断点但服务器不支持续传（回 200）：从头重下
      if (offset > 0 && res.statusCode === 200) {
        t.received = 0
        fs.rmSync(tmp, { force: true })
      }
      // 服务器回了网页而非文件（页面链接 / 登录墙 / 下载受限）
      const ctype = String(res.headers['content-type'] || '')
      if (/text\/html/i.test(ctype) && MODEL_EXT.test(t.filename)) {
        res.resume()
        return reject(new Error(tr('m.dl.errNotModelFile')))
      }
      const append = res.statusCode === 206 && offset > 0
      if (!t.total) t.total = Number(res.headers['content-length'] || 0) + (append ? offset : 0)

      const file = fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' })
      st.file = file
      res.on('data', (d: Buffer) => {
        t.received += d.length
        const now = Date.now()
        if (now - st.lastBytesAt >= 500) {
          t.speed = Math.round(((t.received - st.lastBytes) * 1000) / (now - st.lastBytesAt))
          st.lastBytes = t.received
          st.lastBytesAt = now
        }
        emitSoon()
      })
      res.on('error', reject)
      file.on('error', reject)
      res.pipe(file)
      file.on('finish', () => {
        st.file = undefined
        if (st.halt !== 'none') return resolve()
        file.close(() => {
          try {
            fs.rmSync(t.dest, { force: true })
            fs.renameSync(tmp, t.dest)
            t.status = 'completed'
            if (!t.total) t.total = t.received
            t.speed = 0
            comfy.pushLog('sys', tr('m.dl.logDone', { path: t.dest }))
            emitNow()
            // 完成态保留 3 秒供用户看到后自动清除行
            setTimeout(() => {
              const cur = states.get(t.dest)
              if (cur && cur.task.status === 'completed') {
                states.delete(t.dest)
                emitNow()
              }
            }, 3000)
          } catch (e) {
            reject(e)
          }
        })
      })
      res.on('aborted', () => {
        if (st.halt !== 'none') resolve()
      })
    })
    st.req = req
    req.on('error', (e) => {
      if (st.halt !== 'none') return resolve()
      reject(e)
    })
  })
}

async function runTask(st: TaskState): Promise<void> {
  st.halt = 'none'
  st.task.status = 'downloading'
  st.task.error = undefined
  st.lastBytes = st.task.received
  st.lastBytesAt = Date.now()
  emitNow()
  try {
    await requestOnce(st, 5)
  } catch (e) {
    if (st.halt !== 'none') return
    st.task.status = 'error'
    st.task.error = (e as Error).message
    st.task.speed = 0
    comfy.pushLog('sys', tr('m.dl.logFailed', { filename: st.task.filename, error: st.task.error }))
    emitNow()
  }
}

export async function startDownload(opts: {
  url: string
  category?: string
  filename?: string
  useHfMirror?: boolean
}): Promise<DownloadTask> {
  const url = normalizeUrl(opts.url)
  const rawName = (opts.filename || '').trim() || guessName(url)
  const filename = path.basename(rawName || `download-${Date.now()}.bin`) // 防路径穿越
  const cats = modelCategories()
  const category = cats.includes(opts.category || '') ? (opts.category as string) : inferCategory(filename, url)
  const dir = path.join(paths().models, category)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, filename)
  const st: TaskState = {
    task: {
      id: crypto.randomUUID(),
      url,
      category,
      filename,
      dest,
      received: 0,
      total: 0,
      speed: 0,
      status: 'downloading',
      startedAt: Date.now()
    },
    lastBytes: 0,
    lastBytesAt: Date.now(),
    halt: 'none'
  }
  if (states.has(dest)) return { ...states.get(dest)!.task } // 同目标已在下载中：直接返回
  states.set(dest, st)
  comfy.pushLog(
    'sys',
    opts.useHfMirror
      ? tr('m.dl.logStartMirror', { filename, category })
      : tr('m.dl.logStart', { filename, category })
  )
  void runTask(st)
  return { ...st.task }
}

export function pauseDownload(id: string): void {
  const st = find(id)
  if (!st || st.task.status !== 'downloading') return
  st.halt = 'pause'
  st.task.status = 'paused'
  st.task.speed = 0
  st.req?.destroy()
  st.file?.destroy()
  comfy.pushLog('sys', tr('m.dl.logPaused', { filename: st.task.filename }))
  emitNow()
}

export function resumeDownload(id: string): void {
  const st = find(id)
  if (!st || (st.task.status !== 'paused' && st.task.status !== 'error')) return
  comfy.pushLog('sys', tr('m.dl.logResumed', { filename: st.task.filename }))
  void runTask(st)
}

export function cancelDownload(id: string): void {
  const st = find(id)
  if (!st) return
  st.halt = 'cancel'
  st.req?.destroy()
  st.file?.destroy()
  fs.rmSync(st.task.dest + '.downloading', { force: true })
  states.delete(st.task.dest)
  comfy.pushLog(
    'sys',
    tr(st.task.status === 'completed' ? 'm.dl.logCleared' : 'm.dl.logCanceled', { filename: st.task.filename })
  )
  emitNow()
}

function find(id: string): TaskState | undefined {
  for (const st of states.values()) if (st.task.id === id) return st
  return undefined
}
