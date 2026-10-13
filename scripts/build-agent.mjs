#!/usr/bin/env node
/**
 * 构建内嵌画布伴生服务（canvas/agent，vendored canvas-agent）：
 *   - canvas/agent 下 node_modules 缺失时先装依赖。
 *   - 然后 tsc 构建到 dist。
 *   - 构建后断言运行时必需文件与目录关系，早失败好过发布后崩溃。
 * 幂等：node_modules 已存在时跳过安装，加速 dev / 打包流程。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentDir = path.join(root, 'canvas', 'agent')
const distDir = path.join(agentDir, 'dist')

if (!fs.existsSync(path.join(agentDir, 'package.json'))) {
  console.error(`[画布 Agent] 未找到 ${agentDir}，请确认 canvas-agent 源码已拷贝到 canvas/agent 目录`)
  process.exit(1)
}

const run = (cmd, cwd) => {
  console.log(`\n========== > ${cmd}  (in ${path.relative(root, cwd) || '.'})\n`)
  execSync(cmd, { stdio: 'inherit', shell: true, cwd })
}

const INSTALL_FLAGS = '--ignore-scripts --no-audit --no-fund'
if (!fs.existsSync(path.join(agentDir, 'node_modules'))) {
  // 仓库自带 package-lock.json，优先 npm ci 保证可复现；lock 与 package.json 不同步时回退 install。
  // --ignore-scripts 跳过 esbuild 的 postinstall：esbuild 由 devDep tsx 引入，其 install.js 会
  // 校验平台二进制版本并失败；构建只用 tsc，运行时的 express / winston / zod / mcp-sdk 均无必需
  // postinstall，故安全。
  // 无需 --legacy-peer-deps（该 flag 是 canvas/web 的 antd peer 冲突才需要，此处依赖无 peer 冲突）
  try {
    run(`npm ci ${INSTALL_FLAGS}`, agentDir)
  } catch {
    console.log('\n[画布 Agent] npm ci 失败（package-lock 可能与 package.json 不同步），回退 npm install ...')
    run(`npm install ${INSTALL_FLAGS}`, agentDir)
  }
}
run('npm run build', agentDir)

// ---- 断言 1：运行时必需文件存在。
// dist/ 必须与 agent-instructions.md、package.json 同处包根：
//   config.ts 顶层读 new URL("../agent-instructions.md", import.meta.url)
//   package.json 是 ESM（"type":"module"）判定与 readPackageVersion() 所需
// 三者被拆散（如 dist 进 asar、instructions 留外面）都会在 import 阶段崩溃
const required = ['dist/index.js', 'agent-instructions.md', 'package.json']
for (const rel of required) {
  if (!fs.existsSync(path.join(agentDir, rel))) {
    console.error(`[画布 Agent] 缺少运行时必需文件：canvas/agent/${rel}`)
    process.exit(1)
  }
}

// ---- 断言 2：画布与 agent 的协议版本必须一致，否则画布连接后会直接提示 restartRequired
function readVersion(file, label) {
  const src = fs.readFileSync(file, 'utf-8')
  const m = src.match(/AGENT_PROTOCOL_VERSION\s*=\s*(\d+)/)
  if (!m) {
    console.error(`[画布 Agent] 无法在 ${label} 中解析 AGENT_PROTOCOL_VERSION：${file}`)
    process.exit(1)
  }
  return m[1]
}
const webProtocol = readVersion(path.join(root, 'canvas', 'web', 'src', 'components', 'agent', 'local-agent-panel.tsx'), '画布前端')
const agentProtocol = readVersion(path.join(agentDir, 'src', 'canvas', 'session.ts'), '伴生服务')
if (webProtocol !== agentProtocol) {
  console.error(`[画布 Agent] 协议版本不一致：画布前端=${webProtocol} 伴生服务=${agentProtocol}，画布会拒绝连接`)
  process.exit(1)
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

console.log('\n========== 画布伴生服务产物:')
console.log(`  dist  (${(dirSize(distDir) / 1048576).toFixed(2)} MB)`)
console.log(`  node_modules  (${(dirSize(path.join(agentDir, 'node_modules')) / 1048576).toFixed(2)} MB)`)
console.log(`  协议版本  v${agentProtocol}（画布前端一致）`)
