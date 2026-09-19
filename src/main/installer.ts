import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { run, gitExe, compareSemver } from './util'
import {
  paths,
  loadSettings,
  comfyRepoUrl,
  PIP_MIRRORS,
  TORCH_FALLBACK,
  TorchIndex,
  saveSettings,
  transformGitUrl,
  installedVersion
} from './settings'
import type { ComfyUpdateInfo, TorchVariant } from '../shared/api'
import { ensureVenv, getPyTag, pip } from './python'
import { detectGpu } from './gpu'
import type { ProgressEvent, InstallOptions } from '../shared/api'
import { t } from './i18n'

export type ProgressFn = (e: ProgressEvent) => void

function emit(fn: ProgressFn, stage: string, message: string, percent: number): void {
  fn({ stage, message, percent })
}

async function gitAvailable(): Promise<boolean> {
  try {
    const r = await run(gitExe(), ['--version'], { timeoutMs: 8000 })
    return r.code === 0
  } catch {
    return false
  }
}

/** 语义化版本降序比较器（v0.10.0 > v0.9.0，避免字典序误判） */
function semverDesc(a: string, b: string): number {
  return compareSemver(b, a)
}

/** 可用的 ComfyUI 版本列表：git ls-remote → GitHub API → 静态兜底 */
export async function listComfyVersions(): Promise<string[]> {
  const s = loadSettings()
  const repo = comfyRepoUrl(s)
  if (await gitAvailable()) {
    try {
      const r = await run(gitExe(), ['ls-remote', '--tags', repo], { timeoutMs: 20000 })
      const tags = [...r.out.matchAll(/refs\/tags\/(v[\d.]+)\s*$/gm)].map(m => m[1])
      if (tags.length) return [...new Set(tags)].sort(semverDesc).slice(0, 30)
    } catch {
      /* ignore */
    }
  }
  // tags API 兜底：跟随当前 git 源，gitcode 源不再访问 GitHub
  const m = repo.replace(/\.git$/, '').match(/(?:github|gitcode)\.com[:/](.+)$/)
  if (m) {
    const api = repo.includes('gitcode.com')
      ? `https://gitcode.com/api/v5/repos/${m[1]}/tags?per_page=30`
      : `https://api.github.com/repos/${m[1]}/tags?per_page=30`
    try {
      const json = await httpsGetJson(api)
      const tags = (json as { name: string }[]).map(t => t.name).filter(n => /^v[\d.]+$/.test(n))
      if (tags.length) return [...new Set(tags)].sort(semverDesc).slice(0, 30)
    } catch {
      /* ignore */
    }
  }
  return ['v0.3.60', 'v0.3.59', 'v0.3.57', 'v0.3.50', 'v0.3.44', 'v0.3.40', 'v0.3.33', 'v0.2.7', 'v0.1.3', 'master']
}

/** 检查是否有新版本 ComfyUI：对比本地安装的语义化版本与最新 tag */
export async function checkComfyUpdate(): Promise<ComfyUpdateInfo> {
  const current = installedVersion() || loadSettings().comfyVersion
  const versions = await listComfyVersions()
  const latest = versions.find(v => /^v[\d.]+$/.test(v)) || ''
  // semverDesc(a, b) > 0 表示 b 版本更高；master 等非语义化版本不参与比较
  const semver = /^v?[\d.]+$/.test(current)
  const hasUpdate = !!latest && semver && semverDesc(current, latest) > 0
  return { current, latest, hasUpdate }
}

function httpsGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'comfyui-desk' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(httpsGetText(new URL(res.headers.location, url).toString()))
      }
      let data = ''
      res.on('data', d => (data += d))
      res.on('end', () => resolve(data))
    })
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function httpsGetJson(url: string): Promise<unknown> {
  return JSON.parse(await httpsGetText(url))
}

