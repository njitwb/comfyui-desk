import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({
  userData: '',
  runMock: vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ code: number; out: string; err: string }>>()
}))
vi.mock('electron', () => electronMockFactory(() => h.userData))
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, run: h.runMock, gitExe: () => 'git' }
})
// 断网环境：https 全部失败，验证静态兜底
vi.mock('node:https', () => ({
  default: {
    get: vi.fn(() => {
      throw new Error('offline')
    }),
    request: vi.fn(() => {
      throw new Error('offline')
    })
  }
}))

type SettingsModule = typeof import('../src/main/settings')
type InstallerModule = typeof import('../src/main/installer')

let settings: SettingsModule
let installer: InstallerModule
let userData: string

const LS_REMOTE = [
  'a1b2c3\trefs/tags/v0.3.59',
  'd4e5f6\trefs/tags/v0.3.60',
  '789abc\trefs/tags/v0.3.9',
  'def012\trefs/tags/v0.10.0',
  '345678\trefs/tags/v0.3.60', // 重复 tag 去重
  '901bcd\trefs/tags/beta-feature' // 非语义化 tag 过滤
].join('\n')

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  h.runMock.mockReset()
  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ installPath: path.join(userData, 'runtime') })
  installer = await import('../src/main/installer')
})

afterEach(() => rmTmpDir(userData))

describe('listComfyVersions', () => {
  it('从 git ls-remote 解析 tag 并按语义化版本降序', async () => {
    h.runMock.mockImplementation(async (_cmd, args) => {
      if (args[0] === '--version') return { code: 0, out: 'git version 2.45.0', err: '' }
      if (args[0] === 'ls-remote') return { code: 0, out: LS_REMOTE, err: '' }
      return { code: 1, out: '', err: '' }
    })
    const versions = await installer.listComfyVersions()
    expect(versions.slice(0, 4)).toEqual(['v0.10.0', 'v0.3.60', 'v0.3.59', 'v0.3.9'])
    expect(versions).not.toContain('beta-feature')
  })

  it('git 不可用且网络失败时返回静态兜底列表', async () => {
    h.runMock.mockResolvedValue({ code: 1, out: '', err: 'no git' })
    const versions = await installer.listComfyVersions()
    expect(versions).toContain('master')
    expect(versions.length).toBeGreaterThan(3)
  })

  it('ls-remote 无 tag 时走 API 兜底，API 也失败走静态兜底', async () => {
    h.runMock.mockImplementation(async (_cmd, args) => {
      if (args[0] === '--version') return { code: 0, out: 'git version 2.45.0', err: '' }
      if (args[0] === 'ls-remote') return { code: 0, out: '', err: '' }
      return { code: 1, out: '', err: '' }
    })
    const versions = await installer.listComfyVersions()
    expect(versions).toContain('master')
  })
})

describe('checkComfyUpdate', () => {
  const mockTags = () =>
    h.runMock.mockImplementation(async (_cmd, args) => {
      if (args[0] === '--version') return { code: 0, out: 'git version 2.45.0', err: '' }
      if (args[0] === 'ls-remote') return { code: 0, out: 'x\trefs/tags/v0.3.60\n', err: '' }
      return { code: 1, out: '', err: '' }
    })

  it('本地版本落后于最新 tag 时提示有更新', async () => {
    mockTags()
    settings.saveSettings({ comfyVersion: 'v0.3.50' })
    const r = await installer.checkComfyUpdate()
    expect(r.current).toBe('v0.3.50')
    expect(r.latest).toBe('v0.3.60')
    expect(r.hasUpdate).toBe(true)
  })

  it('本地已是最新时不提示', async () => {
    mockTags()
    settings.saveSettings({ comfyVersion: 'v0.3.60' })
    const r = await installer.checkComfyUpdate()
    expect(r.hasUpdate).toBe(false)
  })

  it('master 分支不参与比较', async () => {
    mockTags()
    settings.saveSettings({ comfyVersion: 'master' })
    const r = await installer.checkComfyUpdate()
    expect(r.hasUpdate).toBe(false)
  })

  it('优先读取 comfyui_version.py 的本地版本', async () => {
    mockTags()
    const comfyDir = settings.paths().comfy
    fs.mkdirSync(comfyDir, { recursive: true })
    fs.writeFileSync(path.join(comfyDir, 'comfyui_version.py'), '__version__ = "0.3.60"')
    settings.saveSettings({ comfyVersion: 'v0.3.50' })
    const r = await installer.checkComfyUpdate()
    expect(r.current).toBe('0.3.60')
    expect(r.hasUpdate).toBe(false)
  })
})

describe('listTorchIndexes', () => {
  it('网络失败时返回静态兜底（含 cpu 且在末尾）', async () => {
    const idx = await installer.listTorchIndexes()
    expect(idx[idx.length - 1]).toBe('cpu')
    expect(idx.every(t => /^(cu\d+|cpu)$/.test(t))).toBe(true)
  })
})

describe('installTorch 参数校验', () => {
  it('未知源直接报错，不触发子进程', async () => {
    await expect(installer.installTorch('bogus-index', () => {})).rejects.toThrow('未知的 torch 源')
    expect(h.runMock).not.toHaveBeenCalled()
  })

  it('合法源因离线最终失败时抛出聚合错误', async () => {
    h.runMock.mockResolvedValue({ code: 1, out: '', err: 'ERROR: Could not find a version' })
    await expect(installer.installTorch('cpu', () => {}, 0)).rejects.toThrow(/PyTorch 安装失败/)
  })
})

describe('installRequirements 镜像缺包回退', () => {
  const writeReq = () => {
    const dir = settings.paths().comfy
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'comfyui-workflow-templates-media-assets-02==0.1.3\n')
  }
  const indexOf = (args: string[]) => (args.includes('--index-url') ? args[args.indexOf('--index-url') + 1] : '')

  it('镜像报缺包时改用官方 PyPI 重跑', async () => {
    writeReq()
    settings.saveSettings({ pipMirror: 'tuna' })
    const calls: string[][] = []
    h.runMock.mockImplementation(async (_cmd, args) => {
      calls.push(args)
      if (calls.length === 1) {
        return { code: 1, out: '', err: 'ERROR: No matching distribution found for comfyui-workflow-templates-media-assets-02==0.1.3' }
      }
      return { code: 0, out: '', err: '' }
    })
    await installer.installRequirements(() => {})
    expect(indexOf(calls[0])).toBe('https://pypi.tuna.tsinghua.edu.cn/simple')
    expect(indexOf(calls[1])).toBe('')
  })

  it('镜像失败但不是缺包（如网络错误）时不重跑', async () => {
    writeReq()
    settings.saveSettings({ pipMirror: 'tuna' })
    const calls: string[][] = []
    h.runMock.mockImplementation(async (_cmd, args) => {
      calls.push(args)
      return { code: 1, out: '', err: 'WARNING: Retrying after connection broken' }
    })
    await expect(installer.installRequirements(() => {})).rejects.toThrow('依赖安装失败')
    expect(calls).toHaveLength(1)
  })
})

describe('installComfyUI 前置校验', () => {
  it('未选择安装路径时报错', async () => {
    settings.saveSettings({ installPath: '' })
    await expect(
      installer.installComfyUI({ pythonPath: 'py', version: 'master', torchIndex: 'cpu' }, () => {})
    ).rejects.toThrow('安装路径')
  })
})
