#!/usr/bin/env node
/**
 * 构建内嵌无限画布（canvas/web，vendored infinite-canvas）：
 *   - canvas/web 下 node_modules 缺失时先 npm install（仓库自带 package-lock.json，不依赖 bun）
 *   - 然后 vite build，产物输出到 canvas/web/dist（含 assets 与 plugins/index.json）
 * 幂等：node_modules 已存在时跳过安装，加速 dev / 打包流程。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.join(root, 'canvas', 'web')
const outDir = path.join(webDir, 'dist')

if (!fs.existsSync(webDir)) {
  console.error(`[画布] 未找到 ${webDir}，请确认 infinite-canvas 源码已拷贝到 canvas/ 目录`)
  process.exit(1)
}

const run = (cmd, cwd) => {
  console.log(`\n========== > ${cmd}  (in ${path.relative(root, cwd) || '.'})\n`)
  execSync(cmd, { stdio: 'inherit', shell: true, cwd })
}

if (!fs.existsSync(path.join(webDir, 'node_modules'))) {
  // 上游 @ant-design/pro-components@3.0.0-beta.3 声明 peer antd@^5 而项目用 antd@6，
  // 与上游 bun install 一样跳过 peer 校验（--legacy-peer-deps），运行行为一致
  run('npm install --legacy-peer-deps', webDir)
}
run('npm run build', webDir)

function dirSize(dir) {
  let total = 0
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, rel)
    try {
      total += fs.statSync(p).size
    } catch {
      /* ignore */
    }
  }
  return total
}

if (fs.existsSync(outDir)) {
  console.log('\n========== 画布产物:')
  for (const entry of ['index.html', 'assets', 'plugins']) {
    const p = path.join(outDir, entry)
    if (!fs.existsSync(p)) continue
    const size = fs.statSync(p).isDirectory() ? dirSize(p) : fs.statSync(p).size
    console.log(`  ${entry}  (${(size / 1048576).toFixed(2)} MB)`)
  }
}
