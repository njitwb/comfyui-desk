import * as pty from 'node-pty'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { paths, loadSettings, PIP_MIRRORS } from './settings'
import { venvEnv } from './python'
import { gitDir } from './util'

interface ShellInfo {
  exe: string
  args: string[]
  label: string
}

let shellCache: ShellInfo | null = null

/** shell 优先便携 / 系统 Git Bash（Linux 核心命令可用），缺失时回退 PowerShell */
function resolveShell(): ShellInfo {
  if (shellCache) return shellCache
  const gd = gitDir()
  const bashCandidates = [gd ? path.join(gd, 'bin', 'bash.exe') : '', 'C:\\Program Files\\Git\\bin\\bash.exe'].filter(Boolean)
  for (const exe of bashCandidates) {
    if (fs.existsSync(exe)) return (shellCache = { exe, args: ['--login', '-i'], label: 'Git Bash' })
  }
  return (shellCache = { exe: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' })
}

/** 基于 ConPTY 的交互式终端会话（环境注入 venv PATH 与 pip 镜像） */
class TermService extends EventEmitter {
  private sessions = new Map<number, pty.IPty>()
  private seq = 0

  open(cols: number, rows: number): { id: number; shell: string } {
    const s = loadSettings()
    const p = paths()
    const cwd = fs.existsSync(p.comfy) ? p.comfy : process.env.USERPROFILE || process.cwd()
    const pipIndex = PIP_MIRRORS[s.pipMirror]
    const sh = resolveShell()
    const id = ++this.seq
    const proc = pty.spawn(sh.exe, sh.args, {
      name: 'xterm-color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      cwd,
      env: {
        ...process.env,
        ...venvEnv(),
        PYTHONIOENCODING: 'utf-8',
        ...(pipIndex ? { PIP_INDEX_URL: pipIndex } : {})
      } as Record<string, string>
    })
    this.sessions.set(id, proc)
    proc.onData(d => this.emit('data', id, d))
    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.emit('exit', id, exitCode)
    })
    return { id, shell: sh.label }
  }

  write(id: number, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(Math.max(cols, 20), Math.max(rows, 5))
  }

  kill(id: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.kill()
    } catch {
      /* 会话可能已自行退出 */
    }
    this.sessions.delete(id)
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}

export const terminal = new TermService()
