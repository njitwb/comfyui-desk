import fs from 'node:fs'
import path from 'node:path'
import { run, gitDir } from './util'
import type { PythonInfo } from '../shared/api'
import { paths } from './settings'
import { t } from './i18n'

let pyTagCache: string | null = null

/** venv 解释器的 wheel 标签（如 cp312），用于从镜像目录挑选匹配的 wheel */
export async function getPyTag(): Promise<string> {
  if (pyTagCache) return pyTagCache
  const p = paths()
  const r = await run(p.venvPython, ['-c', 'import sys; print("cp%d%d" % sys.version_info[:2])'], { timeoutMs: 20000 })
  const tag = (r.out.trim().split(/\r?\n/).pop() || '').trim()
  if (!/^cp\d+$/.test(tag)) throw new Error(t('m.py.tagUnrecognized', { detail: (r.err || r.out).slice(-120) }))
  return (pyTagCache = tag)
}

/** 打包进 resources 的便携 Python（实现零外部依赖） */
export function bundledPython(): PythonInfo | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'python', 'python.exe'),
    path.join(process.cwd(), 'resources', 'python', 'python.exe')
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return { version: 'bundled', path: c, bundled: true }
  }
  return null
}

/** 枚举可用 Python：便携版 → 已有 venv → py 启动器 → PATH */
export async function listPythons(): Promise<PythonInfo[]> {
  const out: PythonInfo[] = []
  const seen = new Set<string>()
  const push = async (exe: string) => {
    exe = exe.trim().replace(/^"|"$/g, '')
    if (!exe || seen.has(exe.toLowerCase()) || !fs.existsSync(exe)) return
    seen.add(exe.toLowerCase())
    try {
      const r = await run(exe, ['--version'], { timeoutMs: 8000 })
      const m = (r.out + r.err).match(/Python\s+([\d.]+)/)
      out.push({ version: m ? m[1] : t('m.py.versionUnknown'), path: exe })
    } catch {
      /* ignore */
    }
  }
  const b = bundledPython()
  if (b) out.push(b)
  const p = paths()
  if (fs.existsSync(p.venvPython)) await push(p.venvPython)
  try {
    const r = await run('py', ['-0p'], { timeoutMs: 8000 })
    for (const line of r.out.split(/\r?\n/)) {
      const m = line.match(/-\S+\s+\*?\s*(\S+python\.exe)/i)
      if (m) await push(m[1])
    }
  } catch {
    /* ignore */
  }
  try {
    const r = await run('where', ['python'], { timeoutMs: 8000 })
    for (const line of r.out.split(/\r?\n/)) {
      if (/python\.exe$/i.test(line.trim()) && !/WindowsApps/i.test(line)) await push(line)
    }
  } catch {
    /* ignore */
  }
  return out
}

/** 创建 venv（已存在则跳过）并升级 pip */
export async function ensureVenv(pythonExe: string, onData?: (s: string) => void): Promise<void> {
  const p = paths()
  if (!fs.existsSync(p.venvPython)) {
    fs.mkdirSync(p.root, { recursive: true })
    const r = await run(pythonExe, ['-m', 'venv', p.venv], { onData, timeoutMs: 180000 })
    if (r.code !== 0) throw new Error(t('m.py.venvFailed', { detail: (r.err || r.out).slice(-500) }))
  }
  await run(p.venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], { onData, timeoutMs: 180000 })
}

/** 运行 venv 内 pip */
export async function pip(
  args: string[],
  opts: {
    indexUrl?: string
    /** 平铺文件列表页作为补充包源（如阿里云 pytorch-wheels，非 PEP 503 索引） */
    findLinks?: string
    onData?: (s: string) => void
    timeoutMs?: number
  } = {}
): Promise<{ code: number; out: string }> {
  const p = paths()
  const final = ['-m', 'pip', ...args]
  if (opts.indexUrl) final.push('--index-url', opts.indexUrl)
  if (opts.findLinks) final.push('-f', opts.findLinks)
  // raw 进度条：非 TTY 环境下也持续输出百分比，让大文件下载进度可见
  final.push('--disable-pip-version-check', '--no-color', '--progress-bar', 'raw')
  const r = await run(p.venvPython, final, {
    onData: opts.onData,
    timeoutMs: opts.timeoutMs ?? 20 * 60 * 1000,
    // 强制 UTF-8，避免 Windows GBK 下报错信息乱码
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  })
  // out 合并 stderr：pip 的报错信息（如 No matching distribution found）写在 stderr 里
  return { code: r.code, out: r.out + r.err }
}

/** 终端 / 子进程环境：venv Scripts 与便携 git 置于 PATH 前部 */
export function venvEnv(): NodeJS.ProcessEnv {
  const p = paths()
  const gitCmd = gitDir() ? path.join(gitDir()!, 'cmd') : path.join(p.root, 'git', 'cmd')
  const extra = [p.venvScripts, gitCmd].filter(fs.existsSync)
  return { PATH: [...extra, process.env.PATH].join(path.delimiter), VIRTUAL_ENV: p.venv }
}
