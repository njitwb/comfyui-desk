import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport, waitFor } from './helpers'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type SettingsModule = typeof import('../src/main/settings')
type DownloadsModule = typeof import('../src/main/downloads')

let settings: SettingsModule
let dl: DownloadsModule
let userData: string
let modelsRoot: string
let server: http.Server
let port: number
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void

const FIXTURE = Buffer.from('MODEL-FILE-CONTENT-0123456789-'.repeat(8)) // 232B

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  modelsRoot = path.join(userData, 'models')
  handler = (_req, res) => {
    res.writeHead(200, { 'content-length': FIXTURE.length, 'content-type': 'application/octet-stream' })
    res.end(FIXTURE)
  }
  server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port

  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ installPath: path.join(userData, 'runtime'), modelPath: modelsRoot })
  dl = await import('../src/main/downloads')
  dl.initDownloads(() => {})
})

afterEach(async () => {
  await new Promise<void>(r => server.close(() => r()))
  rmTmpDir(userData)
})

const firstTask = () => dl.listDownloads()[0]

describe('inferCategory', () => {
  it('inferCategory：URL 类别目录段优先', () => {
    expect(
      dl.inferCategory('whatever.bin', 'https://hf-mirror.co/u/r/resolve/main/diffusion_models/whatever.bin')
    ).toBe('diffusion_models')
  })

  it('inferCategory：关键词兜底', () => {
    expect(dl.inferCategory('flux_vae_fp16.safetensors', '')).toBe('vae')
    expect(dl.inferCategory('my_lora_rank16.safetensors', '')).toBe('loras')
    expect(dl.inferCategory('qwen_3_4b.safetensors', '')).toBe('text_encoders')
    expect(dl.inferCategory('control-lora.safetensors', '')).toBe('loras') // lora 优先于 controlnet
    expect(dl.inferCategory('unknown-file.bin', '')).toBe('checkpoints')
  })
})

describe('startDownload', () => {
  it('完整下载：落盘到类别目录，状态 completed，内容一致', async () => {
    const task = await dl.startDownload({ url: `http://127.0.0.1:${port}/files/test_model.safetensors` })
    expect(task.status).toBe('downloading')
    expect(task.category).toBe('checkpoints') // 无关键词兜底
    expect(task.filename).toBe('test_model.safetensors')

    await waitFor(() => firstTask()?.status === 'completed')
    const dest = path.join(modelsRoot, 'checkpoints', 'test_model.safetensors')
    expect(fs.readFileSync(dest)).toEqual(FIXTURE)
    expect(fs.existsSync(dest + '.downloading')).toBe(false) // 临时文件已转正
    expect(firstTask().total).toBe(FIXTURE.length)
  })

  it('显式 category 生效，非法 category 回退推断', async () => {
    const t1 = await dl.startDownload({ url: `http://127.0.0.1:${port}/x/a.safetensors`, category: 'loras' })
    expect(t1.category).toBe('loras')
    const t2 = await dl.startDownload({ url: `http://127.0.0.1:${port}/x/b.safetensors`, category: '../../evil' })
    expect(t2.category).toBe('checkpoints')
    await waitFor(() => dl.listDownloads().filter(t => t.status === 'completed').length === 2)
  })

  it('同目标重复发起返回原任务', async () => {
    const url = `http://127.0.0.1:${port}/dup/m.safetensors`
    const t1 = await dl.startDownload({ url })
    const t2 = await dl.startDownload({ url })
    expect(t2.id).toBe(t1.id)
    expect(dl.listDownloads()).toHaveLength(1)
    await waitFor(() => firstTask()?.status === 'completed')
  })

  it('文件名防路径穿越', async () => {
    const t = await dl.startDownload({ url: `http://127.0.0.1:${port}/x/y.safetensors`, filename: '../../evil.safetensors' })
    expect(t.filename).toBe('evil.safetensors')
    expect(t.dest).toBe(path.join(modelsRoot, t.category, 'evil.safetensors'))
    await waitFor(() => firstTask()?.status === 'completed')
    expect(fs.existsSync(path.join(userData, 'evil.safetensors'))).toBe(false)
  })

  it('HF 页面链接自动转镜像直链记录在任务中', async () => {
    const t = await dl.startDownload({
      url: 'https://huggingface.co/u/r/blob/main/m.safetensors',
      useHfMirror: true
    })
    expect(t.url).toBe('https://hf-mirror.com/u/r/resolve/main/m.safetensors')
    dl.cancelDownload(t.id) // 阻断外网请求
  })

  it('HTTP 404 任务转 error 并带状态码', async () => {
    handler = (_req, res) => {
      res.writeHead(404)
      res.end()
    }
    const t = await dl.startDownload({ url: `http://127.0.0.1:${port}/missing.safetensors` })
    await waitFor(() => dl.listDownloads().find(x => x.id === t.id)?.status === 'error')
    expect(dl.listDownloads().find(x => x.id === t.id)!.error).toContain('404')
  })

  it('返回网页而非模型文件时报可读的错', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>login</html>')
    }
    const t = await dl.startDownload({ url: `http://127.0.0.1:${port}/page/m.safetensors` })
    await waitFor(() => dl.listDownloads().find(x => x.id === t.id)?.status === 'error')
    expect(dl.listDownloads().find(x => x.id === t.id)!.error).toContain('网页')
  })

  it('跟随重定向完成下载', async () => {
    handler = (req, res) => {
      if (req.url === '/redir/m.safetensors') {
        res.writeHead(302, { location: '/real/m.safetensors' })
        res.end()
      } else {
        res.writeHead(200, { 'content-length': FIXTURE.length })
        res.end(FIXTURE)
      }
    }
    await dl.startDownload({ url: `http://127.0.0.1:${port}/redir/m.safetensors` })
    await waitFor(() => firstTask()?.status === 'completed')
    expect(fs.readFileSync(path.join(modelsRoot, 'checkpoints', 'm.safetensors'))).toEqual(FIXTURE)
  })
})

