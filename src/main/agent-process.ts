import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { DEFAULT_CANVAS_AGENT_PORT } from '../shared/api'
import type { CanvasAgentInfo, CanvasAgentMcpConfig, CanvasAgentMode, CanvasAgentStatus } from '../shared/api'
import { loadSettings } from './settings'
import { dshEndpointFile } from './dsh-paths'
import { killTree } from './util'
import { isLinux } from './platform'
import { comfy } from './process'
import { t } from './i18n'

/** 伴生服务配置文件（与 canvas-agent 上游约定一致，位于用户主目录，0600 权限） */
export const AGENT_CONFIG_FILE = path.join(os.homedir(), '.infinite-canvas', 'canvas-agent.json')

/**
 * 伴生服务根目录。
 * 打包后位于 resources/canvas-agent —— 必须是 asar 外的真实目录：子进程入口、node_modules
 * 解析与 agent 内部 spawn 都依赖真实路径（见 electron-builder.yml 的 extraResources）。
 */
export function agentRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'canvas-agent') : path.join(app.getAppPath(), 'canvas', 'agent')
}

/** HTTP/SSE 伴生服务入口 */
export function agentEntry(): string {
  return path.join(agentRoot(), 'dist', 'index.js')
}

/** 读取伴生服务配置：连接 token 只存在于该文件（/config 接口刻意不返回 token），必须由宿主注入画布 */
export function readConfig(): { url: string; token: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf-8')) as { url?: unknown; token?: unknown }
    const token = typeof raw.token === 'string' ? raw.token : ''
    if (!token) return null
    return { url: typeof raw.url === 'string' ? raw.url : '', token }
  } catch {
    return null
  }
}

/** MCP 客户端要执行的程序：AppImage 的 execPath 每次运行都在变化的 /tmp/.mount_* 下，改用 $APPIMAGE */
export function mcpExecutable(): string {
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  return process.execPath
}

/** 打包后安装目录可能被挂载/只读，把伴生服务幂等复制到 userData 下的稳定目录（按应用版本隔离） */
export function stableAgentDir(): string {
  return path.join(app.getPath('userData'), 'canvas-agent', app.getVersion())
}

/**
 * MCP 配置引用的入口：开发态直接用源码目录，打包后复制到 userData 稳定副本。
 *
 * 副本只在「缺失」或「安装目录里的产物比副本新」时同步：早期实现只在缺失时复制，
 * 于是同一个应用版本重新打包后，MCP 仍会一直跑旧代码。
 */
export function mcpEntry(): string {
  if (!app.isPackaged) return agentEntry()
  const dest = stableAgentDir()
  const entry = path.join(dest, 'dist', 'index.js')
  const source = agentEntry()
  if (!fs.existsSync(entry) || modifiedMs(source) > modifiedMs(entry)) {
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(agentRoot(), dest, { recursive: true, force: true })
  }
  return entry
}

/** 取文件 mtime（毫秒）；取不到返回 0，比较时退化为「不更新」 */
function modifiedMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** spawn 子进程的参数（伴生服务入口；mcp 模式才需要额外的 "mcp" 参数） */
export function httpSpawnArgs(): string[] {
  return [agentEntry()]
}

/** 子进程环境：用 Electron 自带 Node 运行（免装 Node，无需联网），PORT 决定监听端口 */
export function nodeEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(port),
    // dsh 的端点交接文件：canvas-agent 的 harness 后端据此连上「同一个 dsh 进程」
    DSH_ENDPOINT_FILE: dshEndpointFile(),
    // 声明「画布内嵌在本应用里」：禁止 canvas_open 去开系统浏览器（默认地址是线上站点）
    CANVAS_EMBEDDED: '1'
  }
}

/** 生成 MCP 客户端配置（可直接粘贴进 MCP 客户端的 mcp.json） */
export function buildMcpConfig(): CanvasAgentMcpConfig {
  const entry = mcpEntry()
  const json = JSON.stringify(
    {
      mcpServers: {
        'canvas-agent': {
          command: mcpExecutable(),
          args: [entry, 'mcp'],
          env: { ELECTRON_RUN_AS_NODE: '1', CANVAS_EMBEDDED: '1' }
        }
      }
    },
    null,
    2
  )
  return { json, path: entry }
}

interface HealthResult {
  protocolVersion: number
}

/** 探测 /health：该路由豁免 token 与 Origin 校验，是唯一无需凭据的探活入口 */
async function probeHealth(port: number): Promise<HealthResult | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
    if (!res.ok) return null
    const body = (await res.json()) as { ok?: unknown; protocolVersion?: unknown }
    if (!body?.ok) return null
    return { protocolVersion: Number(body.protocolVersion) || 0 }
  } catch {
    return null
  }
}

/** 端口是否已被监听（能连上即占用） */
function portInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = net.createConnection({ host: '127.0.0.1', port })
    const done = (inUse: boolean): void => {
      sock.destroy()
      resolve(inUse)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(1500, () => done(false))
  })
}

