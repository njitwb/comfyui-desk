/**
 * 端到端测试主进程（真实 Electron）：
 * 复刻「缺失模型面板」真实 DOM 与前端的各种下载触发形态，驱动以下生产代码并断言：
 *   - src/shared/dm-patch.ts（注入 guest 的下载拦截补丁）
 *   - src/main/guest-guard.ts（弹窗/导航防火墙）
 * 下载持久化（进程间断点续传）见 e2e-dl-phase.cjs。
 *
 * 用例（按执行顺序，每条都对应真实线上故障或已修复回归点）：
 *   A. 前端提前 bind window.open → 补丁挂钩拦不到 → 主进程弹窗防火墙 + DOM 行上下文兜底，类别精确到 loras
 *   B. 调用时才取 window.open → 补丁挂钩接管，类别同样来自行上下文
 *   C. location.href 本页跳转型下载 → 导航防火墙兜住，页面绝不被 huggingface 带走
 *   H. 锚点 <a href> 模型直链 → 补丁 click 监听直接接管，不产生弹窗、页面不被带走
 *   I. 非模型外链 target=_blank → 不创建弹窗、页面不跳走，转交系统浏览器
 *   K. 陈旧/无关 ctx 不得串名：弹窗 URL 不在 ctx 行内时必须回退 URL 推导，不沿用上一行的文件名/类别
 *   F. 「全部下载」连发弹窗 + 整窗 mousedown ctx（整窗文本）→ 每个 URL 的文件名/类别按逐行映射精确取得，
 *      不得共用整窗单一文件名/类别
 *   J. 补丁重复注入幂等（__comfyDmPatched）→ 一次点击只产生一个接管，不重复挂钩
 *   D. 接管后 webview reload 正常重载（loadURL 在此场景必现 ERR_FAILED，生产已改 reload），补丁可重新注入
 *   E. 刷新后仍可再次接管（复用性）
 *   G. 页面武装 beforeunload（点击/拖动画布后 ComfyUI 的真实形态）→ webview reload 必须照常重载
 *      （生产曾因被 beforeunload 静默拦死 → 看门狗误判强制重建）
 *
 * 注：D 之后 sendInputEvent 不再可靠送达 guest（真实用户场景无此问题），
 * 故 D 之后仅剩的 E 改用页内事件链驱动。
 */

const { app, BrowserWindow, shell } = require('electron')
const http = require('node:http')

// 非模型外链由防火墙转交系统浏览器：测试环境用桩替换，避免真的弹浏览器（仅记录 URL）
const openedExternal = []
let externalStub = false
try {
  shell.openExternal = async (u) => { openedExternal.push(String(u)) }
  externalStub = String(shell.openExternal).includes('openedExternal')
} catch { externalStub = false }

const { comfyDmPatch } = require('./.cache/dm-patch.cjs')
const { installGuestGuards } = require('./.cache/guest-guard.cjs')

const PORT = 18023
const BASE = `http://127.0.0.1:${PORT}`
const FILE = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'
const HF_URL = `https://huggingface.co/lightx2v/Minimax-h3-Turbo/blob/main/${FILE}`
// 「全部下载」用例的第二个模型（另一类目录，URL 带类别路径段）
const FILE2 = 'minimax_h3_video_vae_fp16.safetensors'
const HF_URL2 = `https://huggingface.co/Comfy-Org/MiniMax-H3/blob/main/vae/${FILE2}`
// 用例 K：面板显示名与 URL 实际文件名不一致的行（模拟陈旧 ctx）
const FILE_STALE = 'stale_name.safetensors'
const EXT_URL = 'https://comfyui-wiki.com/docs/guide'

let ended = false
function finish(ok, msg) {
  if (ended) return
  ended = true
  if (ok) console.log('E2E-PASS')
  else console.error('E2E-FAIL: ' + msg)
  app.exit(ok ? 0 : 1)
}
const fail = (msg) => finish(false, msg)
const pass = () => finish(true)
setTimeout(() => fail('整体超时 45s'), 45000)

function basename(u) {
  try {
    return decodeURIComponent(u.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '')
  } catch {
    return ''
  }
}

