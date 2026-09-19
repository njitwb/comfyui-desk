import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { electronMockFactory } from './helpers'
import { RELEASES_URL, checkAppUpdate, installUpdate, pickInstallerAsset, parseSha256 } from '../src/main/updater'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  version: '1.0.0'
}))

vi.mock('electron', () => electronMockFactory(() => '', { app: { getVersion: () => h.version } }))
vi.mock('node:https', () => ({ default: { get: h.get } }))

/** 构造一次 https.get 响应：cb 收到 res 后同步触发 data/end（与真实回调顺序一致） */
function mockResponse(body: unknown, statusCode = 200): void {
  h.get.mockImplementation((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
    res.statusCode = statusCode
    res.headers = {}
    const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: () => void }
    req.setTimeout = () => {}
    req.destroy = () => {}
    setTimeout(() => {
      cb(res)
      res.emit('data', JSON.stringify(body))
      res.emit('end')
    }, 0)
    return req
  })
}

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/njitwb/comfyui-desk/releases/tag/${tag}`,
  body: '修复若干问题',
  published_at: '2026-09-01T10:00:00Z',
  ...extra
})

const asset = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  browser_download_url: `https://github.com/njitwb/comfyui-desk/releases/download/v1.1.0/${name}`,
  size: 80 * 1024 * 1024,
  digest: 'sha256:' + 'a'.repeat(64),
  ...extra
})

beforeEach(() => {
  h.version = '1.0.0'
  h.get.mockReset()
})

describe('checkAppUpdate', () => {
  it('远端版本更高时给出更新提示与 release 信息', async () => {
    mockResponse(release('v1.1.0', { assets: [asset('comfyui-desk-1.1.0-x64.exe'), asset('comfyui-desk-1.1.0-x64.zip')] }))
    const r = await checkAppUpdate()
    expect(r.current).toBe('1.0.0')
    expect(r.latest).toBe('1.1.0')
    expect(r.hasUpdate).toBe(true)
    expect(r.url).toContain('/releases/tag/v1.1.0')
    expect(r.notes).toBe('修复若干问题')
    expect(r.publishedAt).toBe('2026-09-01T10:00:00Z')
    expect(r.error).toBe('')
    expect(r.asset?.name).toBe('comfyui-desk-1.1.0-x64.exe')
    expect(r.asset?.digest).toBe('sha256:' + 'a'.repeat(64))
    expect(r.asset?.size).toBe(80 * 1024 * 1024)
  })

  it('release 未提供安装包时 asset 为 null', async () => {
    mockResponse(release('v1.1.0', { assets: [asset('comfyui-desk-1.1.0-x64.zip')] }))
    expect((await checkAppUpdate()).asset).toBeNull()
  })

  it('版本相同或更低时不提示更新', async () => {
    mockResponse(release('v1.0.0'))
    expect((await checkAppUpdate()).hasUpdate).toBe(false)
    mockResponse(release('v0.9.0'))
    expect((await checkAppUpdate()).hasUpdate).toBe(false)
  })

  it('小版本号比较按数值而非字典序', async () => {
    h.version = '1.9.0'
    mockResponse(release('v1.10.0'))
    expect((await checkAppUpdate()).hasUpdate).toBe(true)
  })

  it('tag 带 V 前缀与空白也可识别', async () => {
    mockResponse(release('  V1.2.3  '))
    const r = await checkAppUpdate()
    expect(r.latest).toBe('1.2.3')
    expect(r.hasUpdate).toBe(true)
  })

  it('仓库尚无 release（404）按「暂无发布」处理，不算失败', async () => {
    mockResponse({}, 404)
    const r = await checkAppUpdate()
    expect(r.latest).toBe('')
    expect(r.hasUpdate).toBe(false)
    expect(r.error).toBe('')
    expect(r.url).toBe(RELEASES_URL)
  })

  it('接口返回非 2xx 时记录错误', async () => {
    mockResponse({}, 403)
    const r = await checkAppUpdate()
    expect(r.error).toBe('HTTP 403')
    expect(r.hasUpdate).toBe(false)
    expect(r.url).toBe(RELEASES_URL)
  })

  it('网络异常时记录错误并回退到 releases 页面', async () => {
    h.get.mockImplementation(() => {
      throw new Error('offline')
    })
    const r = await checkAppUpdate()
    expect(r.error).toBe('offline')
    expect(r.hasUpdate).toBe(false)
    expect(r.url).toBe(RELEASES_URL)
  })

  it('响应体不是合法 JSON 时记录错误', async () => {
    h.get.mockImplementation((_url: string, _opts: unknown, cb: (res: unknown) => void) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number }
      res.statusCode = 200
      const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; destroy: () => void }
      req.setTimeout = () => {}
      req.destroy = () => {}
      setTimeout(() => {
        cb(res)
        res.emit('data', '<html>')
        res.emit('end')
      }, 0)
      return req
    })
    expect((await checkAppUpdate()).error).toBe('invalid json')
  })
})

describe('pickInstallerAsset', () => {
  it('优先选择 x64 安装包', () => {
    const picked = pickInstallerAsset([asset('comfyui-desk-1.1.0-ia32.exe'), asset('comfyui-desk-1.1.0-x64.exe')])
    expect(picked?.name).toBe('comfyui-desk-1.1.0-x64.exe')
  })

  it('排除 blockmap 与绿色版 zip', () => {
    const picked = pickInstallerAsset([
      asset('comfyui-desk-1.1.0-x64.exe.blockmap'),
      asset('comfyui-desk-1.1.0-x64.zip'),
      asset('comfyui-desk-1.1.0-x64.exe')
    ])
    expect(picked?.name).toBe('comfyui-desk-1.1.0-x64.exe')
  })

  it('没有 exe 时返回 null', () => {
    expect(pickInstallerAsset([asset('comfyui-desk-1.1.0-x64.zip')])).toBeNull()
    expect(pickInstallerAsset([])).toBeNull()
    expect(pickInstallerAsset()).toBeNull()
  })
})

describe('parseSha256', () => {
  it('解析标准摘要并统一为小写', () => {
    expect(parseSha256('sha256:' + 'AB'.repeat(32))).toBe('ab'.repeat(32))
  })

  it('格式不符时返回 null（表示无法校验）', () => {
    expect(parseSha256('')).toBeNull()
    expect(parseSha256('abc')).toBeNull()
    expect(parseSha256('md5:' + 'a'.repeat(32))).toBeNull()
    expect(parseSha256('sha256:' + 'z'.repeat(64))).toBeNull()
  })
})

describe('installUpdate', () => {
  it('开发模式下拒绝自动更新', async () => {
    await expect(installUpdate(() => {})).rejects.toThrow()
  })
})