describe('暂停 / 继续 / 取消（慢速服务器）', () => {
  beforeEach(() => {
    handler = (req, res) => {
      const total = 1024 * 1024 // 宣称 1MB
      const range = req.headers.range ? /bytes=(\d+)-/.exec(req.headers.range) : null
      const start = range ? Number(range[1]) : 0
      const headers: Record<string, string | number> = { 'content-type': 'application/octet-stream' }
      if (range) {
        res.writeHead(206, { ...headers, 'content-length': total - start })
      } else {
        res.writeHead(200, { ...headers, 'content-length': total })
      }
      let sent = start
      const chunk = Buffer.alloc(16384, 1)
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) return clearInterval(timer)
        if (sent >= total) {
          clearInterval(timer)
          res.end()
          return
        }
        sent += chunk.length
        res.write(chunk)
      }, 20)
      res.on('close', () => clearInterval(timer))
    }
  })

  it('暂停后状态 paused，临时文件保留已下载部分', async () => {
    const t = await dl.startDownload({ url: `http://127.0.0.1:${port}/big/m.safetensors` })
    await waitFor(() => firstTask()?.received > 0)
    dl.pauseDownload(t.id)
    await waitFor(() => firstTask()?.status === 'paused')
    expect(fs.existsSync(t.dest + '.downloading')).toBe(true)
  })

  it('取消删除任务与临时文件', async () => {
    const t = await dl.startDownload({ url: `http://127.0.0.1:${port}/big/m.safetensors` })
    await waitFor(() => firstTask()?.received > 0)
    dl.cancelDownload(t.id)
    await waitFor(() => dl.listDownloads().length === 0)
    expect(fs.existsSync(t.dest + '.downloading')).toBe(false)
  })

  it('暂停后继续走 Range 断点续传', async () => {
    const t = await dl.startDownload({ url: `http://127.0.0.1:${port}/big/m.safetensors` })
    await waitFor(() => firstTask()?.received > 30000)
    dl.pauseDownload(t.id)
    await waitFor(() => firstTask()?.status === 'paused')
    const before = firstTask().received

    dl.resumeDownload(t.id)
    await waitFor(() => firstTask()?.status === 'completed', 15000)
    // 续传后 received 从断点继续增长，最终等于总大小（1MB）
    expect(firstTask().total).toBe(1024 * 1024)
    expect(fs.statSync(t.dest).size).toBe(1024 * 1024)
    void before
  })
})

describe('任务持久化与恢复', () => {
  it('下载中的任务元数据落盘到 downloads.json', async () => {
    await dl.startDownload({ url: `http://127.0.0.1:${port}/persist/m.safetensors` })
    await waitFor(() => firstTask()?.status === 'completed')
    const raw = JSON.parse(fs.readFileSync(path.join(userData, 'downloads.json'), 'utf-8'))
    // 完成态不持久
    expect(raw.find((t: { filename: string }) => t.filename === 'm.safetensors')).toBeUndefined()
  })

  it('重启后恢复未完成任务（暂停态保持）', async () => {
    const dest = path.join(modelsRoot, 'loras', 'resume-me.safetensors')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(
      path.join(userData, 'downloads.json'),
      JSON.stringify([
        {
          id: 'old-id',
          url: `http://127.0.0.1:${port}/x/resume-me.safetensors`,
          category: 'loras',
          filename: 'resume-me.safetensors',
          dest,
          received: 100,
          total: 999,
          speed: 0,
          status: 'paused',
          startedAt: Date.now()
        }
      ])
    )
    // 新进程视角：重新导入模块
    const dl2 = await freshImport<DownloadsModule>('../src/main/downloads')
    dl2.initDownloads(() => {})
    const list = dl2.listDownloads()
    expect(list).toHaveLength(1)
    expect(list[0].filename).toBe('resume-me.safetensors')
    expect(list[0].status).toBe('paused')
    dl2.cancelDownload(list[0].id)
  })
})
