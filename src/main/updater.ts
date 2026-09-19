import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { compareSemver } from './util'
import { comfy } from './process'
import { t } from './i18n'
import type { AppUpdateAsset, AppUpdateInfo, AppUpdateProgress } from '../shared/api'

/** 启动器自身的发布仓库 */
export const RELEASE_REPO = 'njitwb/comfyui-desk'
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`

interface GithubAsset {
  name: string
  browser_download_url: string
  size?: number
  digest?: string
}

interface GithubRelease {
  tag_name?: string
  html_url?: string
  body?: string
  published_at?: string
  assets?: GithubAsset[]
}

/** 最近一次检查结果：安装时复用，避免渲染层传 URL 进来 */
let lastCheck: AppUpdateInfo | null = null

/** GET GitHub API；仓库还没有 release 时接口返回 404，按「无发布」处理而非报错 */
function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'comfyui-desk', Accept: 'application/vnd.github+json' } }, res => {
      const code = res.statusCode || 0
      let data = ''
      res.on('data', d => (data += d))
      res.on('end', () => {
        if (code === 404) return resolve(null)
        if (code < 200 || code >= 300) return reject(new Error(`HTTP ${code}`))
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('invalid json'))
        }
      })
    })
    req.setTimeout(10000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/** 从 release 资源里挑出可静默安装的安装包（排除 blockmap 与绿色版 zip） */
export function pickInstallerAsset(assets: GithubAsset[] = []): GithubAsset | null {
  const exe = assets.filter(a => /\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name))
  return exe.find(a => /x64/i.test(a.name)) || exe[0] || null
}

function toAsset(a: GithubAsset | null): AppUpdateAsset | null {
  if (!a) return null
  return { name: a.name, url: a.browser_download_url, size: a.size || 0, digest: a.digest || '' }
}

/** 解析 GitHub 的 sha256 摘要（形如 sha256:xxx）；格式不符返回 null 表示无法校验 */
export function parseSha256(digest: string): string | null {
  return /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())?.[1]?.toLowerCase() ?? null
}

/** 检查最新 release 与当前版本的差异 */
export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  const current = app.getVersion()
  const base: AppUpdateInfo = {
    current,
    latest: '',
    hasUpdate: false,
    url: RELEASES_URL,
    notes: '',
    publishedAt: '',
    asset: null,
    error: ''
  }
  let info = base
  try {
    const rel = (await getJson(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`)) as GithubRelease | null
    const latest = (rel?.tag_name || '').trim().replace(/^v/i, '')
    if (latest) {
      info = {
        ...base,
        latest,
        hasUpdate: compareSemver(latest, current) > 0,
        url: rel?.html_url || RELEASES_URL,
        notes: (rel?.body || '').trim(),
        publishedAt: rel?.published_at || '',
        asset: toAsset(pickInstallerAsset(rel?.assets))
      }
    }
  } catch (e) {
    info = { ...base, error: (e as Error).message || 'unknown error' }
  }
  lastCheck = info
  return info
}

/** 下载安装包到 userData/updates，跟随重定向 */
function download(url: string, dest: string, onBytes: (n: number) => void, redirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'comfyui-desk' } }, res => {
      const code = res.statusCode || 0
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume()
        if (redirects <= 0) return reject(new Error('too many redirects'))
        return download(new URL(res.headers.location, url).toString(), dest, onBytes, redirects - 1).then(resolve, reject)
      }
      if (code !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${code}`))
      }
      const out = fs.createWriteStream(dest)
      res.on('data', d => onBytes(d.length))
      res.on('error', reject)
      out.on('error', reject)
      out.on('finish', () => out.close(() => resolve()))
      res.pipe(out)
    })
    req.setTimeout(30000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    fs.createReadStream(file)
      .on('data', d => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/** 下载 → 校验 → 静默安装；安装器接管后本进程退出，由安装器拉起新版本 */
export async function installUpdate(on: (e: AppUpdateProgress) => void): Promise<void> {
  if (!app.isPackaged) throw new Error(t('m.updater.devMode'))
  const asset = lastCheck?.asset
  if (!asset) throw new Error(t('m.updater.noAsset'))
  const version = lastCheck?.latest || ''

  const dir = path.join(app.getPath('userData'), 'updates')
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 旧安装包被占用时保留，直接覆盖写入 */
  }
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, asset.name.replace(/[^\w.-]/g, '_'))

  comfy.pushLog('sys', t('m.updater.logStart', { version, name: asset.name }))

  let received = 0
  let lastEmit = 0
  const report = (stage: AppUpdateProgress['stage'], message: string, force = false): void => {
    const percent = asset.size ? Math.min(99, Math.floor((received / asset.size) * 100)) : 0
    const now = Date.now()
    if (!force && now - lastEmit < 150) return
    lastEmit = now
    on({ stage, received, total: asset.size, percent, message })
  }

  try {
    report('download', t('m.updater.downloading', { percent: 0 }), true)
    await download(asset.url, file, n => {
      received += n
      report('download', t('m.updater.downloading', { percent: asset.size ? Math.floor((received / asset.size) * 100) : 0 }))
    })
  } catch (e) {
    fs.rmSync(file, { force: true })
    throw e
  }

  report('verify', t('m.updater.verifying'), true)
  const expect = parseSha256(asset.digest)
  if (expect) {
    const actual = await sha256(file)
    if (actual !== expect) {
      fs.rmSync(file, { force: true })
      throw new Error(t('m.updater.checksumFailed'))
    }
  }

  // 先停掉 ComfyUI，避免更新期间残留子进程占着端口
  await comfy.stop()
  on({
    stage: 'install',
    received: asset.size,
    total: asset.size,
    percent: 100,
    message: t('m.updater.installing')
  })

  // /S 静默安装 + --updated 升级语义 + --force-run 让安装器装完自动拉起应用
  spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 500)
}
