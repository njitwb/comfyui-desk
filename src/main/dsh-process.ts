import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { DEFAULT_DSH_PORT } from '../shared/api'
import type { DshInfo, DshStatus } from '../shared/api'
import { loadSettings } from './settings'
import { mcpEntry, mcpExecutable } from './agent-process'
import { dshEndpointFile, dshHome } from './dsh-paths'
import { killTree } from './util'
import { comfy } from './process'
import { t } from './i18n'

/**
 * 打包后 dsh 依赖树所在目录（electron-builder 的 extraResources 落到 resources/dsh）；
 * 开发态用仓库里的 canvas/dsh。
 */
export function dshRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'dsh') : path.join(app.getAppPath(), 'canvas', 'dsh')
}

/** dsh 启动器入口 */
export function dshEntry(): string {
  return path.join(dshRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * 随包 Node 22 运行时。不能复用 Electron 自带的 Node：Electron 33 只有 20.18.3，
 * 而 dsh 要求 ^22.19 || >=24，低于要求时 dsh 会静默退出（退出码 0、无任何输出）。
 */
export function nodeRuntime(): string {
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'node-runtime', name)
    : path.join(app.getAppPath(), 'resources', 'node-runtime', name)
}

/** 注入画布 MCP 的 --patch 覆盖层文件 */
export function dshPatchFile(): string {
  return path.join(dshHome(), 'canvas-mcp.patch.yml')
}

/**
 * 随包 pnpm。dsh 的 plugin 命令（插件市场靠它执行 pnpm add 装插件）直接调 `pnpm`，
 * 而随包 Node 运行时刻意只取了可执行文件、不含 npm/pnpm，所以单独分发一份。
 */
export function pnpmRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'pnpm') : path.join(app.getAppPath(), 'resources', 'pnpm')
}

/**
 * pnpm 的 PATH 垫片目录（运行期生成）。
 *
 * 为什么不在构建期固化：垫片里要写死随包 Node 与 pnpm 入口的绝对路径，而这些路径
 * 只有安装后才确定（AppImage 每次运行的挂载点还会变）。放 userData 而不是安装目录，
 * 避免写入可能只读的位置。
 */
export function ensurePnpmShimDir(): string {
  const dir = path.join(app.getPath('userData'), 'pnpm-bin')
  const node = nodeRuntime()
  const entry = path.join(pnpmRoot(), 'bin', 'pnpm.mjs')
  const file = path.join(dir, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const body = process.platform === 'win32' ? `@echo off\r\n"${node}" "${entry}" %*\r\n` : `#!/bin/sh\nexec "${node}" "${entry}" "$@"\n`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, body, { encoding: 'utf-8', mode: 0o755 })
  } catch (e) {
    comfy.pushLog('sys', t('m.dsh.pnpmShimFailed', { msg: e instanceof Error ? e.message : String(e) }))
  }
  return dir
}

/** dsh profile 的 package.json：插件依赖记在这里（dsh plugin add 写入） */
function dshProfileFile(): string {
  return path.join(dshHome(), 'profiles', 'web', 'package.json')
}

/** 该插件是否已装进 profile */
export function dshPluginInstalled(pkg: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(dshProfileFile(), 'utf8')) as { dependencies?: Record<string, string> }
    return Boolean(parsed.dependencies?.[pkg])
  } catch {
    return false
  }
}

/**
 * 随包附带、首次运行自动安装的 dsh 插件。
 *
 * - dshmarket：插件市场（dshmarket.com 的客户端，装完在 dsh 设置里出现「插件市场」）
 *
 * 技能不走第三方插件：dsh 自带 skill 能力（`skills/list` 远程方法 + 磁盘上的
 * SKILL.md 发现），画布侧直接读它即可。实测 `dsh-skills-manager@0.2.0` 的 peerDependencies
 * 要求 dsh 0.1.x，与随包的 0.2.0-rc.2 不兼容（安装会被 dsh 直接拒绝），故不纳入。
 */
const REQUIRED_DSH_PLUGINS = ['dshmarket']

/**
 * dsh 子进程（boot 与 plugin 两条命令）共用的环境。
 *
 * - 去掉 ELECTRON_RUN_AS_NODE：父进程是 Electron，这个变量只对 Electron 二进制有意义
 * - PATH 前插 pnpm 垫片目录：dsh plugin 内部直接调 pnpm，不垫就会「pnpm was not found」
 * - PNPM_HOME / store 落到 userData，否则会退回 /tmp 或系统全局目录
 */
function dshChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: dshHome() }
  delete env.ELECTRON_RUN_AS_NODE
  env.PATH = `${ensurePnpmShimDir()}${path.delimiter}${env.PATH || ''}`
  env.PNPM_HOME = path.join(app.getPath('userData'), 'pnpm-home')
  env.npm_config_store_dir = path.join(app.getPath('userData'), 'pnpm-store')
  return env
}

