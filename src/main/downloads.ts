import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import { paths, loadSettings } from './settings'
import { comfy } from './process'
import { modelCategories } from './models'
import { t as tr } from './i18n'
import type { DownloadTask } from '../shared/api'

/** 模型文件扩展名（用于校验返回内容是否为模型） */
const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i

/** 分段并发拉满单文件吞吐：达到该阈值且服务器支持 Range 才分段；每文件拆 N 段并行 */
const PARALLEL_MIN = 8 * 1024 * 1024
const SEG_COUNT = 4

interface Segment {
  from: number
  to: number
  path: string
}

interface TaskState {
  task: DownloadTask
  lastBytes: number
  lastBytesAt: number
  /** 主动中断标记：pause / cancel 时 req.destroy 触发的错误不计为失败 */
  halt: 'none' | 'pause' | 'cancel'
  /** 当前活跃的请求 / 写入流（分段与单连接共用，便于统一暂停/取消） */
  reqs: http.ClientRequest[]
  files: fs.WriteStream[]
  /** 分段信息（存在即表示任务走分段并行下载） */
  parts?: Segment[]
  /** 每段当前已写入字节数（相对该段起点），用于前台显示合计进度与断点续传 */
  partRecv?: number[]
  partsFile?: string
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
      halt: 'none',
      reqs: [],
      files: []
    }
    // 进度以临时文件实际大小为准（比落盘快照新）
    const metaPath = t.dest + '.segmeta.json'
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { total?: number; parts?: { from: number; to: number }[] }
        if (Array.isArray(meta.parts)) {
          st.task.total = meta.total || 0
          st.parts = (meta.parts as { from: number; to: number }[]).map((p, i) => ({ from: p.from, to: p.to, path: `${t.dest}.seg${i}` }))
          st.partRecv = st.parts.map((_, i) => {
            const f = `${t.dest}.seg${i}`
            try { return fs.existsSync(f) ? fs.statSync(f).size : 0 } catch { return 0 }
          })
          st.partsFile = metaPath
          st.task.received = st.partRecv.reduce((a, b) => a + b, 0)
        }
      } catch { /* segmeta 损坏则按单连接续传 */ }
    }
    if (!st.parts) {
      const tmp = t.dest + '.downloading'
      try { if (fs.existsSync(tmp)) st.task.received = fs.statSync(tmp).size } catch { /* noop */ }
    }
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

/** HuggingFace 主机：开启 HF 镜像走国内站点，否则走官方站 */
function hfHost(useHfMirror: boolean): string {
  return useHfMirror ? 'hf-mirror.com' : 'huggingface.co'
}

/** 规范化下载地址：HF 主机按镜像开关切换 + 网页链接（/blob/）转直链（/resolve/），避免把 HTML 页面存成模型 */
function normalizeUrl(input: string, useHfMirror: boolean): string {
  let u = input.trim()
  // 页面链接 /blob/ 转直链 /resolve/（主机先保留，下一步再按开关统一）
  u = u.replace(/^(https?:\/\/)((?:huggingface\.co|hf-mirror\.com)\/[^/]+\/[^/]+\/)blob\//i, '$1$2resolve/')
  // 统一到当前所选主机：跟随「HF 镜像」开关落到 hf-mirror.com 或 huggingface.co
  u = u.replace(/^(https?:\/\/)(?:huggingface\.co|hf-mirror\.com)(?=\/)/i, `$1${hfHost(useHfMirror)}`)
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
      // 以 GET 实际响应为准更新总大小：HEAD 探测/旧值可能不准（如 CDN 对 HEAD 返回错误的 content-length）
      const cl = Number(res.headers['content-length'] || 0)
      const realTotal = cl + (append ? offset : 0)
      if (realTotal > 0 && (!t.total || realTotal !== t.total)) t.total = realTotal

      const file = fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' })
      st.files.push(file)
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
        st.halt !== 'none' ? resolve() : finalizeSingle(t, tmp, file)
      })
      res.on('aborted', () => {
        if (st.halt !== 'none') resolve()
      })
    })
    st.reqs.push(req)
    req.on('error', (e) => {
      if (st.halt !== 'none') return resolve()
      reject(e)
    })
  })
}

