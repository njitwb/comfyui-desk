import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({
  userData: '',
  children: [] as Array<{
    on: (ev: string, cb: (...a: unknown[]) => void) => void
    emitStdout: (s: string) => void
    emitStderr: (s: string) => void
    emitClose: (code: number) => void
    emitError: (e: Error) => void
  }>
}))

vi.mock('electron', () => electronMockFactory(() => h.userData))
vi.mock('../src/main/gpu', () => ({ detectGpu: async () => [] }))
vi.mock('node:child_process', async importOriginal => {
  const m = await importOriginal<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter()
    stderr = new EventEmitter()
    pid = 43210
    kill(): void {}
  }
  return {
    ...m,
    spawn: vi.fn(() => {
      const c = new FakeChild() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        pid: number
      }
      const rec = {
        on: c.on.bind(c),
        emitStdout: (s: string) => c.stdout.emit('data', Buffer.from(s)),
        emitStderr: (s: string) => c.stderr.emit('data', Buffer.from(s)),
        emitClose: (code: number) => c.emit('close', code),
        emitError: (e: Error) => c.emit('error', e)
      }
      h.children.push(rec)
      return c
    })
  }
})

type SettingsModule = typeof import('../src/main/settings')
type ProcessModule = typeof import('../src/main/process')

let settings: SettingsModule
let comfy: ProcessModule['comfy']
let userData: string

/** 搭建一个“已安装”的假 ComfyUI 目录结构 */
function fakeInstall(): void {
  const p = settings.paths()
  fs.mkdirSync(p.comfy, { recursive: true })
  fs.writeFileSync(path.join(p.comfy, 'main.py'), '# comfy')
  fs.mkdirSync(p.venvScripts, { recursive: true })
  fs.writeFileSync(p.venvPython, '')
}

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  h.children.length = 0
  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ installPath: path.join(userData, 'runtime'), port: 59761 })
  comfy = (await import('../src/main/process')).comfy
})

afterEach(async () => {
  await comfy.dispose().catch(() => {})
  rmTmpDir(userData)
})

describe('pushLog / 状态', () => {
  it('日志保留上限 5000 条', () => {
    for (let i = 0; i < 5100; i++) comfy.pushLog('stdout', `line-${i}`)
    expect(comfy.logs.length).toBe(5000)
    expect(comfy.logs[0].text).toBe('line-100')
    expect(comfy.logs[4999].text).toBe('line-5099')
  })

  it('pushLog 触发 log 事件并携带字段', () => {
    const seen: Array<{ stream: string; text: string }> = []
    comfy.on('log', l => seen.push({ stream: l.stream, text: l.text }))
    comfy.pushLog('sys', 'event test')
    expect(seen).toEqual([{ stream: 'sys', text: 'event test' }])
  })

  it('未安装时 start 报错', async () => {
    await expect(comfy.start()).rejects.toThrow('尚未安装')
    expect(comfy.status).toBe('stopped')
  })

  it('venv 缺失时报运行环境缺失', async () => {
    const p = settings.paths()
    fs.mkdirSync(p.comfy, { recursive: true })
    fs.writeFileSync(path.join(p.comfy, 'main.py'), '# comfy')
    await expect(comfy.start()).rejects.toThrow('运行环境缺失')
  })
})

describe('启动流程（mock 子进程）', () => {
  it('完整生命周期：starting → running（识别 GUI 行）→ 退出后 stopped', async () => {
    fakeInstall()
    const statuses: string[] = []
    comfy.on('status', s => statuses.push(s))
    await comfy.start()
    expect(comfy.status).toBe('starting')
    const child = h.children[0]
    child.emitStdout('Total VRAM 16384 MB\n')
    expect(comfy.status).toBe('starting')
    child.emitStdout('To see the GUI go to: http://127.0.0.1:59761\n')
    expect(comfy.status).toBe('running')
    child.emitClose(0)
    expect(comfy.status).toBe('stopped')
    expect(statuses).toEqual(['starting', 'running', 'stopped'])
  })

  it('已在运行中再次启动抛错', async () => {
    fakeInstall()
    await comfy.start()
    await expect(comfy.start()).rejects.toThrow('已在运行')
  })

  it('stderr 中的 [INFO] 日志归类为 stdout', async () => {
    fakeInstall()
    await comfy.start()
    const child = h.children[0]
    child.emitStderr('[INFO] Loading checkpoint\n')
    const line = comfy.logs[comfy.logs.length - 1]
    expect(line.stream).toBe('stdout')
  })

  it('stderr 中的 tqdm 进度行归类为 stdout', async () => {
    fakeInstall()
    await comfy.start()
    h.children[0].emitStderr(' 36%|███▌ | 393k/1.10M [00:01<00:02]\n')
    const line = comfy.logs[comfy.logs.length - 1]
    expect(line.stream).toBe('stdout')
  })

  it('真正的错误行保持 stderr', async () => {
    fakeInstall()
    await comfy.start()
    h.children[0].emitStderr('Traceback: RuntimeError boom\n')
    const line = comfy.logs[comfy.logs.length - 1]
    expect(line.stream).toBe('stderr')
  })

  it('非零退出码置为 error', async () => {
    fakeInstall()
    await comfy.start()
    h.children[0].emitClose(1)
    expect(comfy.status).toBe('error')
  })

  it('stop 后进程关闭，状态回到 stopped', async () => {
    fakeInstall()
    await comfy.start()
    await comfy.stop()
    expect(comfy.status).toBe('stopped')
  })

  it('启动命令包含端口与 -s 参数', async () => {
    fakeInstall()
    await comfy.start()
    const sysLine = comfy.logs.find(l => l.text.includes('[启动]'))
    expect(sysLine).toBeTruthy()
    expect(sysLine!.text).toContain('-s')
    expect(sysLine!.text).toContain('--port 59761')
    expect(sysLine!.text).toContain('main.py')
  })

  it('端口被占用时启动失败', async () => {
    fakeInstall()
    // 占用目标端口
    const net = await import('node:net')
    const server = net.createServer()
    await new Promise<void>(r => server.listen(59761, '127.0.0.1', r))
    const statuses: string[] = []
    comfy.on('status', s => statuses.push(s))
    await comfy.start()
    server.close()
    expect(comfy.status).toBe('error')
    expect(statuses).toEqual(['starting', 'error'])
    expect(comfy.logs.some(l => l.text.includes('端口 59761 已被占用'))).toBe(true)
  })
})
