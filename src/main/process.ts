import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { paths, loadSettings, isInstalled, PIP_MIRRORS, saveSettings } from './settings'
import { detectGpu } from './gpu'
import { killTree, splitArgs } from './util'
import { appendLog } from './logger'
import { t } from './i18n'
import type { ComfyStatus, LogLine } from '../shared/api'

const MAX_LOG = 5000

/** Python logging 与 tqdm 都写 stderr，按内容纠正分类，避免正常输出被着色为错误 */
function normalizeStream(stream: LogLine['stream'], line: string): LogLine['stream'] {
  if (stream !== 'stderr') return stream
  if (/\[(INFO|DEBUG)\]/i.test(line)) return 'stdout'
  if (/^\s*\d+%\|/.test(line)) return 'stdout'
  return stream
}

class ComfyProcess extends EventEmitter {
  private child: ChildProcess | null = null
  status: ComfyStatus = 'stopped'
  logs: LogLine[] = []

  pushLog(stream: LogLine['stream'], text: string): void {
    const line: LogLine = { ts: Date.now(), stream, text }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG)
    this.emit('log', line)
    appendLog(line)
  }

  private setStatus(s: ComfyStatus): void {
    this.status = s
    this.emit('status', s)
  }

  /** 端口已被占用（能连上即占用） */
  private portInUse(port: number): Promise<boolean> {
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

  /** 首次启动按最大显存自动选择 VRAM 模式并写入设置，仅执行一次 */
  private async applyAutoVramOnce(): Promise<void> {
    if (loadSettings().vramModeAutoApplied) return
    saveSettings({ vramModeAutoApplied: true })
    try {
      const gpus = await detectGpu()
      const vram = Math.max(0, ...gpus.filter(g => g.vendor === 'nvidia').map(g => g.vram))
      if (!vram) return
      const mode = vram < 4096 ? 'novram' : vram < 8192 ? 'lowvram' : ''
      if (!mode) return
      const tokens = loadSettings().launchArgs.split(/\s+/).filter(Boolean)
      if (!tokens.includes(`--${mode}`)) {
        saveSettings({ launchArgs: [...tokens, `--${mode}`].join(' ') })
        this.pushLog('sys', t('m.proc.autoVram', { vram: (vram / 1024).toFixed(1), mode }))
      }
    } catch {
      /* 检测失败不影响启动 */
    }
  }

  async start(): Promise<void> {
    if (this.child) throw new Error(t('m.proc.alreadyRunning'))
    if (!isInstalled()) throw new Error(t('m.proc.notInstalled'))
    const p = paths()
    if (!fs.existsSync(p.venvPython)) throw new Error(t('m.proc.venvMissing'))
    const args = ['-s', 'main.py', '--port', String(loadSettings().port), '--windows-standalone-build']
    await this.applyAutoVramOnce()
    const s = loadSettings()
    if (s.modelPath) args.push('--extra-model-paths-config', 'extra_model_paths.yaml')
    const userArgs = splitArgs(s.launchArgs)
    this.writeExtraModelPaths()
    this.setStatus('starting')
    this.pushLog('sys', t('m.proc.starting', { cmd: `${p.venvPython} ${args.concat(userArgs).join(' ')}` }))
    if (await this.portInUse(s.port)) {
      this.pushLog('sys', t('m.proc.portInUse', { port: s.port }))
      this.pushLog('sys', t('m.proc.portInUseHint', { port: s.port }))
      this.setStatus('error')
      return
    }
    // PIP_INDEX_URL 让 Manager 启动时装的节点依赖也走国内镜像
    const pipIndex = PIP_MIRRORS[s.pipMirror]
    const child = spawn(p.venvPython, args.concat(userArgs), {
      cwd: p.comfy,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        ...(s.hfMirror ? { HF_ENDPOINT: 'https://hf-mirror.com' } : {}),
        ...(pipIndex ? { PIP_INDEX_URL: pipIndex } : {})
      }
    })
    this.child = child
    const onData = (stream: LogLine['stream']) => (d: Buffer) => {
      for (const ln of d.toString('utf-8').split(/\r?\n/)) {
        if (!ln) continue
        this.pushLog(normalizeStream(stream, ln), ln)
        // 仅以 To see the GUI 判定就绪：端口绑定失败时也会打印 Starting server
        if (/To see the GUI go to:/i.test(ln)) this.setStatus('running')
      }
    }
    child.stdout?.on('data', onData('stdout'))
    child.stderr?.on('data', onData('stderr'))
    child.on('error', e => {
      this.pushLog('sys', t('m.proc.error', { msg: e.message }))
      this.setStatus('error')
      this.child = null
    })
    child.on('close', code => {
      this.pushLog('sys', t('m.proc.exited', { code: String(code) }))
      // 手动 stop 已置为 stopped；其余非零退出视为异常
      if (this.status !== 'error' && this.status !== 'stopped') this.setStatus(code === 0 ? 'stopped' : 'error')
      this.child = null
    })
  }

  /** 设置独立模型目录时生成 extra_model_paths.yaml 供 ComfyUI 读取 */
  private writeExtraModelPaths(): void {
    const s = loadSettings()
    if (!s.modelPath) return
    let yaml = 'launcher:\n  base_path: ' + s.modelPath.replace(/\\/g, '/') + '\n'
    for (const dir of ['checkpoints', 'clip', 'clip_vision', 'configs', 'controlnet', 'diffusion_models', 'embeddings', 'loras', 'style_models', 'text_encoders', 'unet', 'upscale_models', 'vae', 'vae_approx']) {
      yaml += `  ${dir}: ${dir}\n`
    }
    try {
      fs.writeFileSync(path.join(paths().comfy, 'extra_model_paths.yaml'), yaml, 'utf-8')
    } catch {
      /* ignore */
    }
  }

  async stop(): Promise<void> {
    if (!this.child) return
    this.pushLog('sys', t('m.proc.stopping'))
    killTree(this.child.pid)
    this.child = null
    this.setStatus('stopped')
  }

  async restart(): Promise<void> {
    await this.stop()
    await new Promise(r => setTimeout(r, 800))
    await this.start()
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

export const comfy = new ComfyProcess()
