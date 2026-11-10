import fs from 'node:fs'
import path from 'node:path'
import { run, gitExe } from './util'
import { paths, loadSettings, transformGitUrl, PIP_MIRRORS } from './settings'
import { pip } from './python'
import { t } from './i18n'
import type { NodeItem } from '../shared/api'

export type NodeEventFn = (message: string) => void

function nodesRoot(): string {
  return paths().customNodes
}

/** 取消令牌：各子进程启动时注册终止句柄；cancel 后逐个终止并置标记 */
export interface CancelToken {
  cancelled: boolean
  kills: (() => void)[]
}

export function createToken(): CancelToken {
  return { cancelled: false, kills: [] }
}

export function cancelToken(t: CancelToken): void {
  t.cancelled = true
  for (const k of t.kills.splice(0)) k()
}

/** 收集 run/pip 的终止句柄；已取消的安装不再发起新命令 */
function linkKill(t: CancelToken, kill: () => void): void {
  if (t.cancelled) {
    kill()
    return
  }
  t.kills.push(kill)
}

export async function listNodes(): Promise<NodeItem[]> {
  const root = nodesRoot()
  if (!fs.existsSync(root)) return []
  const items: NodeItem[] = []
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === '__pycache__') continue
    const dir = path.join(root, e.name)
    const git = fs.existsSync(path.join(dir, '.git'))
    let remote = ''
    if (git) {
      try {
        const r = await run(gitExe(), ['remote', 'get-url', 'origin'], { cwd: dir, timeoutMs: 5000 })
        remote = r.out.trim()
      } catch {
        /* ignore */
      }
    }
    items.push({ name: e.name, path: dir, git, remote })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export function nodeDirExists(key: string): boolean {
  return fs.existsSync(path.join(nodesRoot(), key))
}

/**
 * 按整合包清单安装节点：git clone（可指定分支/commit）后执行依赖安装。
 * 与 installNode 的区别：不因同名目录存在而抛错（调用方负责存在性判断），
 * 并支持 checkout 固定 commit，保证整合包可复现。
 */
export async function installNodeAtRef(
  key: string,
  source: { url: string; ref?: string; commit?: string },
  on: NodeEventFn,
  token?: CancelToken
): Promise<string> {
  if (!/^https?:\/\//.test(source.url) && !/^git@/.test(source.url)) throw new Error(t('m.nodes.invalidUrl'))
  if (!key.trim() || /[/\\]/.test(key) || key === '.' || key === '..') throw new Error(t('m.nodes.invalidUrl'))
  const root = nodesRoot()
  fs.mkdirSync(root, { recursive: true })
  const dest = path.join(root, key)
  if (fs.existsSync(dest)) return key
  if (token?.cancelled) throw new Error(t('m.nodes.cancelled'))
  const finalUrl = transformGitUrl(source.url)
  on(t('m.nodes.cloning', { url: finalUrl }))
  const args = ['clone', '--depth', '1']
  if (source.ref) args.push('--branch', source.ref)
  args.push(finalUrl, dest)
  const r = await run(gitExe(), args, {
    onData: on,
    timeoutMs: 30 * 60 * 1000,
    onSpawn: k => token && linkKill(token, k)
  })
  if (r.code !== 0) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(r.aborted ? t('m.nodes.cancelled') : t('m.nodes.cloneFailed', { msg: (r.err || r.out).slice(-300) }))
  }
  if (source.commit) {
    on(t('m.pack.logInstallNode', { name: `${key} @ ${source.commit.slice(0, 8)}` }))
    let c = await run(gitExe(), ['fetch', '--depth', '1', 'origin', source.commit], {
      cwd: dest,
      timeoutMs: 10 * 60 * 1000,
      onSpawn: k => token && linkKill(token, k)
    })
    if (c.code === 0) c = await run(gitExe(), ['checkout', source.commit], { cwd: dest, timeoutMs: 60000 })
    if (c.code !== 0) {
      // 浅克隆拿不到指定 commit 时退化为完整 fetch
      const full = await run(gitExe(), ['fetch', '--unshallow', 'origin'], {
        cwd: dest,
        timeoutMs: 20 * 60 * 1000,
        onSpawn: k => token && linkKill(token, k)
      })
      if (full.code === 0) c = await run(gitExe(), ['checkout', source.commit], { cwd: dest, timeoutMs: 60000 })
    }
    if (c.code !== 0) {
      fs.rmSync(dest, { recursive: true, force: true })
      throw new Error(t('m.nodes.cloneFailed', { msg: `checkout ${source.commit} failed` }))
    }
  }
  if (token?.cancelled) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(t('m.nodes.cancelled'))
  }
  await installDeps(dest, on, token)
  on(t('m.nodes.installDone', { name: key }))
  return key
}

/** 从整合包 payload 拷贝一个完整节点目录到 custom_nodes，然后执行依赖安装 */
export async function installNodeFromBundle(
  key: string,
  srcDir: string,
  on: NodeEventFn,
  token?: CancelToken
): Promise<string> {
  if (!key.trim() || /[/\\]/.test(key) || key === '.' || key === '..') throw new Error(t('m.nodes.invalidUrl'))
  if (!fs.existsSync(srcDir)) throw new Error(t('m.pack.errCopy', { path: srcDir }))
  const root = nodesRoot()
  fs.mkdirSync(root, { recursive: true })
  const dest = path.join(root, key)
  if (fs.existsSync(dest)) return key
  copyDirSafe(srcDir, dest)
  if (token?.cancelled) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(t('m.nodes.cancelled'))
  }
  await installDeps(dest, on, token)
  on(t('m.nodes.installDone', { name: key }))
  return key
}