/**
 * 用随包 Node 执行 `dsh plugin add`。
 *
 * 环境必须与 dsh 子进程完全一致（见 dshChildEnv）：pnpm 垫片在 PATH 上、PNPM_HOME 与 store
 * 落在 userData —— dsh 的 plugin 命令内部直接调 pnpm，缺了就会以「pnpm was not found」失败。
 */
function installDshPlugin(pkg: string, timeoutMs = 300000): Promise<boolean> {
  return new Promise(resolve => {
    const env = dshChildEnv()
    const child = spawn(nodeRuntime(), [dshEntry(), 'plugin', '--profile', 'web', 'add', pkg], {
      cwd: dshHome(),
      windowsHide: true,
      env
    })
    let output = ''
    const collect = (d: Buffer): void => {
      output += d.toString('utf-8')
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      child.kill()
      comfy.pushLog('sys', t('m.dsh.pluginInstallFailed', { name: pkg, msg: 'timeout' }))
    }, timeoutMs)
    child.on('error', e => {
      clearTimeout(timer)
      comfy.pushLog('sys', t('m.dsh.pluginInstallFailed', { name: pkg, msg: e.message }))
      resolve(false)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) comfy.pushLog('sys', t('m.dsh.pluginInstallFailed', { name: pkg, msg: output.trim().split('\n').slice(-3).join(' | ').slice(0, 300) }))
      resolve(code === 0)
    })
  })
}

/** 从 dsh stdout 的 "dsh web: <url>" 行里取出带一次性 token 的 Web UI 地址 */
export function parseDshUrl(line: string): string | null {
  const m = line.match(/dsh web:\s*(https?:\/\/\S+)/)
  return m ? m[1] : null
}

/** YAML 单引号标量：只把 ' 转义成 ''；不能用双引号（Windows 路径里的反斜杠会被当转义符） */
function yamlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * 生成「打通画布」的 patch 覆盖层：把 canvas-agent 的 MCP stdio 入口注册成 dsh 的 MCP server，
 * 于是 harness 里的 agent 直接拿到全部 canvas_* 工具（工具名形如 mcp__canvas__canvas_get_state）。
 *
 * 用 --patch 而不是写 $DSH_HOME/profiles/web/cordis.patch.yml：前者是启动器解析的单次覆盖层，
 * 优先级最高，且完全不碰 dsh 自己初始化/重写的 profile 文件。
 */
