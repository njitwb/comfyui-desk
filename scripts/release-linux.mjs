#!/usr/bin/env node
/**
 * 一键发布（Linux / deepin 等 Debian 系）：类型检查 → vite 构建 → electron-builder 打包 AppImage
 * 与 Windows 的 release.mjs 不同：POSIX 使用系统 Python / git，无需 prepare-python / prepare-git。
 * 用法:
 *   npm run release:linux               按 package.json 当前版本号打包
 *   npm run release:linux -- 1.2.3      先将版本号提升到 1.2.3 再打包
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// electron-builder 26 内部会用 require() 加载纯 ESM 的 @noble/hashes，要求 Node >= 22.12（原生支持 require(esm)）
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`当前 Node v${process.versions.node} 过旧，electron-builder 打包会因 require(esm) 失败。`)
  console.error("请切换到 Node >= 22.12，例如： export PATH=\"$HOME/.local/bin:$PATH\"  （本项目使用的 Node v24 位于 ~/.local）")
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

// electron-builder 首次打包需下载 Electron 本体与 AppImage 等二进制；
// 国内直连 GitHub 很慢，本地自动切 npmmirror。CI（GitHub Actions 置 CI=true）直连官方源更快
if (!process.env.CI) {
  process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}
// 确认镜像变量确实生效（打包首次需下载 Electron/AppImage 二进制，本地直连 GitHub 很慢）
console.log(`[镜像] ELECTRON_MIRROR                = ${process.env.ELECTRON_MIRROR}`)
console.log(`[镜像] ELECTRON_BUILDER_BINARIES_MIRROR = ${process.env.ELECTRON_BUILDER_BINARIES_MIRROR}`)

const run = cmd => {
  console.log(`\n========== > ${cmd}\n`)
  execSync(cmd, { stdio: 'inherit', shell: true })
}

const bump = process.argv[2]
if (bump) {
  if (!/^\d+\.\d+\.\d+$/.test(bump)) {
    console.error(`版本号格式错误: ${bump}(应为 x.y.z)`)
    process.exit(1)
  }
  run(`npm version ${bump} --no-git-tag-version`)
}

run('npm run typecheck')
run('npm run build')

try {
  run('npx electron-builder --linux --publish never')
} catch {
  console.log('\n========== 打包失败,清理 release 目录后重试一次 ...')
  fs.rmSync(path.join(root, 'release'), { recursive: true, force: true })
  run('npx electron-builder --linux --publish never')
}

const outDir = path.join(root, 'release')
if (fs.existsSync(outDir)) {
  console.log('\n========== 发布产物:')
  for (const f of fs.readdirSync(outDir)) {
    const st = fs.statSync(path.join(outDir, f))
    if (st.isFile()) console.log(`  ${f}  (${(st.size / 1048576).toFixed(1)} MB)`)
  }
}