/** HEAD 请求：获取文件大小与是否支持 Range 分段 */
function httpHead(url: string): Promise<{ length: number; ranges: boolean; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'comfyui-desk' } }, res => {
      res.resume()
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpHead(new URL(res.headers.location, url).toString()))
      }
      if (res.statusCode !== 200) return reject(new Error('HEAD ' + res.statusCode))
      resolve({
        length: parseInt(String(res.headers['content-length'] || '0'), 10) || 0,
        ranges: String(res.headers['accept-ranges'] || '').toLowerCase().includes('bytes'),
        finalUrl: url
      })
    })
    req.setTimeout(15000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

/** 下载一个字节段到 part 文件；onBytes 回报本段已落盘字节总数 */
function downloadRangeOnce(
  url: string,
  start: number,
  end: number | null,
  file: string,
  onBytes: (n: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': 'comfyui-desk' }
    if (end !== null) headers.Range = `bytes=${start}-${end}`
    const req = https.get(url, { headers }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(downloadRangeOnce(new URL(res.headers.location, url).toString(), start, end, file, onBytes))
      }
      if ((end !== null && res.statusCode !== 206) || (end === null && res.statusCode !== 200)) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode))
      }
      const w = fs.createWriteStream(file)
      let n = 0
      res.on('data', (d: Buffer) => {
        n += d.length
        onBytes(n)
      })
      res.on('error', e => {
        w.destroy()
        reject(e)
      })
      w.on('error', reject)
      w.on('finish', () => resolve())
      res.pipe(w)
    })
    req.setTimeout(60000, () => req.destroy(new Error(t('m.installer.segIdleTimeout'))))
    req.on('error', reject)
  })
}

/** 下载一个段，失败自动重试一次 */
async function downloadRange(
  url: string,
  start: number,
  end: number | null,
  file: string,
  onBytes: (n: number) => void
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await downloadRangeOnce(url, start, end, file, onBytes)
    } catch (e) {
      fs.rmSync(file, { force: true })
      if (attempt === 1) throw e
    }
  }
}

/** 多连接分段并发下载（pip 单连接下 2GB wheel 只有 1~3MB/s） */
async function downloadSegmented(
  url: string,
  dest: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  const head = await httpHead(url)
  // 分段数自适应：目标每段 ≥64MB，上限 32 段（小文件不切，避免过多 HTTP 开销）
  const SEGMENTS = Math.min(32, Math.max(1, Math.ceil(head.length / (64 * 1024 * 1024))))
  const partFiles: string[] = []
  try {
    if (!head.ranges || SEGMENTS <= 1) {
      await downloadRange(head.finalUrl, 0, null, dest, n => onProgress(n, head.length || n))
      return
    }
    const segSize = Math.ceil(head.length / SEGMENTS)
    const doneBytes: number[] = []
    const jobs: Promise<void>[] = []
    let lastEmit = 0
    const report = () => {
      const now = Date.now()
      if (now - lastEmit < 300) return
      lastEmit = now
      onProgress(doneBytes.reduce((a, b) => a + b, 0), head.length)
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const start = i * segSize
      if (start >= head.length) break
      const part = `${dest}.part${i}`
      partFiles.push(part)
      doneBytes.push(0)
      const idx = i
      jobs.push(
        downloadRange(head.finalUrl, start, Math.min(start + segSize, head.length) - 1, part, n => {
          doneBytes[idx] = n
          report()
        })
      )
    }
    await Promise.all(jobs)
    const w = fs.createWriteStream(dest)
    try {
      for (const part of partFiles) {
        await new Promise<void>((resolve, reject) => {
          const r = fs.createReadStream(part)
          r.on('error', reject)
          w.on('error', reject)
          r.on('end', resolve)
          r.pipe(w, { end: false })
        })
      }
    } finally {
      await new Promise<void>(resolve => w.end(() => resolve()))
    }
    onProgress(head.length, head.length)
  } catch (e) {
    fs.rmSync(dest, { force: true })
    throw e
  } finally {
    for (const part of partFiles) fs.rmSync(part, { force: true })
  }
}