/** 单连接下载完成：临时文件正式落地并广播（保留 3 秒供查看后自动清除） */
function finalizeSingle(t: DownloadTask, tmp: string, file: fs.WriteStream): void {
  file.close(() => {
    try {
      fs.rmSync(t.dest, { force: true })
      fs.renameSync(tmp, t.dest)
      t.status = 'completed'
      if (!t.total) t.total = t.received
      t.speed = 0
      comfy.pushLog('sys', tr('m.dl.logDone', { path: t.dest }))
      emitNow()
      setTimeout(() => {
        const cur = states.get(t.dest)
        if (cur && cur.task.status === 'completed') {
          states.delete(t.dest)
          emitNow()
        }
      }, 3000)
    } catch (e) {
      /* rename 失败不阻断任务列表 */
    }
  })
}

/** HEAD 探针：获取文件大小并确认服务器是否支持 Range（不支持则回退单连接） */
function probeSource(url: string, st?: TaskState): Promise<{ total: number; range: boolean }> {
  return new Promise(resolve => {
    const lib = url.startsWith('http://') ? http : https
    const req = lib.request(url, { method: 'HEAD', headers: { 'user-agent': 'comfyui-desk' } }, res => {
      res.resume()
      res.on('error', () => resolve({ total: 0, range: false }))
      const range = /bytes/i.test(String(res.headers['accept-ranges'] || ''))
      const len = Number(res.headers['content-length'] || 0)
      resolve({ total: len > 0 ? len : 0, range })
    })
    if (st) st.reqs.push(req)
    req.on('error', () => resolve({ total: 0, range: false }))
    req.end()
  })
}

function persistSegMeta(st: TaskState): void {
  try {
    fs.writeFileSync(st.partsFile!, JSON.stringify({ total: st.task.total, parts: st.parts!.map(p => ({ from: p.from, to: p.to })) }), 'utf-8')
  } catch { /* 元数据落盘失败不影响下载 */ }
}

/** 按文件大小划分等分区间，并回填本次已存在的部分文件大小（局部续传） */
function buildSegments(st: TaskState, total: number): void {
  const count = Math.max(1, Math.min(SEG_COUNT, total <= 0 ? 1 : SEG_COUNT))
  const base = Math.floor(total / count)
  st.task.total = total
  st.parts = []
  st.partRecv = []
  for (let i = 0; i < count; i++) {
    const from = i * base
    st.parts.push({ from, to: i === count - 1 ? total : from + base, path: `${st.task.dest}.seg${i}` })
    const f = `${st.task.dest}.seg${i}`
    try { st.partRecv.push(fs.existsSync(f) ? fs.statSync(f).size : 0) } catch { st.partRecv.push(0) }
  }
  st.partsFile = st.task.dest + '.segmeta.json'
  persistSegMeta(st)
}

/** 分段并行下载主流程：各段并发拉取 → 全部就绪后合并 */
async function runSegmented(st: TaskState): Promise<void> {
  st.lastBytes = st.task.received
  st.lastBytesAt = Date.now()
  emitNow()
  await Promise.all((st.parts ?? []).map((p, i) => downloadPart(st, p, i)))
  if (st.halt !== 'none') return
  await concatParts(st)
}

/** 下载单个分段（按 Range 续写该段独立临时文件），完成后统一合并 */
function downloadPart(st: TaskState, part: Segment, i: number): Promise<void> {
  const from = part.from + st.partRecv![i]
  if (from >= part.to) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const lib = st.task.url.startsWith('http://') ? http : https
    // 上界取 [to-1] 表示左右都闭区间，精确拉到该分段结尾
    const req = lib.get(st.task.url, { headers: { 'user-agent': 'comfyui-desk', range: `bytes=${from}-${part.to - 1}` } }, res => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      // 服务器无视 Range 返回 200（整文件），分段失效
      if (res.statusCode === 200 && from > 0) {
        res.resume()
        return reject(new Error(tr('m.dl.errSeqNoRange')))
      }
      const file = fs.createWriteStream(part.path, { flags: 'a' })
      st.files.push(file)
      res.on('data', (d: Buffer) => {
        file.write(d)
        st.partRecv![i] += d.length
        st.task.received = (st.partRecv || []).reduce((a, b) => a + b, 0)
        const now = Date.now()
        if (now - st.lastBytesAt >= 500) {
          st.task.speed = Math.round(((st.task.received - st.lastBytes) * 1000) / (now - st.lastBytesAt))
          st.lastBytes = st.task.received
          st.lastBytesAt = now
        }
        emitSoon()
      })
      // 服务端提前断开/字节不足：该分段未写满，视为失败
      const segLen = part.to - part.from
      const incomplete = () => {
        if (st.halt !== 'none') return resolve()
        if ((st.partRecv || [])[i] < segLen) return reject(new Error(tr('m.dl.errSeqEof')))
      }
      res.on('end', () => {
        incomplete()
        file.end()
      })
      res.on('error', incomplete)
      file.on('error', incomplete)
      file.on('finish', () => resolve())
    })
    st.reqs.push(req)
    req.on('error', e => (st.halt !== 'none' ? resolve() : reject(e)))
  })
}

