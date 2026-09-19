import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({
  userData: '',
  runMock: vi.fn<(cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ code: number; out: string; err: string }>>()
}))
vi.mock('electron', () => electronMockFactory(() => h.userData))
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, run: h.runMock, gitExe: () => 'git' }
})

type SettingsModule = typeof import('../src/main/settings')
type NodesModule = typeof import('../src/main/nodes')

let settings: SettingsModule
let nodes: NodesModule
let userData: string
let nodesRoot: string

const ok = { code: 0, out: '', err: '' }
const mkNode = (name: string, opts: { git?: boolean; remote?: string } = {}) => {
  const dir = path.join(nodesRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  if (opts.git) fs.mkdirSync(path.join(dir, '.git'))
  return dir
}

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  h.runMock.mockReset()
  settings = await freshImport<SettingsModule>('../src/main/settings')
  const root = path.join(userData, 'runtime')
  settings.saveSettings({ installPath: root })
  nodesRoot = settings.paths().customNodes
  nodes = await import('../src/main/nodes')
})

afterEach(() => rmTmpDir(userData))

describe('listNodes', () => {
  it('目录不存在返回空', async () => {
    expect(await nodes.listNodes()).toEqual([])
  })

  it('列出节点、识别 git 仓库并读取 remote', async () => {
    mkNode('b-node', { git: true })
    mkNode('a-node')
    mkNode('.hidden', { git: true })
    mkNode('__pycache__', { git: true })
    h.runMock.mockResolvedValue({ code: 0, out: 'https://github.com/x/b-node.git\n', err: '' })

    const list = await nodes.listNodes()
    expect(list.map(n => n.name)).toEqual(['a-node', 'b-node']) // 名称排序
    expect(list[1].git).toBe(true)
    expect(list[1].remote).toBe('https://github.com/x/b-node.git')
    expect(list[0].git).toBe(false)
    expect(list[0].remote).toBe('')
  })
})

describe('installNode', () => {
  const noop = (): void => {}

  it('拒绝非 git 地址', async () => {
    await expect(nodes.installNode('not-a-url', noop)).rejects.toThrow('git 仓库地址')
    await expect(nodes.installNode('ftp://x.com/a', noop)).rejects.toThrow('git 仓库地址')
  })

  it('已存在同名节点时报错', async () => {
    mkNode('my-node')
    await expect(nodes.installNode('https://github.com/x/my-node.git', noop)).rejects.toThrow('已存在')
  })

  it('从 URL 提取节点名（去 .git 与尾斜杠）', async () => {
    h.runMock.mockResolvedValue(ok)
    const name = await nodes.installNode('https://github.com/x/cool-node.git/', noop)
    expect(name).toBe('cool-node')
    expect(h.runMock.mock.calls[0][1]).toContain('clone')
    // 原样透传（含尾斜杠），不做改写
    expect(h.runMock.mock.calls[0][1].some(a => String(a).startsWith('https://github.com/x/cool-node.git'))).toBe(true)
  })

  it('支持 git@ 形式地址', async () => {
    h.runMock.mockResolvedValue(ok)
    const name = await nodes.installNode('git@github.com:x/scp-node.git', noop)
    expect(name).toBe('scp-node')
  })

  it('克隆失败清理目录并报错', async () => {
    h.runMock.mockResolvedValue({ code: 1, out: '', err: 'fatal: repo not found' })
    await expect(nodes.installNode('https://github.com/x/bad.git', noop)).rejects.toThrow('克隆失败')
    expect(fs.existsSync(path.join(nodesRoot, 'bad'))).toBe(false)
  })

  it('克隆成功后安装 requirements.txt 依赖', async () => {
    h.runMock.mockImplementation(async (_cmd, args) => {
      // 模拟 git clone 落盘出 requirements.txt
      if (args[0] === 'clone') {
        const dest = args[args.length - 1]
        fs.mkdirSync(dest, { recursive: true })
        fs.writeFileSync(path.join(dest, 'requirements.txt'), 'numpy\n')
      }
      return ok
    })
    const events: string[] = []
    await nodes.installNode('https://github.com/x/with-deps.git', m => events.push(m))
    // 依赖安装走 pip install -r <requirements.txt>
    const pipCall = h.runMock.mock.calls.find(
      c => Array.isArray(c[1]) && c[1].includes('-r') && c[1].some(a => String(a).includes('requirements.txt'))
    )
    expect(pipCall).toBeTruthy()
    expect(events.join('\n')).toContain('requirements.txt')
    expect(events.join('\n')).toContain('安装完成')
  })
})

describe('updateNode / updateAllNodes', () => {
  const noop = (): void => {}

  it('节点不存在报错', async () => {
    await expect(nodes.updateNode('ghost', noop)).rejects.toThrow('不存在')
  })

  it('非 git 仓库不能更新', async () => {
    mkNode('plain')
    await expect(nodes.updateNode('plain', noop)).rejects.toThrow('不是 git 仓库')
  })

  it('git pull 失败抛出错误', async () => {
    mkNode('n1', { git: true })
    h.runMock.mockResolvedValue({ code: 1, out: '', err: 'conflict' })
    await expect(nodes.updateNode('n1', noop)).rejects.toThrow('更新失败')
  })

  it('updateAllNodes 汇总成功与失败', async () => {
    mkNode('good', { git: true })
    mkNode('bad', { git: true })
    mkNode('plain') // 非 git 不参与
    h.runMock.mockImplementation(async (_cmd, args, opts) => {
      if (args[0] === 'remote') return ok
      if (args[0] === 'pull' && opts?.cwd?.includes('bad')) return { code: 1, out: '', err: 'boom' }
      return ok
    })
    const r = await nodes.updateAllNodes(() => {})
    expect(r.ok).toEqual(['good'])
    expect(r.failed).toEqual(['bad'])
  })
})

describe('removeNode', () => {
  it('删除存在的节点目录', () => {
    mkNode('rm-me')
    nodes.removeNode('rm-me')
    expect(fs.existsSync(path.join(nodesRoot, 'rm-me'))).toBe(false)
  })

  it('不存在的节点不报错', () => {
    expect(() => nodes.removeNode('ghost')).not.toThrow()
  })
})