// ===================== 复刻缺失模型面板 DOM（来自真实前端结构） =====================
function modelRow(testId, filename, category) {
  return [
    `<div class="mb-1 flex w-full flex-col gap-0.5 last:mb-0">`,
    `<div class="flex min-h-8 items-center gap-1">`,
    `<span class="flex min-w-0 flex-1 flex-col gap-0">`,
    `<span class="flex min-w-0 items-center gap-1 text-xs/tight"><button type="button" title="${filename}">${filename}</button></span>`,
    `<span class="block text-2xs/tight text-muted-foreground">${category}</span>`,
    `</span>`,
    `<button data-testid="${testId}" aria-label="下载 ${filename}">下载</button>`,
    `</div></div>`,
  ].join('\n')
}

/** 下载控件是锚点（<a href> 直链）的行——补丁的 click 捕获应直接接管 */
function modelLinkRow(testId, filename, category, href) {
  return [
    `<div class="mb-1 flex w-full flex-col gap-0.5">`,
    `<div class="flex min-h-8 items-center gap-1">`,
    `<span class="flex min-w-0 flex-1 flex-col gap-0">`,
    `<span class="flex min-w-0 items-center gap-1 text-xs/tight">${filename}</span>`,
    `<span class="block text-2xs/tight text-muted-foreground">${category}</span>`,
    `</span>`,
    `<a data-testid="${testId}" href="${href}">下载</a>`,
    `</div></div>`,
  ].join('\n')
}

/** 行显示的模型名与按钮实际下载的 URL 不一致（模拟陈旧 ctx / 别名展示） */
function staleRow(testId, shownName, category) {
  return [
    `<div class="mb-1 flex w-full flex-col gap-0.5">`,
    `<div class="flex min-h-8 items-center gap-1">`,
    `<span class="flex min-w-0 flex-1 flex-col gap-0">`,
    `<span class="flex min-w-0 items-center gap-1 text-xs/tight"><button type="button">${shownName}</button></span>`,
    `<span class="block text-2xs/tight text-muted-foreground">${category}</span>`,
    `</span>`,
    `<button data-testid="${testId}" aria-label="下载 ${shownName}">下载</button>`,
    `</div></div>`,
  ].join('\n')
}

const panelHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>window.__earlyOpen = window.open.bind(window)<\/script>
<div data-testid="missing-model-importable-rows">
${modelRow('missing-model-download', FILE, 'loras')}
${modelRow('missing-model-download-late', FILE, 'loras')}
${modelRow('missing-model-download-nav', FILE, 'loras')}
${modelLinkRow('missing-model-link', FILE, 'loras', HF_URL)}
${modelRow('missing-model-download-f2', FILE2, 'vae')}
${staleRow('missing-model-download-stale', FILE_STALE, 'checkpoints')}
<button data-testid="missing-model-download-all">全部下载</button>
<a data-testid="missing-model-ext-link" href="${EXT_URL}" target="_blank">外部文档</a>
</div>
<script>
// 与生产前端保持一致的几种真实形态
// 1) 模块初始化时 bind 了 window.open（补丁注入晚于前端 bundle 时挂钩拦不到）
document.querySelector('[data-testid=missing-model-download]').addEventListener('click', () => {
  window.__earlyOpen('${HF_URL}', '_blank')
})
// 2) 点击时才取用 window.open（补丁挂钩可拦截）
document.querySelector('[data-testid=missing-model-download-late]').addEventListener('click', () => {
  window.open('${HF_URL}', '_blank')
})
// 3) 本页跳转型下载（page steal，用户遇到过的白屏根因）
document.querySelector('[data-testid=missing-model-download-nav]').addEventListener('click', () => {
  window.location.href = '${HF_URL}'
})
// 4) 全部下载：同一手势内用提前捕获的 open 连发（生产「全部下载」真实形态；乱序打开，模拟线上顺序）
document.querySelector('[data-testid=missing-model-download-all]').addEventListener('click', () => {
  window.__earlyOpen('${HF_URL2}', '_blank')
  window.__earlyOpen('${HF_URL}', '_blank')
})
// 5) 陈旧 ctx：本行展示名是 ${FILE_STALE}，实际下载 ${FILE2}（URL 与行文本对不上）
document.querySelector('[data-testid=missing-model-download-stale]').addEventListener('click', () => {
  window.__earlyOpen('${HF_URL2}', '_blank')
})
<\/script>
</body></html>`

// ===================== 宿主页：webview + console-message 转发（复刻 Workbench 宿主交互） =====================
const hostHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<webview id="wv" allowpopups src="${BASE}/panel" style="width:640px;height:480px"></webview>
<script>
const PATCH_SRC = ${JSON.stringify(String(comfyDmPatch))}
const MARK = '__comfy_dm__', READY = MARK + 'ready', CTX = MARK + 'ctx__', DBG = MARK + 'dbg__'
const wv = document.getElementById('wv')
window.__injectPatch = () => wv.executeJavaScript('void(' + PATCH_SRC + ')();')
wv.addEventListener('console-message', (e) => {
  const m = (e.message || '').trim()
  if (!m.startsWith(MARK)) return
  if (m === READY) { console.log('__t__ready'); return }
  if (m.startsWith(CTX)) { console.log('__t__ctx ' + m.slice(CTX.length)); return }
  if (m.startsWith(DBG)) { console.log('__t__dbg ' + m.slice(DBG.length)); return }
  try { const p = JSON.parse(m.slice(MARK.length)); if (p.url) console.log('__t__report ' + JSON.stringify(p)) } catch {}
})
wv.addEventListener('dom-ready', () => {
  window.__injectPatch()
    .then(() => console.log('__t__injected'))
    .catch((err) => console.log('__t__inject-fail ' + err))
})
<\/script>
</body></html>`

