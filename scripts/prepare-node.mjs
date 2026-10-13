#!/usr/bin/env node
/**
 * 准备随安装包分发的便携 Node 运行时（只取可执行文件，不带 npm/pnpm）。
 *
 * 为什么需要它：DeepSeek Harness（@deepseek-ai/dsh）要求 Node `^22.19 || >=24`，
 * 而应用内置的 Electron 33 只带 Node 20.18.3 —— 用 ELECTRON_RUN_AS_NODE 跑 dsh 会静默退出。
 * 因此单独分发一份 Node 22 LTS 给 dsh 用，其余部分（canvas-agent 等）继续用 Electron 自带运行时。
 *
 * 产物：resources/node-runtime/node（POSIX）/ node.exe（Windows）
 * 已存在且版本达标则跳过；可用 NODE_VERSION 或命令行参数覆盖版本。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'resources', 'node-runtime')
const exe = path.join(target, process.platform === 'win32' ? 'node.exe' : 'node')

/** dsh 要求的下限；低于它就别用这份运行时 */
const MIN = [22, 19, 0]

const specified = process.argv[2] || process.env.NODE_VERSION
// 默认 pin 到 v22 LTS（Jod）。dsh 只在运行期用，不参与编译，升小版本风险低
const VERSION = specified || 'v22.23.3'

/** 解析现有产物的语义版本；不存在或跑不起来返回 null */
function currentVersion() {
  if (!fs.existsSync(exe)) return null
  try {
    const m = execSync(`"${exe}" -v`, { encoding: 'utf8', timeout: 15000 }).trim().match(/^v(\d+)\.(\d+)\.(\d+)/)
    return m ? [+m[1], +m[2], +m[3]] : null
  } catch {
    return null
  }
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const existing = currentVersion()
if (existing && cmp(existing, MIN) >= 0) {
  console.log(`[prepare-node] 已存在且达标，跳过: v${existing.join('.')} -> ${exe}`)
  process.exit(0)
}

/** 当前平台在 nodejs.org 发行包里的文件名后缀 */
const ARCH = { x64: 'x64', arm64: 'arm64' }[process.arch]
if (!ARCH) {
  console.error(`[prepare-node] 不支持的架构 ${process.arch}`)
  process.exit(1)
}
const OSNAME = { linux: 'linux', darwin: 'darwin', win32: 'win' }[process.platform]
if (!OSNAME) {
  console.error(`[prepare-node] 不支持的平台 ${process.platform}`)
  process.exit(1)
}

const base = `node-${VERSION}-${OSNAME}-${ARCH}`
const file = OSNAME === 'win' ? `${base}.zip` : `${base}.tar.gz`
// CI（GitHub Actions 会置 CI=true）直连官方源；本地优先国内镜像，失败再回退
const mirrors = process.env.CI
  ? ['https://nodejs.org/dist', 'https://registry.npmmirror.com/-/binary/node']
  : ['https://registry.npmmirror.com/-/binary/node', 'https://nodejs.org/dist']

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'comfyui-release' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(download(new URL(res.headers.location, url).toString(), dest))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode))
      }
      const w = fs.createWriteStream(dest)
      res.pipe(w)
      w.on('finish', () => w.close(resolve))
      w.on('error', reject)
    })
    req.setTimeout(120000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

let pkg = null
for (const mirror of mirrors) {
  const url = `${mirror}/${VERSION}/${file}`
  const tmp = path.join(os.tmpdir(), `node-${VERSION}-${OSNAME}-${ARCH}${OSNAME === 'win' ? '.zip' : '.tar.gz'}`)
  try {
    console.log(`[prepare-node] 下载 Node ${VERSION} ... ${url}`)
    await download(url, tmp)
    const size = fs.statSync(tmp).size
    if (size < 10 * 1024 * 1024) throw new Error(`包体异常小 (${size}B)`)
    pkg = { tmp }
    break
  } catch (e) {
    console.log(`[prepare-node] ${mirror} 不可用（${e.message}），尝试下一个...`)
  }
}
if (!pkg) {
  console.error('[prepare-node] 所有镜像均下载失败，可尝试: node scripts/prepare-node.mjs v22.23.3')
  process.exit(1)
}

const unpackDir = path.join(os.tmpdir(), `node-runtime-${Date.now()}`)
fs.mkdirSync(unpackDir, { recursive: true })
console.log('[prepare-node] 解压 ...')
// tar.gz 与 zip 都用 tar：Linux 是 GNU tar，Windows 10+ 自带 bsdtar（同时支持 .zip）
execSync(`tar -xf "${pkg.tmp}" -C "${unpackDir}"`, { stdio: 'inherit' })

// 归档内顶层是 node-v<ver>-<os>-<arch>/；只取可执行文件，npm/pnpm 与头文件都不要
const src = path.join(unpackDir, base, OSNAME === 'win' ? 'node.exe' : path.join('bin', 'node'))
if (!fs.existsSync(src)) {
  console.error(`[prepare-node] 归档内未找到可执行文件: ${src}`)
  process.exit(1)
}
fs.mkdirSync(target, { recursive: true })
fs.rmSync(exe, { force: true })
fs.cpSync(src, exe)
fs.rmSync(unpackDir, { recursive: true, force: true })
fs.rmSync(pkg.tmp, { force: true })

const got = currentVersion()
if (!got || cmp(got, MIN) < 0) {
  console.error(`[prepare-node] 校验失败：期望 >= v${MIN.join('.')}，实际 ${got ? 'v' + got.join('.') : '无法执行'}`)
  process.exit(1)
}
console.log(`[prepare-node] 完成: v${got.join('.')} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB) -> ${exe}`)