/**
 * 无限画布伴生服务（canvas-agent）的生命周期管理。
 * 三种归属：stopped（未运行）、managed（本应用启动的子进程）、external（复用已在运行的实例）。
 * external 态下 stop/dispose 只解除关联，绝不结束用户的进程。
 */
class CanvasAgentProcess extends EventEmitter {
  private child: ChildProcess | null = null
  status: CanvasAgentStatus = 'stopped'
  mode: CanvasAgentMode = null
  private port = DEFAULT_CANVAS_AGENT_PORT
  private token = ''
  private protocolVersion = 0
  private error = ''

  getInfo(): CanvasAgentInfo {
    const running = this.status === 'running'
    return {
      status: this.status,
      mode: this.mode,
      port: this.port,
      url: running ? `http://127.0.0.1:${this.port}` : '',
      token: running ? this.token : '',
      protocolVersion: this.protocolVersion,
      error: this.error
    }
  }

  private setStatus(s: CanvasAgentStatus): void {
    this.status = s
    this.emit('status', s)
  }

  /** 轮询 /health 直到就绪（250ms 起，最长 20s）；子进程提前退出则立即放弃 */
  private async waitForReady(): Promise<HealthResult | null> {
    const deadline = Date.now() + 20000
    let delay = 250
    while (Date.now() < deadline) {
      const health = await probeHealth(this.port)
      if (health) return health
      if (!this.child) return null
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(Math.round(delay * 1.5), 1000)
    }
    return null
  }

  async start(): Promise<CanvasAgentInfo> {
    if (this.child || this.status === 'running') return this.getInfo()
    const s = loadSettings()
    this.port = Number(s.canvasAgentPort) > 0 ? Number(s.canvasAgentPort) : DEFAULT_CANVAS_AGENT_PORT
    this.error = ''
    if (Number(process.versions.node.split('.')[0]) < 18) {
      this.error = t('m.agent.nodeTooOld', { version: process.versions.node })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }
    if (!fs.existsSync(agentEntry())) {
      this.error = t('m.agent.entryMissing', { path: agentEntry() })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }
    // 1) 已有实例在跑 → 复用（用户手动 npx 起的，或上次应用退出后残留）
    const existing = await probeHealth(this.port)
    if (existing) {
      this.mode = 'external'
      this.protocolVersion = existing.protocolVersion
      this.token = readConfig()?.token || ''
      this.setStatus('running')
      comfy.pushLog('sys', t('m.agent.reused', { port: this.port }))
      return this.getInfo()
    }
    // 2) 端口被非 canvas-agent 程序占用 → 报错，绝不误杀
    if (await portInUse(this.port)) {
      this.mode = null
      this.error = t('m.agent.portInUse', { port: this.port })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }
    // 3) 拉起子进程
    this.setStatus('starting')
    comfy.pushLog('sys', t('m.agent.starting', { port: this.port }))
    const child = spawn(process.execPath, httpSpawnArgs(), {
      cwd: agentRoot(),
      windowsHide: true,
      env: nodeEnv(this.port)
    })
    this.child = child
    const onData = (d: Buffer): void => {
      for (const ln of d.toString('utf-8').split(/\r?\n/)) if (ln) comfy.pushLog('sys', t('m.agent.logLine', { text: ln }))
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', e => {
      this.error = t('m.agent.error', { msg: e.message })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      this.child = null
    })
    child.on('close', code => {
      comfy.pushLog('sys', t('m.agent.exited', { code: String(code) }))
      // 手动 stop 已置为 stopped；其余非零退出视为异常
      if (this.status !== 'error' && this.status !== 'stopped') this.setStatus(code === 0 ? 'stopped' : 'error')
      this.child = null
    })
    const health = await this.waitForReady()
    if (!health) {
      if (this.status !== 'error') {
        this.error = t('m.agent.timeout', { port: this.port })
        comfy.pushLog('sys', this.error)
        this.setStatus('error')
      }
      // 超时后子进程可能仍在半启动状态，结束它避免残留
      if (this.child) {
        killTree(this.child.pid)
        this.child = null
      }
      return this.getInfo()
    }
    this.mode = 'managed'
    this.protocolVersion = health.protocolVersion
    this.token = readConfig()?.token || ''
    this.setStatus('running')
    comfy.pushLog('sys', t('m.agent.ready', { port: this.port, version: String(health.protocolVersion) }))
    return this.getInfo()
  }

  async stop(): Promise<CanvasAgentInfo> {
    // 复用外部实例时 child 为空，只解除关联，不结束对方的进程
    if (this.child) {
      comfy.pushLog('sys', t('m.agent.stopping'))
      killTree(this.child.pid)
      this.child = null
    }
    this.mode = null
    this.protocolVersion = 0
    this.token = ''
    this.error = ''
    this.setStatus('stopped')
    return this.getInfo()
  }

  async restart(): Promise<CanvasAgentInfo> {
    await this.stop()
    await new Promise(r => setTimeout(r, 500))
    return this.start()
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

export const canvasAgent = new CanvasAgentProcess()