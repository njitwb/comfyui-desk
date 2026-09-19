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

/** 安装节点依赖：requirements.txt → install.py */
async function installDeps(dir: string, on: NodeEventFn): Promise<void> {
  const mirror = PIP_MIRRORS[loadSettings().pipMirror]
  const req = path.join(dir, 'requirements.txt')
  if (fs.existsSync(req)) {
    on(t('m.nodes.installDepsStart'))
    const r = await pip(['install', '-r', req, ...(mirror ? ['-i', mirror] : [])], {
      onData: on,
      timeoutMs: 30 * 60 * 1000
    })
    if (r.code !== 0) on(t('m.nodes.depsWarn'))
  }
  const installer = path.join(dir, 'install.py')
  if (fs.existsSync(installer)) {
    on(t('m.nodes.runInstallPy'))
    await run(paths().venvPython, ['install.py'], { cwd: dir, onData: on, timeoutMs: 10 * 60 * 1000 })
  }
}

/** git clone 安装自定义节点（自动套用代理前缀） */
export async function installNode(url: string, on: NodeEventFn): Promise<string> {
  if (!/^https?:\/\//.test(url) && !/^git@/.test(url)) throw new Error(t('m.nodes.invalidUrl'))
  const root = nodesRoot()
  fs.mkdirSync(root, { recursive: true })
  const name = path.basename(url.replace(/\/+$/, '')).replace(/\.git$/i, '')
  const dest = path.join(root, name)
  if (fs.existsSync(dest)) throw new Error(t('m.nodes.exists', { name }))
  const finalUrl = transformGitUrl(url)
  on(t('m.nodes.cloning', { url: finalUrl }))
  const r = await run(gitExe(), ['clone', '--depth', '1', finalUrl, dest], { onData: on, timeoutMs: 30 * 60 * 1000 })
  if (r.code !== 0) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw new Error(t('m.nodes.cloneFailed', { msg: (r.err || r.out).slice(-300) }))
  }
  await installDeps(dest, on)
  on(t('m.nodes.installDone', { name }))
  return name
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