/** 递归复制目录：跳过符号链接、__pycache__ 与 .git，避免把缓存/仓库带进运行环境 */
function copyDirSafe(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue
    if (e.name === '__pycache__' || e.name === '.git') continue
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDirSafe(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

/** 安装节点依赖：requirements.txt → install.py（整合包安装与节点安装共用） */
export async function installDeps(dir: string, on: NodeEventFn, token?: CancelToken): Promise<void> {
  const mirror = PIP_MIRRORS[loadSettings().pipMirror]
  const req = path.join(dir, 'requirements.txt')
  if (fs.existsSync(req)) {
    on(t('m.nodes.installDepsStart'))
    const r = await pip(['install', '-r', req, ...(mirror ? ['-i', mirror] : [])], {
      onData: on,
      timeoutMs: 30 * 60 * 1000,
      onSpawn: k => token && linkKill(token, k)
    })
    if (r.code !== 0) on(t('m.nodes.depsWarn'))
  }
  const installer = path.join(dir, 'install.py')
  if (fs.existsSync(installer)) {
    on(t('m.nodes.runInstallPy'))
    await run(paths().venvPython, ['install.py'], {
      cwd: dir,
      onData: on,
      timeoutMs: 10 * 60 * 1000,
      onSpawn: k => token && linkKill(token, k)
    })
  }
}

/** git clone 安装自定义节点（自动套用代理前缀） */
export async function installNode(url: string, on: NodeEventFn, token?: CancelToken): Promise<string> {
  if (!/^https?:\/\//.test(url) && !/^git@/.test(url)) throw new Error(t('m.nodes.invalidUrl'))
  const root = nodesRoot()
  fs.mkdirSync(root, { recursive: true })
  const name = path.basename(url.replace(/\/+$/, '')).replace(/\.git$/i, '')
  const dest = path.join(root, name)
  if (fs.existsSync(dest)) throw new Error(t('m.nodes.exists', { name }))
  if (token?.cancelled) throw new Error(t('m.nodes.cancelled'))
  const finalUrl = transformGitUrl(url)
  on(t('m.nodes.cloning', { url: finalUrl }))
  const r = await run(gitExe(), ['clone', '--depth', '1', finalUrl, dest], {
    onData: on,
    timeoutMs: 30 * 60 * 1000,
    onSpawn: k => token && linkKill(token, k)
  })
  if (r.code !== 0) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(r.aborted ? t('m.nodes.cancelled') : t('m.nodes.cloneFailed', { msg: (r.err || r.out).slice(-300) }))
  }
  if (token?.cancelled) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(t('m.nodes.cancelled'))
  }
  await installDeps(dest, on, token)
  if (token?.cancelled) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(t('m.nodes.cancelled'))
  }
  on(t('m.nodes.installDone', { name }))
  return name
}

/** 批量安装：按顺序逐个安装；取消后中止剩余，返回已完成与失败列表 */
export async function installMany(
  urls: string[],
  on: NodeEventFn,
  token: CancelToken,
  onItem?: (name: string, status: string, error?: string) => void
): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = []
  const failed: string[] = []
  const nameOf = (url: string): string => path.basename(url.replace(/\/+$/, '')).replace(/\.git$/i, '')
  for (const rawUrl of urls) {
    if (token.cancelled) break
    const url = rawUrl.trim()
    if (!url) continue
    const name = nameOf(url)
    if (fs.existsSync(path.join(nodesRoot(), name))) {
      onItem?.(name, 'skipped')
      continue
    }
    onItem?.(name, 'installing')
    try {
      ok.push(await installNode(url, on, token))
      onItem?.(name, 'done')
    } catch (e) {
      onItem?.(name, token.cancelled ? 'cancelled' : 'failed', String((e as Error).message || e))
      failed.push(String((e as Error).message || e))
      if (token.cancelled) break
    }
  }
  return { ok, failed }
}

export async function updateNode(name: string, on: NodeEventFn): Promise<void> {
  const dir = path.join(nodesRoot(), name)
  if (!fs.existsSync(dir)) throw new Error(t('m.nodes.notFound', { name }))
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Error(t('m.nodes.notGitRepo'))
  on(t('m.nodes.updating', { name }))
  const r = await run(gitExe(), ['pull'], { cwd: dir, onData: on, timeoutMs: 15 * 60 * 1000 })
  if (r.code !== 0) throw new Error(t('m.nodes.updateFailed', { msg: (r.err || r.out).slice(-300) }))
  await installDeps(dir, on)
  on(t('m.nodes.updateDone', { name }))
}

export async function updateAllNodes(on: NodeEventFn): Promise<{ ok: string[]; failed: string[] }> {
  const nodes = (await listNodes()).filter(n => n.git)
  const ok: string[] = []
  const failed: string[] = []
  for (const n of nodes) {
    try {
      await updateNode(n.name, on)
      ok.push(n.name)
    } catch (e) {
      failed.push(n.name)
      on(t('m.nodes.itemFailed', { name: n.name, msg: (e as Error).message }))
    }
  }
  on(t('m.nodes.updateAllDone', { ok: ok.length, failed: failed.length }))
  return { ok, failed }
}

export function removeNode(name: string): void {
  const dir = path.join(nodesRoot(), name)
  if (!path.resolve(dir).startsWith(path.resolve(nodesRoot()))) throw new Error(t('m.nodes.invalidPath'))
  fs.rmSync(dir, { recursive: true, force: true })
}