/** 在平铺 wheel 目录页中挑选指定包最新版、匹配当前解释器标签的 win_amd64 wheel */
function pickWheel(html: string, baseUrl: string, pkg: string, pyTag: string): { url: string; file: string } | null {
  const re = new RegExp(`${pkg}-(\\d[\\d.]*)[^"'<>\\s]*-${pyTag}-[^"'<>\\s]*-win_amd64\\.whl`, 'gi')
  let best: { file: string; ver: string } | null = null
  for (const m of html.matchAll(re)) {
    const ver = m[1]
    if (best && semverDesc(ver, best.ver) >= 0) continue
    best = { file: m[0].split('/').pop()!, ver }
  }
  if (!best) return null
  // href 中的 + 等字符常被 HTML 实体编码（如 &#43;），先解码还原真实文件名，再按 URL 规则编码
  const file = best.file.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&')
  return { url: `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(file)}`, file }
}

/** 解析当前可用的 CUDA/CPU 索引：官方源 → 阿里云镜像 → 静态兜底 */
export async function listTorchIndexes(): Promise<string[]> {
  for (const page of ['https://download.pytorch.org/whl/torch/', 'https://mirrors.aliyun.com/pytorch-wheels/']) {
    try {
      const html = await httpsGetText(page)
      const tags = [...new Set([...html.matchAll(/(cu\d+|cpu)\//g)].map(m => m[1]))]
      const cu = tags.filter(t => t.startsWith('cu')).sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)))
      if (cu.length) return [...cu.slice(0, 5), 'cpu']
    } catch {
      /* ignore */
    }
  }
  return TORCH_FALLBACK
}

/** 解析某 CUDA/CPU 源下匹配 venv Python 标签的最新 torch 版本（如 2.14.0+cu130） */
async function latestTorchVersion(idx: string, pyTag: string): Promise<string> {
  // URL 中 + 常被编码为 %2B 或 HTML 实体 &#43;，匹配后统一还原
  const re = new RegExp(`torch-([\\d.]+(?:%2B|\\+|&#43;)[a-z0-9.]+|[\\d.]+)-${pyTag}-${pyTag}-win_amd64`, 'gi')
  let best = ''
  for (const page of [`https://download.pytorch.org/whl/${idx}/torch/`, `https://mirrors.aliyun.com/pytorch-wheels/${idx}/`]) {
    try {
      const html = await httpsGetText(page)
      for (const m of html.matchAll(re)) {
        const ver = m[1].replace(/%2B|&#43;/gi, '+')
        if (!best || semverDesc(best, ver) > 0) best = ver
      }
    } catch {
      /* ignore */
    }
  }
  return best
}

/** 按 venv Python 版本解析各源可安装的最新 torch 版本；venv 缺失时退化为仅源标识 */
export async function listTorchVariants(): Promise<TorchVariant[]> {
  const indexes = await listTorchIndexes()
  let pyTag = ''
  try {
    pyTag = await getPyTag()
  } catch {
    /* venv 未创建等情况：无法精确匹配版本 */
  }
  if (!pyTag) return indexes.map(idx => ({ index: idx, torch: '' }))
  return Promise.all(indexes.map(async idx => ({ index: idx, torch: await latestTorchVersion(idx, pyTag) })))
}

/** 下载文件（支持重定向与进度回调） */
export function downloadFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void,
  redirects = 5
): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'comfyui-desk' } }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects <= 0) return reject(new Error(t('m.installer.tooManyRedirects')))
          const loc = new URL(res.headers.location, url).toString()
          return resolve(downloadFile(loc, dest, onProgress, redirects - 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(t('m.installer.httpDownloadFailed', { code: String(res.statusCode), url })))
        }
        const total = Number(res.headers['content-length'] || 0)
        let received = 0
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        const file = fs.createWriteStream(dest)
        res.on('data', d => {
          received += d.length
          onProgress?.(received, total)
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

/** 克隆 / 下载 ComfyUI 源码 */
async function fetchSource(version: string, on: ProgressFn): Promise<void> {
  const s = loadSettings()
  const p = paths()
  fs.mkdirSync(p.root, { recursive: true })
  const repo = comfyRepoUrl(s)

  if (fs.existsSync(path.join(p.comfy, '.git'))) {
    emit(on, t('m.installer.stageSource'), t('m.installer.repoExistsSwitch'), 12)
    await run(gitExe(), ['fetch', '--tags', '--depth', '1', 'origin', version === 'master' ? 'master' : `refs/tags/${version}`], { cwd: p.comfy })
    const r = await run(gitExe(), ['checkout', version], { cwd: p.comfy })
    if (r.code !== 0) throw new Error(t('m.installer.switchVersionFailed', { detail: (r.err || r.out).slice(-300) }))
    return
  }
  if (fs.existsSync(p.comfy)) fs.rmSync(p.comfy, { recursive: true, force: true })

  if (await gitAvailable()) {
    emit(
      on,
      t('m.installer.stageSource'),
      t('m.installer.cloneFrom', { source: s.gitMirror === 'github' ? 'GitHub' : 'GitCode', version }),
      8
    )
    const args = ['clone', '--depth', '1', '--progress']
    if (version !== 'master') args.push('--branch', version)
    args.push(repo, p.comfy)
    const r = await run(gitExe(), args, {
      onData: d => {
        const m = d.match(/(\d+)%/)
        if (m) emit(on, t('m.installer.stageSource'), d.trim().split('\n').pop() || '', 5 + Number(m[1]) * 0.2)
      },
      timeoutMs: 15 * 60 * 1000
    })
    if (r.code === 0) return
    emit(on, t('m.installer.stageSource'), t('m.installer.cloneFallback'), 12)
  }

  // 兜底：下载 zip 解压
  const zipUrl =
    s.gitMirror === 'gitcode'
      ? `https://gitcode.com/ComfyUI/ComfyUI/repository/archive.zip?ref=${version}`
      : `https://codeload.github.com/comfyanonymous/ComfyUI/zip/refs/${version === 'master' ? 'heads/master' : `tags/${version}`}`
  const zipPath = path.join(p.root, 'comfyui.zip')
  emit(on, t('m.installer.stageSource'), t('m.installer.downloadingZip'), 14)
  await downloadFile(zipUrl, zipPath, (recv, total) => {
    emit(
      on,
      t('m.installer.stageSource'),
      t('m.installer.downloadingMb', { mb: (recv / 1048576).toFixed(1) }),
      total ? 14 + (recv / total) * 8 : 16
    )
  })
  emit(on, t('m.installer.stageSource'), t('m.installer.extracting'), 23)
  const tmp = path.join(p.root, '_extract')
  fs.rmSync(tmp, { recursive: true, force: true })
  const r = await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`], { timeoutMs: 300000 })
  if (r.code !== 0) throw new Error(t('m.installer.extractFailed'))
  const inner = fs.readdirSync(tmp).map(d => path.join(tmp, d)).find(d => fs.statSync(d).isDirectory())
  if (!inner) throw new Error(t('m.installer.badArchive'))
  fs.renameSync(inner, p.comfy)
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })
}

function pipIndexArgs(): string[] {
  const s = loadSettings()
  const mirror = PIP_MIRRORS[s.pipMirror]
  return mirror ? ['-i', mirror] : []
}

/** 从镜像目录页解析三件套 wheel，多连接下载后交 pip 本地安装；false = 需回退 pip 直装 */
async function tryFastWheels(
  source: { label: string; indexUrl: string; findLinks?: string },
  on: ProgressFn,
  basePercent: number
): Promise<boolean> {
  if (!source.findLinks) return false
  const page = await httpsGetText(source.findLinks.replace(/\/+$/, '') + '/')
  if (!/\.whl/i.test(page)) return false
  const pyTag = await getPyTag()
  const pkgs = ['torch', 'torchvision', 'torchaudio']
  const wheels = pkgs.map(p => pickWheel(page, source.findLinks as string, p, pyTag))
  if (wheels.some(w => !w)) return false
  const cacheDir = path.join(paths().root, 'wheel-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const share = 20 / pkgs.length
  const files: string[] = []
  for (let i = 0; i < pkgs.length; i++) {
    const w = wheels[i] as { url: string; file: string }
    const dest = path.join(cacheDir, w.file)
    files.push(dest)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) {
      emit(
        on,
        t('m.installer.stageTorch'),
        t('m.installer.pkgCached', { pkg: pkgs[i] }),
        Math.min(basePercent + Math.round(share * (i + 1)), basePercent + 22)
      )
      continue
    }
    emit(on, t('m.installer.stageTorch'), t('m.installer.multiThreadDownload', { pkg: pkgs[i] }), basePercent + Math.round(share * i))
    await downloadSegmented(w.url, dest, (done, total) => {
      const mb = (n: number) => (n / 1048576).toFixed(0)
      emit(
        on,
        t('m.installer.stageTorch'),
        t('m.installer.pkgDownloading', { pkg: pkgs[i], done: mb(done), total: total ? mb(total) : '?' }),
        Math.min(basePercent + Math.round(share * (i + (total ? done / total : 0))), basePercent + 22)
      )
    })
  }
  emit(on, t('m.installer.stageTorch'), t('m.installer.installTorchToEnv'), basePercent + 23)
  const r = await pip(['install', ...files], {
    indexUrl: source.indexUrl,
    onData: d => emit(on, t('m.installer.stageTorch'), d.trim().split('\n').pop() || '', basePercent + 23),
    timeoutMs: 30 * 60 * 1000
  })
  return r.code === 0
}

/** 安装 torch：auto 依据显卡选最新 CUDA，否则 CPU；支持阿里云镜像多线程下载、官方源兜底 */
export async function installTorch(index: string, on: ProgressFn, basePercent = 45): Promise<void> {
  let idx = index
  if (idx === 'auto') {
    let hasNvidia = false
    try {
      hasNvidia = (await detectGpu()).some(g => g.vendor === 'nvidia')
    } catch {
      /* ignore */
    }
    idx = hasNvidia ? (await listTorchIndexes()).find(t => t.startsWith('cu')) || 'cu124' : 'cpu'
  }
  if (!/^(cu\d+|cpu|rocm[\d.]+|xpu)$/.test(idx)) throw new Error(t('m.installer.unknownTorchIndex', { index: idx }))

  // 阿里云 pytorch-wheels 是平铺列表页（非 PEP 503），只能作 --find-links 补充源
  const sources: { label: string; indexUrl: string; findLinks?: string }[] = [
    {
      label: t('m.installer.sourceLabelAliyun'),
      indexUrl: 'https://mirrors.aliyun.com/pypi/simple/',
      findLinks: `https://mirrors.aliyun.com/pytorch-wheels/${idx}`
    },
    { label: t('m.installer.sourceLabelOfficial'), indexUrl: `https://download.pytorch.org/whl/${idx}` }
  ]
  if (loadSettings().torchMirror !== 'aliyun') sources.reverse()

  let lastTail = ''
  for (let i = 0; i < sources.length; i++) {
    const { label, indexUrl, findLinks } = sources[i]
    if (i > 0) emit(on, t('m.installer.stageTorch'), t('m.installer.retryWithSource', { label }), basePercent)
    emit(on, t('m.installer.stageTorch'), t('m.installer.installTorchFrom', { index: idx, label }), basePercent)
    // 镜像目录可用时优先走多线程高速路径
    if (findLinks && /^(cu\d+|cpu)$/.test(idx)) {
      try {
        if (await tryFastWheels(sources[i], on, basePercent)) return
        emit(on, t('m.installer.stageTorch'), t('m.installer.noMatchingWheel'), basePercent)
      } catch (e) {
        emit(
          on,
          t('m.installer.stageTorch'),
          t('m.installer.fastDownloadFailed', { error: (e as Error).message.slice(0, 80) }),
          basePercent
        )
      }
    }
    let tail = ''
    const r = await pip(['install', 'torch', 'torchvision', 'torchaudio'], {
      indexUrl,
      findLinks,
      onData: d => {
        tail = (tail + d).slice(-800)
        emit(on, t('m.installer.stageTorch'), d.trim().split('\n').pop() || '', Math.min(basePercent + 22, basePercent + 24))
      },
      timeoutMs: 60 * 60 * 1000
    })
    if (r.code === 0) return
    lastTail = tail
  }
  const tailLines = lastTail.trim().split(/\r?\n/).filter(l => /ERROR|error|失败|Could not/i.test(l)).slice(-2)
  throw new Error(
    tailLines.length
      ? t('m.installer.torchInstallFailedDetail', { detail: tailLines.join(' | ').slice(-300) })
      : t('m.installer.torchInstallFailed')
  )
}