/** 将各分段按顺序拼成最终文件并清理分段产物 */
async function concatParts(st: TaskState): Promise<void> {
  const tmp = st.task.dest + '.downloading'
  const out = fs.createWriteStream(tmp)
  // 顺序写入：每段作为可读流灌入 `out`（自带背压），`end` 即表示该段字节已全部排队写入
  for (const p of st.parts!) {
    await new Promise<void>((res, rej) => {
      const rs = fs.createReadStream(p.path)
      rs.on('error', rej)
      rs.on('data', d => { if (!out.write(d)) rs.pause() })
      rs.on('end', () => res())
      out.on('drain', () => rs.resume())
    })
  }
  await new Promise<void>(res => out.end(() => res()))
  if (st.halt !== 'none') return
  for (const p of st.parts!) { try { fs.rmSync(p.path, { force: true }) } catch { /* noop */ } }
  try { fs.rmSync(st.partsFile!, { force: true }) } catch { /* noop */ }
  fs.rmSync(st.task.dest, { force: true })
  fs.renameSync(tmp, st.task.dest)
  st.task.status = 'completed'
  st.task.speed = 0
  comfy.pushLog('sys', tr('m.dl.logDone', { path: st.task.dest }))
  emitNow()
  setTimeout(() => {
    const cur = states.get(st.task.dest)
    if (cur && cur.task.status === 'completed') {
      states.delete(st.task.dest)
      emitNow()
    }
  }, 3000)
}

async function runTask(st: TaskState): Promise<void> {
  st.halt = 'none'
  st.task.status = 'downloading'
  st.task.error = undefined
  st.lastBytes = st.task.received
  st.lastBytesAt = Date.now()
  emitNow()
  try {
    if (!st.parts) {
      const probe = await probeSource(st.task.url, st)
      if (st.halt !== 'none') return
      if (probe.range && probe.total >= PARALLEL_MIN) {
        buildSegments(st, probe.total)
        st.task.received = (st.partRecv || []).reduce((a, b) => a + b, 0)
        await runSegmented(st)
      } else {
        // 单连接：不预填 total，以 GET 响应 content-length 为准（HEAD 可能不准）
        await requestOnce(st, 5)
      }
    } else {
      await runSegmented(st)
    }
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
  // HF 源开关：调用方未显式指定时跟随「设置」里的 hfMirror
  const useHfMirror = opts.useHfMirror ?? loadSettings().hfMirror
  const url = normalizeUrl(opts.url, useHfMirror)
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
    halt: 'none',
    reqs: [],
    files: []
  }
  if (states.has(dest)) return { ...states.get(dest)!.task } // 同目标已在下载中：直接返回
  states.set(dest, st)
  comfy.pushLog(
    'sys',
    useHfMirror
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
  haltAll(st)
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
  haltAll(st)
  for (const p of st.parts ?? []) { try { fs.rmSync(p.path, { force: true }) } catch { /* noop */ } }
  try { fs.rmSync(st.partsFile!, { force: true }) } catch { /* noop */ }
  try { fs.rmSync(st.task.dest + '.downloading', { force: true }) } catch { /* noop */ }
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

/** 终止当前任务所有活跃请求与写入流（保留分段/临时文件，供暂停续传） */
function haltAll(st: TaskState): void {
  for (const r of st.reqs.splice(0)) r.destroy()
  for (const f of st.files.splice(0)) f.destroy()
}

/** 全部暂停：暂停所有正在下载的任务 */
export function pauseAllDownloads(): void {
  for (const st of [...states.values()]) pauseDownload(st.task.id)
}

/** 全部开始：继续所有已暂停的任务，并重试失败的任务 */
export function resumeAllDownloads(): void {
  for (const st of [...states.values()]) resumeDownload(st.task.id)
}

/** 全部停止：取消所有任务并清理未完成的临时文件（已完成的仅从列表移除） */
export function cancelAllDownloads(): void {
  for (const st of [...states.values()]) cancelDownload(st.task.id)
}
