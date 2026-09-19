#!/usr/bin/env node
/**
 * 准备随安装包分发的便携 git(MinGit,Git for Windows 官方裁剪版,专为脚本/克隆场景设计)。
 * 已存在则跳过;未存在则按候选源依次下载 → 解压 → 校验可执行。
 * 可通过命令行参数指定版本,如: node scripts/prepare-git.mjs 2.55.0.windows.1
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'resources', 'git')
const exe = path.join(target, 'cmd', 'git.exe')

const specified = process.argv[2] || process.env.GIT_VERSION || '2.55.0.windows.1'
const base = specified.split('.windows')[0]
const CANDIDATES = [
  // 国内镜像优先(已验证存在),境外回退 GitHub Releases
  `https://registry.npmmirror.com/-/binary/git-for-windows/v${specified}/MinGit-${base}-64-bit.zip`,
  `https://github.com/git-for-windows/git/releases/download/v${specified}/MinGit-${base}-64-bit.zip`
]

if (fs.existsSync(exe)) {
  console.log('[prepare-git] 已存在,跳过:', exe)
  process.exit(0)
}

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
    req.setTimeout(60000, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

let downloaded = null
for (const url of CANDIDATES) {
  const tmp = path.join(os.tmpdir(), `mingit-${Date.now()}.zip`)
  try {
    console.log(`[prepare-git] 下载 MinGit ${specified} ...`)
    console.log(`  ${url}`)
    await download(url, tmp)
    const size = fs.statSync(tmp).size
    if (size < 1024 * 1024) throw new Error(`包体异常小 (${size}B)`)
    downloaded = tmp
    break
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    console.log(`[prepare-git] 该源不可用(${e.message}),尝试下一个...`)
  }
}
if (!downloaded) {
  console.error('[prepare-git] 所有候选源均下载失败')
  process.exit(1)
}

console.log('[prepare-git] 解压 ...')
fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
// Windows 10+ 自带 bsdtar 可直接解压 zip
execSync(`tar -xf "${downloaded}" -C "${target}"`, { stdio: 'inherit' })
fs.rmSync(downloaded, { force: true })

if (!fs.existsSync(exe)) {
  console.error('[prepare-git] 解压后未找到 cmd/git.exe')
  process.exit(1)
}
const ver = execSync(`"${exe}" --version`).toString().trim()
console.log(`[prepare-git] 完成: ${ver} -> ${target}`)