export async function installRequirements(on: ProgressFn, basePercent = 70): Promise<void> {
  const p = paths()
  const req = path.join(p.comfy, 'requirements.txt')
  if (!fs.existsSync(req)) return
  emit(on, t('m.installer.stageDeps'), t('m.installer.installDeps'), basePercent)
  const r = await pip(['install', '-r', req, ...pipIndexArgs()], {
    onData: d => emit(on, t('m.installer.stageDeps'), d.trim().split('\n').pop() || '', Math.min(basePercent + 22, basePercent + 24)),
    timeoutMs: 60 * 60 * 1000
  })
  if (r.code !== 0) throw new Error(t('m.installer.depsInstallFailed'))
}

/** 安装 / 更新 ComfyUI-Manager：优先 pip 包，失败回退克隆 Comfy-Org 仓库 */
export async function installManager(on: ProgressFn, basePercent = 95): Promise<void> {
  const p = paths()
  const dir = path.join(p.customNodes, 'ComfyUI-Manager')
  try {
    emit(on, t('m.installer.stageManager'), t('m.installer.installManagerPip'), basePercent)
    const r = await pip(['install', '-U', 'comfyui-manager', ...pipIndexArgs()], {
      onData: d => emit(on, t('m.installer.stageManager'), d.trim().split('\n').pop() || '', Math.min(basePercent + 4, 99)),
      timeoutMs: 30 * 60 * 1000
    })
    if (r.code !== 0) throw new Error(t('m.installer.pipManagerFailed'))
    // 旧克隆会让 ComfyUI 继续加载旧版 Manager，移走备份
    if (fs.existsSync(dir)) {
      const bak = dir + '.bak'
      fs.rmSync(bak, { recursive: true, force: true })
      fs.renameSync(dir, bak)
      emit(on, t('m.installer.stageManager'), t('m.installer.oldManagerBackedUp'), basePercent)
    }
  } catch (e) {
    emit(
      on,
      t('m.installer.stageManager'),
      t('m.installer.pipChannelFailed', { error: (e as Error).message.slice(0, 60) }),
      basePercent
    )
    try {
      await installManagerFromGit(on, basePercent)
    } catch (e2) {
      emit(
        on,
        t('m.installer.stageManager'),
        t('m.installer.managerInstallFailed', { error: (e2 as Error).message }).slice(0, 220),
        basePercent
      )
    }
  }
}

