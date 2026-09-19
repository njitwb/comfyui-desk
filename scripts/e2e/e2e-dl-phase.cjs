/**
 * 下载任务持久化 e2e（两阶段，真实 Electron 进程间模拟「下载中关软件 → 重开」）：
 *   DL_PHASE=1：起 2 个任务（A 下载中、B 立即暂停），A 收到部分字节后 app.exit 硬退出
 *   DL_PHASE=2：重新 initDownloads → A 自动断点续传至完成且字节级一致、B 还原为 paused
 * 共享临时目录由 DL_TMP 指定，userData/settings/models 全部隔离其中，不碰真实数据。
 */
const { app } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PORT = 18093
const PHASE = process.env.DL_PHASE
const TMP = process.env.DL_TMP
const CACHE = process.env.E2E_CACHE

// 必须在任何模块读取 userData 之前（persist/settings/logger 均按此懒取）
app.setPath('userData', path.join(TMP, 'userData'))

const MODELS = path.join(TMP, 'models')
const FILE_A = 'ckpt_a.safetensors'
const FILE_B = 'lora_b.safetensors'
const SIZE = 1 << 20 // 1 MB
const KILL_AT = 256 * 1024

/** 确定性内容：跨进程可复算，字节级比对用 */
function makeData(seed) {
  const buf = Buffer.alloc(SIZE)
  for (let i = 0; i < SIZE; i++) buf[i] = (i * 7 + seed) % 251
  return buf
}
const DATA = { [FILE_A]: makeData(1), [FILE_B]: makeData(2) }

function serve(req, res) {
  const data = DATA[Object.keys(DATA).find(n => (req.url || '').endsWith(n))]
  if (!data) { res.statusCode = 404; res.end(); return }
  const m = /^bytes=(\d+)-$/.exec(String(req.headers.range || ''))
  if (m) {
    const off = Math.min(Number(m[1]), data.length)
    res.statusCode = 206
    res.setHeader('content-length', String(data.length - off))
    res.end(data.subarray(off))
  } else {
    res.setHeader('content-length', String(data.length))
    // 限流分块发送：本地毫秒级传完会让 phase1 来不及「下载中」退出，无法覆盖断点场景
    let off = 0
    const timer = setInterval(() => {
      const chunk = data.subarray(off, Math.min(off + 65536, data.length))
      off += chunk.length
      if (off >= data.length) { clearInterval(timer); res.end(chunk); return }
      res.write(chunk)
    }, 30)
    req.on('close', () => clearInterval(timer))
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function fail(msg) { console.error('DL-PHASE' + PHASE + '-FAIL: ' + msg); app.exit(1) }
const assert = (c, m) => { if (!c) fail(m) }

async function phase1(dl) {
  await dl.startDownload({ url: `http://127.0.0.1:${PORT}/checkpoints/${FILE_A}`, useHfMirror: false })
  const b = await dl.startDownload({ url: `http://127.0.0.1:${PORT}/loras/${FILE_B}`, useHfMirror: false })
  dl.pauseDownload(b.id)
  // 等 A 真实收到一部分字节 → 落盘后硬退出（不清理任何资源，模拟下载中直接关软件）
  const t0 = Date.now()
  for (;;) {
    const a = dl.listDownloads().find(t => t.filename === FILE_A)
    if (a && a.received >= KILL_AT) {
      console.log(`  [phase1] A 已收到 ${a.received} 字节、B 已暂停，硬退出模拟关软件`)
      app.exit(0)
    }
    if (Date.now() - t0 > 15000) fail('A 未在 15s 内达到部分进度')
    await sleep(50)
  }
}

async function phase2(dl) {
  const list = dl.listDownloads()
  const a = list.find(t => t.filename === FILE_A)
  const b = list.find(t => t.filename === FILE_B)
  assert(a, '重启后 A 任务丢失（持久化未生效）')
  assert(a.status === 'downloading', `A 应自动续传（downloading），实际 ${a.status}`)
  assert(b, '重启后 B 任务丢失')
  assert(b.status === 'paused', `B 应还原为 paused，实际 ${b.status}`)
  console.log(`  [phase2] 任务已恢复：A=${a.status}（续传中）、B=${b.status}`)

  // A 断点续传 → 等目标文件出现；再要求 B 可手动继续至完成
  const destA = path.join(MODELS, 'checkpoints', FILE_A)
  const destB = path.join(MODELS, 'loras', FILE_B)
  const t0 = Date.now()
  for (;;) {
    if (fs.existsSync(destA)) break
    if (Date.now() - t0 > 20000) fail('A 未在 20s 内续传完成')
    await sleep(100)
  }
  assert(fs.readFileSync(destA).equals(DATA[FILE_A]), 'A 续传后文件内容与源不一致（断点续传出错）')
  console.log('  [phase2] A 断点续传完成，内容字节级一致')

  dl.resumeDownload(b.id)
  const t1 = Date.now()
  for (;;) {
    if (fs.existsSync(destB)) break
    if (Date.now() - t1 > 20000) fail('B 手动继续后未在 20s 内完成')
    await sleep(100)
  }
  assert(fs.readFileSync(destB).equals(DATA[FILE_B]), 'B 完成后文件内容与源不一致')
  // 完成态 3s 后自动清行并落盘——最终 store 不应残留任务
  await sleep(3600)
  const store = path.join(app.getPath('userData'), 'downloads.json')
  const remain = JSON.parse(fs.readFileSync(store, 'utf-8'))
  assert(Array.isArray(remain) && remain.length === 0, `完成后 downloads.json 应清空，实际 ${remain.length}`)
  console.log('  [phase2] B 继续下载完成；downloads.json 已清空')
  console.log('DL-PERSIST-PASS')
  app.exit(0)
}

app.whenReady().then(async () => {
  try {
    assert(PHASE === '1' || PHASE === '2', 'DL_PHASE 未指定')
    if (PHASE === '1') {
      fs.rmSync(TMP, { recursive: true, force: true })
      fs.mkdirSync(MODELS, { recursive: true })
    }
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ modelPath: MODELS }))

    const server = http.createServer(serve)
    await new Promise(r => server.listen(PORT, '127.0.0.1', r))

    const dl = require(path.join(CACHE, 'downloads.cjs'))
    dl.initDownloads(() => {})
    if (PHASE === '1') await phase1(dl)
    else await phase2(dl)
  } catch (e) {
    fail(e && e.stack ? String(e.stack) : String(e))
  }
})
