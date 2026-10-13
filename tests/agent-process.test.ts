import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory } from './helpers'

const h = vi.hoisted(() => ({ userData: '', home: '' }))

vi.mock('electron', () => electronMockFactory(() => h.userData))
// 把 homedir 指向临时目录：伴生服务配置文件路径即 ~/.infinite-canvas/canvas-agent.json
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  const patched = { ...actual, homedir: () => h.home }
  return { ...patched, default: patched }
})
// killTree 以真实 ps 收集进程树，测试里替换为 spy，便于断言「复用外部实例时不结束对方进程」
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, killTree: vi.fn() }
})

type AgentModule = typeof import('../src/main/agent-process')

let agentMod: AgentModule
let killTree: ReturnType<typeof vi.fn>
let userData: string
let home: string

function writeAgentConfig(obj: Record<string, unknown>): void {
  const file = path.join(home, '.infinite-canvas', 'canvas-agent.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj), 'utf-8')
}

/** 造出伴生服务入口文件（start 会先校验其存在） */
function fakeEntry(): string {
  const entry = agentMod.agentEntry()
  fs.mkdirSync(path.dirname(entry), { recursive: true })
  fs.writeFileSync(entry, '// fake', 'utf-8')
  return entry
}

/** 让 /health 探针成功返回（全局 fetch 打桩） */
function stubHealthOk(protocolVersion = 6): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, protocolVersion }) }))
  )
}

beforeEach(async () => {
  userData = mkTmpDir()
  home = mkTmpDir()
  h.userData = userData
  h.home = home
  vi.resetModules()
  stubHealthOk()
  const util = await import('../src/main/util')
  killTree = util.killTree as unknown as ReturnType<typeof vi.fn>
  killTree.mockClear()
  agentMod = await import('../src/main/agent-process')
  fakeEntry()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmTmpDir(userData)
  rmTmpDir(home)
})

describe('路径与参数（纯函数）', () => {
  it('开发态根目录指向源码 canvas/agent', () => {
    expect(agentMod.agentRoot()).toBe(path.join(h.userData, 'app', 'canvas', 'agent'))
  })

  it('spawn 参数为 dist/index.js 入口', () => {
    expect(agentMod.httpSpawnArgs()).toEqual([path.join(h.userData, 'app', 'canvas', 'agent', 'dist', 'index.js')])
  })

  it('子进程环境注入 ELECTRON_RUN_AS_NODE 与 PORT', () => {
    const env = agentMod.nodeEnv(18001)
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.PORT).toBe('18001')
  })

  it('MCP 可执行文件：无 $APPIMAGE 时用 process.execPath', () => {
    const prev = process.env.APPIMAGE
    delete process.env.APPIMAGE
    expect(agentMod.mcpExecutable()).toBe(process.execPath)
    if (prev !== undefined) process.env.APPIMAGE = prev
  })

  it('开发态 MCP 入口直接用源码目录，不复制', () => {
    expect(agentMod.mcpEntry()).toBe(agentMod.agentEntry())
  })

  it('buildMcpConfig 生成含稳定入口与 ELECTRON_RUN_AS_NODE 的 JSON', () => {
    const { json, path: entry } = agentMod.buildMcpConfig()
    expect(entry).toBe(agentMod.agentEntry())
    const parsed = JSON.parse(json) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }
    const server = parsed.mcpServers['canvas-agent']
    expect(server.command).toBe(process.execPath)
    expect(server.args).toEqual([entry, 'mcp'])
    expect(server.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

describe('readConfig', () => {
  it('配置文件缺失时返回 null', () => {
    expect(agentMod.readConfig()).toBeNull()
  })

  it('读取 url 与 token', () => {
    writeAgentConfig({ url: 'http://127.0.0.1:17371', token: 'abc123' })
    expect(agentMod.readConfig()).toEqual({ url: 'http://127.0.0.1:17371', token: 'abc123' })
  })

  it('缺少 token 时返回 null', () => {
    writeAgentConfig({ url: 'http://127.0.0.1:17371' })
    expect(agentMod.readConfig()).toBeNull()
  })
})

describe('start / stop', () => {
  it('/health 通 → 复用外部实例（external）且不 spawn、stop 不结束对方进程', async () => {
    writeAgentConfig({ url: 'http://127.0.0.1:17371', token: 'tok-external' })
    const info = await agentMod.canvasAgent.start()
    expect(info.status).toBe('running')
    expect(info.mode).toBe('external')
    expect(info.url).toBe('http://127.0.0.1:17371')
    expect(info.token).toBe('tok-external')
    expect(info.protocolVersion).toBe(6)
    expect(killTree).not.toHaveBeenCalled()

    await agentMod.canvasAgent.stop()
    expect(killTree).not.toHaveBeenCalled()
    expect(agentMod.canvasAgent.status).toBe('stopped')
  })

  it('入口文件缺失时报错且不 spawn', async () => {
    fs.rmSync(path.dirname(agentMod.agentEntry()), { recursive: true, force: true })
    const info = await agentMod.canvasAgent.start()
    expect(info.status).toBe('error')
    expect(info.error).toContain('未找到伴生服务文件')
    expect(killTree).not.toHaveBeenCalled()
  })
})