import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 内嵌便携 git 目录（打包在 resources/git），未安装返回 null */
export function gitDir(): string | null {
  const candidates = [path.join(process.resourcesPath || '', 'git'), path.join(process.cwd(), 'resources', 'git')]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'cmd', 'git.exe'))) return c
  }
  return null
}

/** git 可执行文件：优先内嵌便携版，缺失时回退系统 PATH */
export function gitExe(): string {
  const d = gitDir()
  return d ? path.join(d, 'cmd', 'git.exe') : 'git'
}

export interface RunResult {
  code: number
  out: string
  err: string
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  onData?: (chunk: string) => void
  timeoutMs?: number
}

/** 运行外部命令并收集输出（支持实时数据回调与超时） */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true
    })
    let out = ''
    let err = ''
    let settled = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          settled = true
          killTree(child.pid)
          resolve({ code: -1, out, err: err + '\n[timeout]' })
        }, opts.timeoutMs)
      : null
    child.stdout?.on('data', d => {
      const s = d.toString()
      out += s
      opts.onData?.(s)
    })
    child.stderr?.on('data', d => {
      const s = d.toString()
      err += s
      opts.onData?.(s)
    })
    child.on('error', e => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', code => {
      if (timer) clearTimeout(timer)
      if (!settled) resolve({ code: code ?? -1, out, err })
    })
  })
}

/** Windows 下按进程树结束进程 */
export function killTree(pid?: number): void {
  if (!pid) return
  try {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } catch {
    /* ignore */
  }
}

/** 按空格切分启动参数串（支持引号） */
export function splitArgs(s: string): string[] {
  const m = s.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return m.map(x => x.replace(/^["']|["']$/g, ''))
}

/** 语义化版本比较：a > b 返回正数，a < b 返回负数，相等返回 0（忽略 v 前缀，非数字段按 0） */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}
