#!/usr/bin/env node
/**
 * 准备随安装包分发的便携 Python（nuget 完整包，含 pip/venv 支持，非 embed 阉割版）。
 * 已存在则跳过；未存在则按候选版本依次下载 → 解压 tools/ → 校验 venv 能力。
 * 可通过环境变量 PY_VERSION 或命令行参数指定版本，如: node scripts/prepare-python.mjs 3.12.10
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'resources', 'python')
const exe = path.join(target, 'python.exe')

const specified = process.argv[2] || process.env.PY_VERSION
const VERSIONS = [...(specified ? [specified] : []), '3.12.10', '3.12.9', '3.12.7', '3.12.6', '3.12.4']

if (fs.existsSync(exe)) {
  console.log('[prepare-python] 已存在，跳过:', exe)
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
for (const v of VERSIONS) {
  const url = `https://www.nuget.org/api/v2/package/python/${v}`
  const tmp = path.join(os.tmpdir(), `python-${v}.nupkg`)
  try {
    console.log(`[prepare-python] 下载 Python ${v} (nuget) ...`)
    await download(url, tmp)
    const size = fs.statSync(tmp).size
    if (size < 1024 * 1024) throw new Error(`包体异常小 (${size}B)`)
    downloaded = { v, tmp }
    break
  } catch (e) {
    console.log(`[prepare-python] ${v} 不可用（${e.message}），尝试下一个...`)
  }
}
if (!downloaded) {
  console.error('[prepare-python] 所有候选版本均下载失败，可尝试: node scripts/prepare-python.mjs <版本号>')
  process.exit(1)
}

const unpackDir = path.join(os.tmpdir(), `python-nupkg-${Date.now()}`)
fs.mkdirSync(unpackDir, { recursive: true })
console.log('[prepare-python] 解压 ...')
// nupkg 本质是 zip；Windows 10+ 自带 bsdtar 可直接解压 zip
execSync(`tar -xf "${downloaded.tmp}" -C "${unpackDir}"`, { stdio: 'inherit' })
const tools = path.join(unpackDir, 'tools')
if (!fs.existsSync(path.join(tools, 'python.exe'))) {
  console.error('[prepare-python] nupkg 中未找到 tools/python.exe')
  process.exit(1)
}
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.rmSync(target, { recursive: true, force: true })
// 不能 rename：Windows 跨盘符会报 EXDEV（CI 里临时目录在 C:、工作区在 D:）
fs.cpSync(tools, target, { recursive: true })
fs.rmSync(unpackDir, { recursive: true, force: true })
fs.rmSync(downloaded.tmp, { force: true })

const ver = execSync(`"${exe}" --version`).toString().trim()
// venv/ensurepip 是启动器创建隔离环境的前提,embed 版没有,必须在这里拦住
execSync(`"${exe}" -c "import venv, ensurepip"`)
console.log(`[prepare-python] 完成: ${ver}(venv/pip 支持已校验)-> ${target}`)
