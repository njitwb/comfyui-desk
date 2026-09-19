#!/usr/bin/env node
/**
 * 一键发布：便携 Python 依赖 → 类型检查 → vite 构建 → electron-builder 打包 (nsis 安装包 + zip 绿色版)
 * 用法:
 *   npm run release              按 package.json 当前版本号打包
 *   npm run release -- 1.2.3     先将版本号提升到 1.2.3 再打包
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

// electron-builder 首次打包需下载 nsis / winCodeSign 等二进制；本地走国内镜像，
// CI（GitHub Actions 会置 CI=true）直连官方源更快
if (!process.env.CI) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}

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

run('node scripts/prepare-python.mjs')
run('node scripts/prepare-git.mjs')
run('npm run typecheck')
run('npm run build')

// electron 解压后立刻重命名目录时,Defender 实时扫描可能持有句柄导致 EPERM;
// 扫描缓存生效后重试即可通过,故 builder 失败自动重试一次
try {
  run('npx electron-builder --win --publish never')
} catch {
  console.log('\n========== 打包失败(可能是安全软件扫描占用),清理后重试一次 ...')
  fs.rmSync(path.join(root, 'release'), { recursive: true, force: true })
  run('npx electron-builder --win --publish never')
}

const outDir = path.join(root, 'release')
if (fs.existsSync(outDir)) {
  console.log('\n========== 发布产物:')
  for (const f of fs.readdirSync(outDir)) {
    const st = fs.statSync(path.join(outDir, f))
    if (st.isFile()) console.log(`  ${f}  (${(st.size / 1048576).toFixed(1)} MB)`)
  }
}
