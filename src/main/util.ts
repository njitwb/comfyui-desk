import { spawn, execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { isWin } from './platform'

/** 内嵌便携 git 目录（打包在 resources/git，仅 Windows 随包分发），未安装返回 null */
export function gitDir(): string | null {
  if (!isWin) return null
  const candidates = [path.join(process.resourcesPath || '', 'git'), path.join(process.cwd(), 'resources', 'git')]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'cmd', 'git.exe'))) return c
  }
  return null
}

/** git 可执行文件：优先内嵌便携版，缺失时回退系统 PATH（POSIX 直接用系统 git） */
export function gitExe(): string {
  if (!isWin) return 'git'
  const d = gitDir()
  return d ? path.join(d, 'cmd', 'git.exe') : 'git'
}

export interface RunResult {
  code: number
  out: string
  err: string
  /** 是否被外部手动终止（如用户取消任务；区别于 timeout） */
  aborted?: boolean
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  onData?: (chunk: string) => void
  timeoutMs?: number
  /** 进程启动后暴露终止句柄，供外部（如取消安装）中止当前命令 */
  onSpawn?: (kill: () => void) => void
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
    let aborted = false
    /** 外部中止：杀进程树并 resolve 为 aborted 结果（await 方据此判断是用户取消而非失败） */
    const kill = (): void => {
      if (settled) return
      aborted = true
      settled = true
      if (timer) clearTimeout(timer)
      killTree(child.pid)
      resolve({ code: -1, out, err: err + '\n[aborted]', aborted: true })
    }
    opts.onSpawn?.(kill)
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

/** 按进程树结束进程（Windows 用 taskkill；POSIX 递归收集后代再逐一结束） */
export function killTree(pid?: number): void {
  if (!pid) return
  if (isWin) {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
    } catch {
      /* ignore */
    }
    return
  }
  killTreePosix(pid)
}

/** POSIX：通过 ps 快照递归收集 pid 的所有后代 pid 并逐一结束 */
function killTreePosix(pid: number): void {
  const tree = new Map<number, number[]>()
  try {
    const ps = execFileSync('ps', ['-Ao', 'ppid=,pid='], { encoding: 'utf8' })
    for (const line of ps.split('\n')) {
      const [pp, p] = line.trim().split(/\s+/).map(Number)
      if (!pp || !p) continue
      if (tree.has(pp)) tree.get(pp)!.push(p)
      else tree.set(pp, [p])
    }
  } catch {
    /* ps 不可用，只结束自身 */
  }
  const targets = new Set<number>()
  const collect = (): void => {
    const stack = [pid]
    while (stack.length) {
      const cur = stack.pop()!
      for (const c of tree.get(cur) || []) {
        targets.add(c)
        stack.push(c)
      }
    }
  }
  collect()
  const order = [...targets, pid]
  const signal = (sig: NodeJS.Signals): void => {
    for (const p of order) {
      try {
        process.kill(p, sig)
      } catch {
        /* 进程可能已退出 */
      }
    }
  }
  // 先温和结束，短暂宽限后强杀
  signal('SIGTERM')
  setTimeout(() => signal('SIGKILL'), 800)
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
