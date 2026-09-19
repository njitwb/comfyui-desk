import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({
  userData: '',
  runMock: vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ code: number; out: string; err: string }>>()
}))
vi.mock('electron', () => electronMockFactory(() => h.userData))
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, run: h.runMock, gitDir: () => null }
})

type SettingsModule = typeof import('../src/main/settings')
type PythonModule = typeof import('../src/main/python')

let settings: SettingsModule
let python: PythonModule
let userData: string

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  h.runMock.mockReset()
  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ installPath: path.join(userData, 'runtime') })
  python = await import('../src/main/python')
})

afterEach(() => rmTmpDir(userData))

describe('bundledPython', () => {
  it('与 resources/python 实际存在状态一致', async () => {
    const fs = await import('node:fs')
    const exists = fs.existsSync(path.join(process.cwd(), 'resources', 'python', 'python.exe'))
    const b = python.bundledPython()
    if (exists) {
      expect(b).not.toBeNull()
      expect(b!.bundled).toBe(true)
      expect(b!.path).toContain('python.exe')
    } else {
      expect(b).toBeNull()
    }
  })
})

describe('getPyTag', () => {
  it('解析 venv 解释器输出的 cp 标签', async () => {
    h.runMock.mockResolvedValue({ code: 0, out: 'cp312\n', err: '' })
    await expect(python.getPyTag()).resolves.toBe('cp312')
  })

  it('输出带多行噪声时取最后一行', async () => {
    h.runMock.mockResolvedValue({ code: 0, out: 'warning: something\ncp313\n', err: '' })
    await expect(python.getPyTag()).resolves.toBe('cp313')
  })

  it('无法识别时报错', async () => {
    h.runMock.mockResolvedValue({ code: 1, out: '', err: 'python not found' })
    await expect(python.getPyTag()).rejects.toThrow('无法识别')
  })
})

describe('venvEnv', () => {
  it('设置 VIRTUAL_ENV 并把 venv Scripts 放入 PATH 前部', () => {
    const env = python.venvEnv()
    const p = settings.paths()
    expect(env.VIRTUAL_ENV).toBe(p.venv)
    const parts = String(env.PATH).split(path.delimiter)
    // venvScripts 存在时才在最前；当前未创建 venv，PATH 至少保留系统 PATH
    expect(String(env.PATH)).toContain(String(process.env.PATH))
    void parts
  })

  it('venv Scripts 存在时排在 PATH 首位', async () => {
    const fs = await import('node:fs')
    fs.mkdirSync(settings.paths().venvScripts, { recursive: true })
    const env = python.venvEnv()
    expect(String(env.PATH).split(path.delimiter)[0]).toBe(settings.paths().venvScripts)
  })
})
