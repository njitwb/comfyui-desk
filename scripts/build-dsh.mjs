#!/usr/bin/env node
/**
 * 安装内嵌的 DeepSeek Harness（canvas/dsh，vendored 依赖树）：
 *   - canvas/dsh 下 node_modules 缺失或版本不符时先装依赖。dsh 是 developer preview，
 *     package.json 里精确 pin 版本，这里会校验实际装到的版本与 pin 一致。
 *   - --ignore-scripts：npm 11 会拦下 dsh 依赖树里的 install script（koffi / node-pty 的
 *     原生构建、dsh-subprocess-local 的 postinstall）。实测 dsh web 不依赖它们也能跑；
 *     其中唯一有实际副作用的是给 node-pty 预编译 spawn-helper 补可执行位，这里自己补。
 *   - 构建后断言运行时必需文件，早失败好过发布后崩溃。
 * 幂等：依赖已就位时跳过安装。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshDir = path.join(root, 'canvas', 'dsh')
const dshBin = path.join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const nodeExe = path.join(root, 'resources', 'node-runtime', process.platform === 'win32' ? 'node.exe' : 'node')

if (!fs.existsSync(path.join(dshDir, 'package.json'))) {
  console.error(`[dsh] 未找到 ${dshDir}/package.json`)
  process.exit(1)
}
const pinned = JSON.parse(fs.readFileSync(path.join(dshDir, 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh']

const run = (cmd, cwd) => {
  console.log(`\n========== > ${cmd}  (in ${path.relative(root, cwd) || '.'})\n`)
  execSync(cmd, { stdio: 'inherit', shell: true, cwd })
}

/** 读取已安装的 dsh 版本；未安装返回 null */
function installedVersion() {
  const pkg = path.join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (!fs.existsSync(pkg)) return null
  try {
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version
  } catch {
    return null
  }
}

const current = installedVersion()
if (current === pinned) {
  console.log(`[dsh] 依赖已就位且版本一致（${pinned}），跳过安装`)
} else {
  if (current) console.log(`[dsh] 已装版本 ${current} 与 pin 的 ${pinned} 不一致，重装 ...`)
  // 仓库自带 package-lock.json，优先 npm ci 保证可复现；lock 与 package.json 不同步时回退 install
  try {
    run('npm ci --ignore-scripts --no-audit --no-fund', dshDir)
  } catch {
    console.log('\n[dsh] npm ci 失败（package-lock 可能与 package.json 不同步），回退 npm install ...')
    run('npm install --ignore-scripts --no-audit --no-fund', dshDir)
  }
}

// ---- 补 node-pty 预编译 spawn-helper 的可执行位。
// 上游靠 dsh-subprocess-local 的 postinstall 做这件事，但该脚本被 npm 11 拦下；
// POSIX 下缺可执行位会让 terminal 工具起不来（Windows 用 conpty，无此文件）
if (process.platform !== 'win32') {
  const ptyRoot = path.join(dshDir, 'node_modules', 'node-pty')
  let fixed = false
  for (const rel of [
    path.join('prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    path.join('build', 'Release', 'spawn-helper')
  ]) {
    const helper = path.join(ptyRoot, rel)
    if (fs.existsSync(helper)) {
      fs.chmodSync(helper, 0o755)
      fixed = true
    }
  }
  console.log(`[dsh] node-pty spawn-helper 可执行位${fixed ? '已补' : '未发现（可能非必需）'}`)
}

// ---- 断言 1：dsh 启动器入口存在
if (!fs.existsSync(dshBin)) {
  console.error(`[dsh] 缺少启动器入口：${path.relative(root, dshBin)}`)
  process.exit(1)
}

// ---- 断言 2：实际安装版本必须与 pin 一致（developer preview，版本漂移风险高）
const got = installedVersion()
if (got !== pinned) {
  console.error(`[dsh] 版本不一致：pin=${pinned} 实际=${got}`)
  process.exit(1)
}

// ---- 断言 3：Web 前端产物必须随包（web profile 启动时不会自行构建）
for (const rel of [
  ['dsh-web-app', 'package.json'],
  ['dsh-mcp-client', 'package.json'],
  ['dsh-web-frontend', 'package.json']
]) {
  const p = path.join(dshDir, 'node_modules', '@deepseek-ai', ...rel)
  if (!fs.existsSync(p)) {
    console.error(`[dsh] 缺少运行时必需包：@deepseek-ai/${rel[0]}`)
    process.exit(1)
  }
}

// ---- 断言 4：用随包 Node 运行时冒烟（Electron 自带的 Node 20.18.3 跑不了 dsh，会静默退出）
if (fs.existsSync(nodeExe)) {
  let out = ''
  try {
    out = execSync(`"${nodeExe}" "${dshBin}" --version`, { encoding: 'utf8', timeout: 60000 }).trim()
  } catch (e) {
    console.error(`[dsh] 随包 Node 运行时跑 dsh 失败：${e.message}`)
    process.exit(1)
  }
  if (!out.includes(got)) {
    console.error(`[dsh] 冒烟失败：期望输出包含 ${got}，实际 "${out}"（随包 Node 版本可能低于 dsh 要求）`)
    process.exit(1)
  }
  console.log(`[dsh] 冒烟通过：随包 Node 运行 dsh ${out}`)
} else {
  console.warn(`[dsh] 未找到随包 Node 运行时（${path.relative(root, nodeExe)}），跳过冒烟。发布前请先 npm run prepare:node`)
}

function dirSize(dir) {
  let total = 0
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    try {
      total += fs.statSync(path.join(dir, rel)).size
    } catch {
      /* ignore */
    }
  }
  return total
}

console.log('\n========== DeepSeek Harness 产物:')
console.log(`  @deepseek-ai/dsh  (${got})`)
console.log(`  node_modules  (${(dirSize(path.join(dshDir, 'node_modules')) / 1048576).toFixed(2)} MB)`)
