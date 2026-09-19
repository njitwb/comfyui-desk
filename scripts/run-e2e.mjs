/**
 * E2E 运行器：把可复用的生产代码（guest 注入补丁 / 主进程防火墙）编译成 cjs，
 * 再用真实 Electron 进程驱动端到端断言。
 * 用法：npm run test:e2e
 */
import { buildSync } from 'esbuild'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const cacheDir = path.join(root, 'scripts', 'e2e', '.cache')

fs.rmSync(cacheDir, { recursive: true, force: true })
fs.mkdirSync(cacheDir, { recursive: true })

// 编译生产侧可复用模块（与 src 单一来源，测试不过复制逻辑）
const entries = [
  ['src/shared/dm-patch.ts', 'dm-patch.cjs'],
  ['src/main/guest-guard.ts', 'guest-guard.cjs'],
  ['src/main/downloads.ts', 'downloads.cjs'],
]
for (const [entry, out] of entries) {
  buildSync({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(cacheDir, out),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'warning',
  })
}

const bin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!fs.existsSync(bin)) {
  console.error('未找到 electron 可执行文件，请先 npm install')
  process.exit(1)
}

/**
 * 运行 Electron 子进程并转发其输出。
 * 不用 stdio:'inherit'：Electron 直接写控制台的是 UTF-8 字节，Windows 控制台会按当前
 * 代码页（中文为 GBK/936）解码，中文全变乱码；经 Node 转发走 WriteConsoleW 转 UTF-16 才正确
 * （重定向到文件/CI 时同样是字节透传，不受影响）。
 */
function runChild(args, env) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: env || process.env, stdio: ['inherit', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => process.stdout.write(d))
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('close', (code) => resolve(code ?? 1))
  })
}

const rc = await runChild([path.join(root, 'scripts', 'e2e', 'e2e-main.cjs')])
if (rc !== 0) process.exit(rc)

// 下载持久化：同一份 downloads.cjs，两个真实 Electron 进程模拟「下载中关软件 → 重开续传」
console.log('case dl: 下载中强行退出 → 重启恢复（断点续传）')
const dlTmp = path.join(root, 'scripts', 'e2e', '.tmp-dl')
for (const phase of ['1', '2']) {
  const rp = await runChild([path.join(root, 'scripts', 'e2e', 'e2e-dl-phase.cjs')], {
    ...process.env,
    DL_PHASE: phase,
    DL_TMP: dlTmp,
    E2E_CACHE: cacheDir
  })
  if (rp !== 0) process.exit(rp)
}
fs.rmSync(dlTmp, { recursive: true, force: true })