// ===================== 主进程状态与驱动 =====================
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(req.url && req.url.startsWith('/host') ? hostHtml : panelHtml)
})

let win = null
let guestWC = null
let readyCount = 0
let injectedCount = 0
let contentsCount = 0
let windowsCreated = 0
let lastCtx = null
/** 每个接管事件的最终判定结果（文件/类别/通道） */
const takes = []

/** 复刻 Workbench.navModelDownload 处理：用 DOM 行上下文（ctx）精确判定类别。
 * 注意竞态：ctx（guest→宿主的 console-message）与本类事件（主进程广播）顺序不保证，轮询 ≤400ms */
function emulateRendererTakeover(source, url) {
  const base = basename(url)
  void (async () => {
    let fn = base
    let cat = ''
    for (let i = 0; i < 16; i++) {
      const ctx = lastCtx
      // 与生产 Workbench 一致：整窗 ctx 走逐行映射 rows 取本行类别；
      // 单行 ctx 只采信「文件名与 URL 一致」的情况，防陈旧 ctx 串名
      if (ctx && typeof ctx.text === 'string' && ctx.text.includes(base)) {
        if (Array.isArray(ctx.rows)) {
          const row = ctx.rows.find(r => r.filename === base)
          if (row) { fn = base; cat = row.category || ''; break }
        } else if (!ctx.filename || ctx.filename === base) {
          fn = ctx.filename || base
          cat = ctx.category || ''
          break
        }
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    takes.push({ source, filename: fn, category: cat })
    console.log(`  event take via=${source} file=${fn} cat=${cat || '(推断)'}`)
  })()
}

function onHostConsole(_e, _level, message) {
  const m = String(message || '').trim()
  if (m === '__t__ready') readyCount++
  else if (m === '__t__injected') injectedCount++
  else if (m.startsWith('__t__inject-fail')) fail('补丁注入失败: ' + m)
  else if (m.startsWith('__t__ctx ')) {
    try { lastCtx = JSON.parse(m.slice(9)) } catch { /* 非 JSON 上下文，忽略 */ }
  }
  else if (m.startsWith('__t__report ')) { try { const p = JSON.parse(m.slice(12)); takes.push({ source: 'patch-report', filename: p.filename, category: p.category }); console.log(`  event take via=patch-report file=${p.filename} cat=${p.category || '(推断)'}`) } catch { /* noop */ } }
  else if (m.startsWith('__t__dbg ')) console.log('  [dbg]' + m.slice(9))
}

const waitFor = async (fn, ms, what) => {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = fn()
      if (v) return v
    } catch { /* noop */ }
    if (Date.now() - t0 > ms) throw new Error('等待超时: ' + what)
    await new Promise((r) => setTimeout(r, 100))
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

async function clickGuest(testId) {
  // 用真实输入事件（合成 .click() 无用户手势，window.open 会被 Chromium 弹窗拦截器静默吞掉）
  const r = await guestWC.executeJavaScript(`(() => {
    const b = document.querySelector('[data-testid=${JSON.stringify(testId)}]')
    if (!b) return null
    b.scrollIntoView({ block: 'center' })
    const rect = b.getBoundingClientRect()
    return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) }
  })()`)
  if (!r) throw new Error('按钮找不到: ' + testId)
  guestWC.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  guestWC.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 })
}

