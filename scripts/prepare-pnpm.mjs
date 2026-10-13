#!/usr/bin/env node
/**
 * 准备随安装包分发的 pnpm（供 DeepSeek Harness 的插件管理使用）。
 *
 * 为什么需要它：dsh 的 `plugin add/remove` 内部直接调 `pnpm`，而随包 Node 运行时
 * 刻意只取了可执行文件、不含 npm/pnpm（见 prepare-node.mjs）。缺了 pnpm 的后果不只是
 * 「装不了插件市场」——市场本身就是在 dsh 里跑 `pnpm add` 来装插件的，所以这是硬前置。
 *
 * 产物：resources/pnpm/{bin/pnpm.mjs, dist/, package.json}
 * 只取运行所需的 bin/ 与 dist/，丢掉文档与源码映射以省体积。
 * 依赖随包 Node（prepare-node.mjs）来执行，必须先跑那一步。
 * 已存在且版本达标则跳过；可用 PNPM_VERSION 或命令行参数覆盖版本。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'resources', 'pnpm')
const entry = path.join(target, 'bin', 'pnpm.mjs')
const nodeExe = path.join(root, 'resources', 'node-runtime', process.platform === 'win32' ? 'node.exe' : 'node')

// 已验证可用的版本：pnpm 12 的入口是 ESM 的 bin/pnpm.mjs，能在随包 Node 22 上运行
const VERSION = process.argv[2] || process.env.PNPM_VERSION || '12.11.2'

/** 用随包 Node 跑 pnpm --version，取回版本号；跑不起来返回 null */
function currentVersion() {
  if (!fs.existsSync(entry) || !fs.existsSync(nodeExe)) return null
  try {
    const out = execSync(`"${nodeExe}" "${entry}" --version`, { encoding: 'utf8', timeout: 60000 }).trim()
    return out || null
  } catch {
    return null
  }
}

const existing = currentVersion()
if (existing === VERSION) {
  console.log(`[prepare-pnpm] 已存在且版本一致，跳过: v${existing} -> ${entry}`)
  process.exit(0)
}

if (!fs.existsSync(nodeExe)) {
  console.error(`[prepare-pnpm] 缺少随包 Node 运行时: ${nodeExe}\n  请先执行: node scripts/prepare-node.mjs`)
  process.exit(1)
}

// CI（GitHub Actions 会置 CI=true）直连官方源；本地优先国内镜像，失败再回退
const mirrors = process.env.CI
  ? ['https://registry.npmjs.org/pnpm/-', 'https://registry.npmmirror.com/pnpm/-']
  : ['https://registry.npmmirror.com/pnpm/-', 'https://registry.npmjs.org/pnpm/-']

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

const file = `pnpm-${VERSION}.tgz`
const tmp = path.join(os.tmpdir(), file)
let downloaded = false
for (const mirror of mirrors) {
  const url = `${mirror}/${file}`
  try {
    console.log(`[prepare-pnpm] 下载 pnpm ${VERSION} ... ${url}`)
    await download(url, tmp)
    const size = fs.statSync(tmp).size
    if (size < 512 * 1024) throw new Error(`包体异常小 (${size}B)`)
    downloaded = true
    break
  } catch (e) {
    console.log(`[prepare-pnpm] ${mirror} 不可用（${e.message}），尝试下一个...`)
  }
}
if (!downloaded) {
  console.error('[prepare-pnpm] 所有镜像均下载失败，可尝试: node scripts/prepare-pnpm.mjs 12.11.2')
  process.exit(1)
}

const unpackDir = path.join(os.tmpdir(), `pnpm-${Date.now()}`)
fs.mkdirSync(unpackDir, { recursive: true })
console.log('[prepare-pnpm] 解压 ...')
// npm 包的 tgz 顶层固定是 package/
execSync(`tar -xf "${tmp}" -C "${unpackDir}"`, { stdio: 'inherit' })
const pkgDir = path.join(unpackDir, 'package')
if (!fs.existsSync(path.join(pkgDir, 'bin'))) {
  console.error(`[prepare-pnpm] 归档结构异常，未找到 bin/: ${pkgDir}`)
  process.exit(1)
}

fs.rmSync(target, { recursive: true, force: true })
// 整包复制：pnpm 的入口会 import 包根目录下的文件（如 native-binary.mjs），
// 只挑 bin/ 与 dist/ 会漏依赖。包体约 58MB，相对整包可接受。
fs.cpSync(pkgDir, target, { recursive: true })
fs.rmSync(unpackDir, { recursive: true, force: true })
fs.rmSync(tmp, { force: true })

const got = currentVersion()
if (got !== VERSION) {
  console.error(`[prepare-pnpm] 校验失败：期望 v${VERSION}，实际 ${got ? 'v' + got : '无法执行'}`)
  process.exit(1)
}
const size = execSync(`du -sk "${target}"`, { encoding: 'utf8' }).trim().split(/\s+/)[0]
console.log(`[prepare-pnpm] 完成: v${got} (${(Number(size) / 1024).toFixed(1)} MB) -> ${target}`)