/** git 兜底：克隆 Comfy-Org/ComfyUI-Manager 并安装其依赖 */
async function installManagerFromGit(on: ProgressFn, basePercent: number): Promise<void> {
  const p = paths()
  const dir = path.join(p.customNodes, 'ComfyUI-Manager')
  // GitHub 地址会按设置的 git 加速前缀自动改写；gitcode 无官方 Manager 镜像
  const url = transformGitUrl('https://github.com/Comfy-Org/ComfyUI-Manager.git')
  fs.mkdirSync(p.customNodes, { recursive: true })
  let reused = false
  if (fs.existsSync(path.join(dir, '.git'))) {
    const remote = await run(gitExe(), ['remote', 'get-url', 'origin'], { cwd: dir, timeoutMs: 8000 })
    if (remote.code === 0 && /Comfy-Org\/ComfyUI-Manager/i.test(remote.out)) {
      emit(on, t('m.installer.stageManager'), t('m.installer.updateManager'), basePercent)
      const r = await run(gitExe(), ['pull', '--ff-only'], { cwd: dir, timeoutMs: 5 * 60 * 1000 })
      if (r.code !== 0) throw new Error(t('m.installer.managerUpdateFailed'))
      reused = true
    }
  }
  if (!reused) {
    if (!(await gitAvailable())) throw new Error(t('m.installer.gitNotFound'))
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    emit(on, t('m.installer.stageManager'), t('m.installer.installManagerSource'), basePercent)
    const r = await run(gitExe(), ['clone', '--depth', '1', url, dir], { timeoutMs: 15 * 60 * 1000 })
    if (r.code !== 0) throw new Error(t('m.installer.cloneFailed', { detail: (r.err || r.out).slice(-200) }))
  }
  const req = path.join(dir, 'requirements.txt')
  if (fs.existsSync(req)) {
    emit(on, t('m.installer.stageManager'), t('m.installer.installManagerDeps'), basePercent + 2)
    const r = await pip(['install', '-r', req, ...pipIndexArgs()], {
      onData: d => emit(on, t('m.installer.stageManager'), d.trim().split('\n').pop() || '', Math.min(basePercent + 4, 99)),
      timeoutMs: 30 * 60 * 1000
    })
    if (r.code !== 0) throw new Error(t('m.installer.managerDepsFailed'))
  }
}