export function buildPatchYaml(): string {
  const entry = mcpEntry()
  return [
    '# 由 ComfyUI 桌面管家生成，每次启动 Harness 时重写，请勿手动编辑。',
    '# 作用：把画布的本地伴生服务注册成 MCP server，使 harness 内 agent 能直接操作画布。',
    '- insert:',
    '    - id: mcp-canvas',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: canvas',
    '        transport: stdio',
    `        command: ${yamlStr(mcpExecutable())}`,
    '        args:',
    `          - ${yamlStr(entry)}`,
    "          - 'mcp'",
    '        env:',
    "          ELECTRON_RUN_AS_NODE: '1'",
    "          CANVAS_EMBEDDED: '1'",
    ''
  ].join('\n')
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
 * DeepSeek Harness（dsh）Web 服务的生命周期管理。
 *
 * 只支持 managed 一种归属：dsh 的 Web 地址带一次性进程 token，复用别人的实例拿不到 token，
 * 因此端口被占用时直接报错而不是「复用」。
 */
class DshProcess extends EventEmitter {
  private child: ChildProcess | null = null
  status: DshStatus = 'stopped'
  private port = DEFAULT_DSH_PORT
  private url = ''
  private error = ''

  getInfo(): DshInfo {
    const running = this.status === 'running'
    return {
      status: this.status,
      port: this.port,
      url: running ? this.url : '',
      home: dshHome(),
      error: this.error
    }
  }

  private setStatus(s: DshStatus): void {
    this.status = s
    this.emit('status', s)
  }

  /** 等 dsh 在 stdout 打印 Web 地址（最长 60s；dsh 首次初始化 profile 会慢一些） */
  private async waitForUrl(): Promise<string | null> {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      if (this.url) return this.url
      if (!this.child) return null
      await new Promise(r => setTimeout(r, 200))
    }
    return null
  }

  /**
   * 补齐随包必需的 dsh 插件（插件市场 / 技能管理）。
   *
   * 只在缺失时安装，失败只记日志、不阻断 Harness 启动：这两个插件是增强项，
   * 缺了 dsh 本体照样能跑（用户也可以之后在设置里手动装）。
   */
  private async ensurePlugins(): Promise<void> {
    // 没有随包 pnpm 就直接跳过：插件安装必然失败，不必制造一串失败日志
    if (!fs.existsSync(path.join(pnpmRoot(), 'bin', 'pnpm.mjs'))) return
    for (const pkg of REQUIRED_DSH_PLUGINS) {
      if (dshPluginInstalled(pkg)) continue
      comfy.pushLog('sys', t('m.dsh.pluginInstalling', { name: pkg }))
      const ok = await installDshPlugin(pkg)
      if (ok) comfy.pushLog('sys', t('m.dsh.pluginInstalled', { name: pkg }))
    }
  }

  async start(): Promise<DshInfo> {
    if (this.child || this.status === 'running') return this.getInfo()
    const s = loadSettings()
    this.port = Number(s.dshPort) > 0 ? Number(s.dshPort) : DEFAULT_DSH_PORT
    this.url = ''
    this.error = ''

    const node = nodeRuntime()
    const entry = dshEntry()
    if (!fs.existsSync(node)) {
      this.error = t('m.dsh.nodeMissing', { path: node })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }
    if (!fs.existsSync(entry)) {
      this.error = t('m.dsh.entryMissing', { path: entry })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }
    if (await portInUse(this.port)) {
      this.error = t('m.dsh.portInUse', { port: String(this.port) })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }

    // 每次启动都重写 patch：安装目录/版本变化后 mcpEntry() 指向的路径可能不同
    const patch = dshPatchFile()
    try {
      fs.mkdirSync(path.dirname(patch), { recursive: true })
      fs.writeFileSync(patch, buildPatchYaml(), 'utf-8')
    } catch (e) {
      this.error = t('m.dsh.patchFailed', { msg: e instanceof Error ? e.message : String(e) })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      return this.getInfo()
    }

    this.setStatus('starting')
    comfy.pushLog('sys', t('m.dsh.starting', { port: String(this.port) }))

    const env = dshChildEnv()

    // 首次运行先补齐必需插件（插件市场 / 技能管理）：装完 dsh 才会把它们挂进这次 boot
    await this.ensurePlugins()

    const child = spawn(
      node,
      [entry, '--profile', 'web', '--patch', patch, '--port', String(this.port), '--no-open'],
      { cwd: dshHome(), windowsHide: true, env }
    )
    this.child = child

    const onData = (d: Buffer): void => {
      for (const ln of d.toString('utf-8').split(/\r?\n/)) {
        if (!ln) continue
        const parsed = parseDshUrl(ln)
        if (parsed) this.url = parsed
        comfy.pushLog('sys', t('m.dsh.logLine', { text: ln }))
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', e => {
      this.error = t('m.dsh.error', { msg: e.message })
      comfy.pushLog('sys', this.error)
      this.setStatus('error')
      this.child = null
    })
    child.on('close', code => {
      comfy.pushLog('sys', t('m.dsh.exited', { code: String(code) }))
      if (this.status !== 'error' && this.status !== 'stopped') this.setStatus(code === 0 ? 'stopped' : 'error')
      this.child = null
    })

    const url = await this.waitForUrl()
    if (!url) {
      if (this.status !== 'error') {
        this.error = t('m.dsh.timeout', { port: String(this.port) })
        comfy.pushLog('sys', this.error)
        this.setStatus('error')
      }
      if (this.child) {
        killTree(this.child.pid)
        this.child = null
      }
      return this.getInfo()
    }
    this.setStatus('running')
    comfy.pushLog('sys', t('m.dsh.ready', { port: String(this.port) }))
    this.writeEndpoint()
    return this.getInfo()
  }

  /**
   * 把带 token 的端点写到交接文件，供 canvas-agent 以同一进程身份调 dsh 的 /api。
   * 失败不影响 Harness 标签自身（那个标签直接用 this.url），只是画布里的 agent 会不可用。
   */
  private writeEndpoint(): void {
    try {
      fs.writeFileSync(
        dshEndpointFile(),
        JSON.stringify({ url: this.url, token: this.tokenOfUrl(), port: this.port, updatedAt: Date.now() }, null, 2),
        { encoding: 'utf-8', mode: 0o600 }
      )
    } catch (e) {
      comfy.pushLog('sys', t('m.dsh.endpointFailed', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  private clearEndpoint(): void {
    try {
      fs.rmSync(dshEndpointFile(), { force: true })
    } catch {
      /* 清理失败不致命 */
    }
  }

  /** 从 Web 地址里取出一次性 token（?token=...） */
  private tokenOfUrl(): string {
    try {
      return new URL(this.url).searchParams.get('token') || ''
    } catch {
      return ''
    }
  }

  async stop(): Promise<DshInfo> {
    if (this.child) {
      comfy.pushLog('sys', t('m.dsh.stopping'))
      killTree(this.child.pid)
      this.child = null
    }
    this.clearEndpoint()
    this.url = ''
    this.error = ''
    this.setStatus('stopped')
    return this.getInfo()
  }

  async restart(): Promise<DshInfo> {
    await this.stop()
    await new Promise(r => setTimeout(r, 500))
    return this.start()
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

export const dsh = new DshProcess()
