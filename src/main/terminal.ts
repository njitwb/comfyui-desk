import * as pty from 'node-pty'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { paths, loadSettings, PIP_MIRRORS } from './settings'
import { venvEnv } from './python'
import { gitDir } from './util'
import { isWin } from './platform'

interface ShellInfo {
  exe: string
  args: string[]
  label: string
}

let shellCache: ShellInfo | null = null

/** shell：Windows 优先便携 / 系统 Git Bash，缺失回退 PowerShell；POSIX 用用户 SHELL 或 bash */
function resolveShell(): ShellInfo {
  if (shellCache) return shellCache
  if (isWin) {
    const gd = gitDir()
    const bashCandidates = [gd ? path.join(gd, 'bin', 'bash.exe') : '', 'C:\\Program Files\\Git\\bin\\bash.exe'].filter(Boolean)
    for (const exe of bashCandidates) {
      if (fs.existsSync(exe)) return (shellCache = { exe, args: ['--login', '-i'], label: 'Git Bash' })
    }
    return (shellCache = { exe: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' })
  }
  // POSIX 用非 login 交互 shell（-i）：login shell（-l）会重读 /etc/profile 与 ~/.profile，
  // 重新构建 PATH，把下方 venvEnv() 注入的 venv bin 前缀丢掉，导致 python/pip 落到系统路径，
  // 触发 PEP 668 externally-managed 报错。非 login 交互会保留注入的 PATH，venv 才能生效。
  const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/bash'
  const label = path.basename(shell) || 'Terminal'
  return (shellCache = { exe: shell, args: ['-i'], label })
}

/** 基于 ConPTY 的交互式终端会话（环境注入 venv PATH 与 pip 镜像） */
class TermService extends EventEmitter {
  private sessions = new Map<number, pty.IPty>()
  private seq = 0

  open(cols: number, rows: number): { id: number; shell: string } {
    const s = loadSettings()
    const p = paths()
    const cwd = fs.existsSync(p.comfy) ? p.comfy : os.homedir()
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