/** 通用断言：接管发生且类别解析到 loras、页面无弹窗无跳走 */
async function assertTakeover(label, expectedSourceHint) {
  await waitFor(() => takes.length > 0, 4000, label + ' 接管事件')
  const t = takes[0]
  assert(t.filename === FILE, `${label}：文件名解析错误 (${t.filename})`)
  assert(t.category === 'loras', `${label}：类别应为 loras，实际 '${t.category}'`)
  console.log(`  ✓ ${label}：via=${t.source}${expectedSourceHint ? `（${expectedSourceHint}）` : ''} → loras`)
}

/** 断言 guest 主帧仍在面板页、全程无额外弹窗 */
function assertNoEscape(label, winCount) {
  assert(windowsCreated === winCount, `${label}：不应创建弹窗（实际 ${windowsCreated}）`)
  assert(guestWC && guestWC.getURL() === `${BASE}/panel`, `${label}：页面不应被带走，实际 ${guestWC && guestWC.getURL()}`)
}

const reset = () => { takes.length = 0; lastCtx = null }

async function run() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

  installGuestGuards({
    log: (m) => console.log('  [guard-log] ' + m),
    onModel: (kind, url) => emulateRendererTakeover('guard-' + kind, url),
  })

  app.on('web-contents-created', (_e, wc) => {
    contentsCount++
    if (wc.getType() === 'webview') guestWC = wc
  })
  app.on('browser-window-created', () => { windowsCreated++ })

  win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { webviewTag: true },
  })
  windowsCreated = 0 // 主窗口已计入，清零后只统计后续弹窗
  win.webContents.on('console-message', onHostConsole)
  await win.loadURL(`${BASE}/host`)
  await waitFor(() => guestWC, 3000, 'guest webContents 出现')

  console.log('case init: 等待 webview + 补丁注入')
  await waitFor(() => readyCount >= 1 && injectedCount >= 1, 10000, '补丁注入/ready')
  assert(contentsCount === 2, `初始 webContents 数量应为 2（host+guest），实际 ${contentsCount}`)
  console.log('  ✓ 补丁注入成功（ready）')

  // ---------- 用例 A：前端提前 bind window.open（线上故障形态） ----------
  reset()
  await clickGuest('missing-model-download')
  await assertTakeover('A 提前bind window.open', '应经弹窗防火墙兜底')
  assertNoEscape('A', 0)

  // ---------- 用例 B：点击时才取 window.open（补丁挂钩正常拦截） ----------
  reset()
  await clickGuest('missing-model-download-late')
  await assertTakeover('B 后取 window.open')
  assertNoEscape('B', 0)

  // ---------- 用例 C：location.href 本页跳转型下载 ----------
  reset()
  await clickGuest('missing-model-download-nav')
  await assertTakeover('C 本页跳转下载')
  assertNoEscape('C', 0)

  // ---------- 用例 H：锚点 <a href> 模型直链（补丁 click 捕获接管） ----------
  reset()
  await clickGuest('missing-model-link')
  await assertTakeover('H 锚点直链下载', '应经补丁 click 捕获')
  assertNoEscape('H', 0)

  // ---------- 用例 I：非模型外链 target=_blank → 转系统浏览器，不弹窗不跳走 ----------
  if (externalStub) {
    reset(); openedExternal.length = 0
    await clickGuest('missing-model-ext-link')
    await waitFor(() => openedExternal.length > 0, 4000, 'I 外链转系统浏览器')
    assert(openedExternal[0] === EXT_URL, `I：应交系统浏览器打开原链接，实际 ${openedExternal[0]}`)
    assert(takes.length === 0, `I：非模型外链不得被当作模型接管（实际 ${takes.length} 个）`)
    assertNoEscape('I', 0)
    console.log('  ✓ I 非模型外链：转系统浏览器，无弹窗、页面未跳走')
  } else {
    console.log('  ⚠ I 跳过：无法替换 shell.openExternal 桩（避免测试真的拉起浏览器）')
  }

  // ---------- 用例 K：陈旧/无关 ctx 不得串名 ----------
  // 本行展示名 FILE_STALE，实际打开 FILE2 → ctx 与 URL 对不上，必须回退 URL 推导
  reset()
  await clickGuest('missing-model-download-stale')
  await waitFor(() => takes.length > 0, 4000, 'K 陈旧 ctx 接管事件')
  {
    const t = takes[0]
    assert(t.filename === FILE2, `K：应回退到 URL 文件名 ${FILE2}，实际 '${t.filename}'（陈旧 ctx 串名）`)
    assert(t.category === '', `K：应回退 URL 推导（空类别）而非沿用陈旧 ctx 的 'checkpoints'，实际 '${t.category}'`)
    console.log(`  ✓ K 陈旧 ctx 不串名：回退 URL 推导 → ${t.filename}（类别留给主进程按 URL 推断）`)
  }
  assertNoEscape('K', 0)

  // ---------- 用例 F：全部下载（批量连发弹窗，整窗 mousedown ctx 不得串名） ----------
  reset()
  await clickGuest('missing-model-download-all')
  await waitFor(() => takes.length >= 2, 6000, 'F 批量接管事件')
  {
    const files = takes.map(t => t.filename)
    assert(files.includes(FILE) && files.includes(FILE2),
      `F：两个 URL 的文件名必须各自正确且互不串名，实际 ${JSON.stringify(files)}`)
    const t1 = takes.find(t => t.filename === FILE)
    const t2 = takes.find(t => t.filename === FILE2)
    // 整窗 ctx 带逐行映射：每个模型必须拿到自己那行的类别，互不张冠李戴
    assert(t1.category === 'loras', `F：${FILE} 类别应精确为其行类别 loras，实际 '${t1.category}'`)
    assert(t2.category === 'vae', `F：${FILE2} 类别应精确为其行类别 vae，实际 '${t2.category}'`)
    console.log(`  ✓ F 全部下载：${FILE}→loras、${FILE2}→vae 逐行精确`)
  }
  assertNoEscape('F', 0)

  // ---------- 用例 J：重复注入幂等（一次点击只产生一个接管） ----------
  {
    const before = readyCount
    await win.webContents.executeJavaScript(`window.__injectPatch()`)
    await waitFor(() => readyCount >= before + 1, 6000, '重复注入 ready 回执')
    reset()
    await clickGuest('missing-model-download-late')
    await waitFor(() => takes.length > 0, 4000, 'J 重复注入后接管')
    await new Promise((r) => setTimeout(r, 600)) // 留出重复挂钩可能产生的第二个事件
    assert(takes.length === 1, `J：重复注入后一次点击应只产生 1 个接管，实际 ${takes.length}（补丁未幂等）`)
    console.log('  ✓ J 补丁重复注入幂等：一次点击仅 1 个接管')
  }
  assertNoEscape('J', 0)

  // ---------- 用例 D：下载接管之后，刷新 & 再注入 ----------
  const beforeReady = readyCount
  await win.webContents.executeJavaScript(`document.getElementById('wv').reload()`)
  assert(guestWC && guestWC.getURL() === `${BASE}/panel`, 'D：刷新后 URL 应回到面板')
  await waitFor(() => readyCount >= beforeReady + 1, 10000, '刷新后补丁再次就绪')
  console.log('  ✓ D 下载后刷新成功（wv.reload），补丁重新注入')

  // ---------- 用例 E：刷新后仍可接管（复用性） ----------
  // 注：reload 之后 sendInputEvent 不再可靠送达 guest（真实用户输入无此问题），
  // 这里直接在页内走完整事件链：mousedown 触发补丁的 ctx 采集，click 触发业务处理
  reset()
  await new Promise((r) => setTimeout(r, 600))
  await guestWC.executeJavaScript(`(() => {
    const b = document.querySelector('[data-testid="missing-model-download"]')
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    b.click()
  })()`)
  await assertTakeover('E 刷新后再次下载')
  assertNoEscape('E', 0)

  // ---------- 用例 G：beforeunload 武装后刷新不被拦死 ----------
  {
    // 返回值必须可结构化克隆：IIFE 包一层，别把函数/元素对象传回
    await guestWC.executeJavaScript(`(() => { window.onbeforeunload = () => 'unsaved' })()`)
    const before = readyCount
    await win.webContents.executeJavaScript(`(() => { document.getElementById('wv').reload() })()`)
    await waitFor(() => readyCount >= before + 1, 10000, 'beforeunload 武装后 reload 重载成功')
    console.log('  ✓ G beforeunload 武装后刷新照常重载，补丁重新注入')
  }

  // 汇总
  assert(contentsCount === 2, `全过程中不应有额外 webContents（弹窗），实际 ${contentsCount}`)
  pass()
}

app.disableHardwareAcceleration()
app.whenReady()
  .then(run)
  .catch((err) => fail(err && err.stack ? String(err.stack) : String(err)))