/** 一键安装主流程 */
export async function installComfyUI(opts: InstallOptions, on: ProgressFn): Promise<void> {
  const s = saveSettings({
    comfyVersion: opts.version,
    pythonPath: opts.pythonPath,
    torchIndex: opts.torchIndex as TorchIndex
  })
  if (!s.installPath) throw new Error(t('m.installer.pickInstallPath'))
  emit(on, t('m.installer.stagePrepare'), t('m.installer.checkEnv'), 2)

  await fetchSource(opts.version, on)
  emit(on, t('m.installer.stageSource'), t('m.installer.sourceReady'), 28)

  emit(on, t('m.installer.stagePython'), t('m.installer.creatingVenv'), 30)
  await ensureVenv(opts.pythonPath, d => emit(on, t('m.installer.stagePython'), d.trim().split('\n').pop() || '', 32))
  emit(on, t('m.installer.stagePython'), t('m.installer.venvReady'), 43)

  await installTorch(opts.torchIndex, on, 45)
  emit(on, t('m.installer.stageTorch'), t('m.installer.torchDone'), 68)

  await installRequirements(on, 70)
  await installManager(on, 95)
  emit(on, t('m.installer.stageDone'), t('m.installer.installDone'), 100)
}

/** 更新 ComfyUI 到指定版本（或当前分支拉取最新） */
export async function updateComfyUI(version: string, on: ProgressFn): Promise<void> {
  const p = paths()
  emit(on, t('m.installer.stageUpdate'), t('m.installer.pullLatest'), 10)
  if (fs.existsSync(path.join(p.comfy, '.git'))) {
    await run(gitExe(), ['fetch', '--tags'], { cwd: p.comfy, timeoutMs: 10 * 60 * 1000 })
    const r =
      version === 'master'
        ? await run(gitExe(), ['pull'], { cwd: p.comfy, timeoutMs: 10 * 60 * 1000 })
        : await run(gitExe(), ['checkout', version], { cwd: p.comfy })
    if (r.code !== 0) throw new Error(t('m.installer.updateFailed', { detail: (r.err || r.out).slice(-300) }))
  } else {
    await fetchSource(version, on)
  }
  saveSettings({ comfyVersion: version })
  emit(on, t('m.installer.stageUpdate'), t('m.installer.updateDeps'), 60)
  await installRequirements(on, 62)
  await installManager(on, 92)
  emit(on, t('m.installer.stageDone'), t('m.installer.updateDone'), 100)
}
