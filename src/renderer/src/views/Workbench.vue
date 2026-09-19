<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { store } from '../store'
import { api } from '../api'
import { t } from '../i18n'
import { theme } from '../theme'
import { comfyDmPatch } from '../../../shared/dm-patch'
import type { Theme } from '../../../shared/appearance'
import type { MessageKey } from '../../../shared/i18n'
import type { ComfyStatus } from '../../../shared/api'

/** Electron 原生 webview 元素的最小类型（避免引入 electron 类型包） */
interface WebviewEl extends HTMLElement {
  reload(): void
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
}

const emit = defineEmits<{ nav: [k: string] }>()

const running = computed(() => store.status === 'running')
const url = computed(() => `http://127.0.0.1:${store.info?.port || 8188}/`)
const statusText: Record<ComfyStatus, MessageKey> = {
  stopped: 'wb.status.stopped',
  starting: 'wb.status.starting',
  running: 'wb.status.running',
  error: 'wb.status.error'
}

const webviewEl = ref<WebviewEl | null>(null)
/** webview 首次 dom-ready 前显示“加载中”底衬 */
const ready = ref(false)
/** 补丁注入成功回执，用于标题栏「接管」标识 */
const dmReady = ref(false)

const CONSOLE_MARK = '__comfy_dm__'
const CONSOLE_READY = CONSOLE_MARK + 'ready'
const CONSOLE_CTX = CONSOLE_MARK + 'ctx__'
const CONSOLE_DBG = CONSOLE_MARK + 'dbg__'

/** 最近一次在 guest 里 mousedown 抓到的下载行上下文 */
interface DmCtx {
  text: string
  filename: string
  category: string
  /** 整窗命中（全部下载）时逐行抽取的「文件名 → 类别」映射 */
  rows?: { filename: string; category: string }[]
  at: number
}
let lastCtx: DmCtx | null = null

const MODEL_URL_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)(\?[^\s]*)?(#[^\s]*)?$/i
function isModelUrl(u: string): boolean {
  return /^https?:\/\//i.test(u) && MODEL_URL_RE.test(u)
}
function baseName(u: string): string {
  try {
    return decodeURIComponent(u.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '')
  } catch {
    return ''
  }
}

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: msg }))
}

/** 接管模型下载：交给主进程下载管理器 + 跳模型管理 + 轻提示 */
function takeDownload(dlUrl: string, filename?: string, category?: string, source = 'console-report'): void {
  // 记录完整接管链路，便于排查类别错配
  void api.logInfo(
    t('wb.dm.log', {
      source,
      filename: filename || '',
      category: category || t('wb.dm.logNoCategory'),
      url: dlUrl
    })
  )
  void api
    .startDownload({ url: dlUrl, filename, category, useHfMirror: true })
    .then(() => emit('nav', 'models'))
    .catch((err: unknown) => toast(t('wb.dm.addFailed', { msg: (err as Error).message || String(err) })))
}

/** dom-ready 后把拦截补丁注入 guest 主世界 */
async function injectDmPatch(): Promise<void> {
  const wv = webviewEl.value
  if (!wv) return
  if (typeof wv.executeJavaScript !== 'function') {
    toast(t('wb.dm.patchUnsupported'))
    return
  }
  try {
    await wv.executeJavaScript(`void (${comfyDmPatch.toString()})();`)
  } catch (e) {
    toast(t('wb.dm.patchLoadFailed', { msg: String((e as Error).message || e) }))
  }
}

/** guest 加载失败时提示，便于区分「按钮失灵」与「页面卡死」 */
function onFailLoad(e: Event) {
  const d = e as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
  if (d.isMainFrame === false) return
  toast(t('wb.loadFailed', { msg: d.errorDescription || d.errorCode || t('wb.loadFailedUnknown') }))
}

/** guest 控制台消息：补丁 ready 回执 / 点击上下文 / 模型下载请求 */
function onConsoleMessage(e: Event) {
  const msg = ((e as { message?: string }).message || '').trim()
  if (!msg.startsWith(CONSOLE_MARK)) return
  if (msg === CONSOLE_READY) { dmReady.value = true; return }
  if (msg.startsWith(CONSOLE_CTX)) {
    try {
      const c = JSON.parse(msg.slice(CONSOLE_CTX.length)) as { text: string; filename: string; category: string }
      lastCtx = { ...c, at: Date.now() }
    } catch { /* ignore */ }
    return
  }
  if (msg.startsWith(CONSOLE_DBG)) {
    void api.logInfo('dbg: ' + msg.slice(CONSOLE_DBG.length))
    return
  }
  try {
    const p = JSON.parse(msg.slice(CONSOLE_MARK.length)) as { url?: string; filename?: string; category?: string }
    if (p.url) takeDownload(p.url, p.filename, p.category)
  } catch {
    /* ignore：非下载类控制台输出 */
  }
}

// 主进程防火墙（弹窗 / 本页跳转）转来的模型下载：按 DOM 行上下文精确接管。
// ctx 与主进程广播到达顺序不保证，轮询 ≤400ms 等待
api.onNavModelDownload(({ url }) => {
  const base = baseName(url)
  void (async () => {
    for (let i = 0; i < 16; i++) {
      const c = lastCtx
      if (c && Date.now() - c.at < 5000 && c.text.includes(base)) {
        // 整窗 ctx（全部下载）：按逐行映射取该 URL 自己那行的类别
        if (c.rows) {
          const row = c.rows.find(r => r.filename === base)
          if (row) {
            takeDownload(url, base, row.category || undefined, 'nav')
            return
          }
        } else if (!c.filename || c.filename === base) {
          // 单行 ctx 只在文件名对得上时采信，否则回退 URL 推导（防陈旧 ctx 串名）
          takeDownload(url, c.filename || base, c.category || undefined, 'nav')
          return
        }
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    takeDownload(url, base, undefined, 'nav')
  })()
})

function onNewWindow(e: Event) {
  // 一律阻止默认行为：不阻止时 Electron 会为 window.open 创建原生弹窗（之前的白屏窗口）
  ;(e as { preventDefault?: () => void }).preventDefault?.()
  const u = (e as { url?: string }).url
  if (!u) return
  // 兜底：页面级拦截漏网时，在弹窗出口拦下模型链接（主进程 web-contents-created 还有一道防火墙）
  if (isModelUrl(u)) { takeDownload(u, baseName(u)); return }
  void api.openExternal(u)
}
function onDomReady() {
  ready.value = true
  void injectDmPatch()
}

/** 主题联动：把启动器主题写进内嵌 ComfyUI 的调色板设置（即时换肤，并由其自身落盘） */
function applyComfyPalette(v: string): void {
  const ui = (window as { app?: { ui?: { settings?: { setSettingValueAsync?: (id: string, value: unknown) => Promise<void> } } } }).app
    ?.ui
  void ui?.settings?.setSettingValueAsync?.('Comfy.ColorPalette', v)
}

/** 主题联动：把主题注入内嵌 ComfyUI 页面（即时换肤；落盘由主进程负责） */
function applyLiveTheme(v: Theme): void {
  const wv = webviewEl.value
  if (!running.value || !wv || typeof wv.executeJavaScript !== 'function') return
  if (store.settings?.syncComfyTheme !== true) return
  void wv.executeJavaScript(`void (${applyComfyPalette.toString()})(${JSON.stringify(v)});`).catch(() => undefined)
}

watch(theme, applyLiveTheme)
/** 刚打开联动开关时补写一次：否则运行中的页面要刷新才会变色 */
watch(
  () => store.settings?.syncComfyTheme,
  on => {
    if (on === true) applyLiveTheme(theme.value)
  }
)

function attach(wv: WebviewEl | null) {
  detach()
  if (!wv) return
  wv.addEventListener('new-window', onNewWindow as EventListener)
  wv.addEventListener('dom-ready', onDomReady)
  wv.addEventListener('console-message', onConsoleMessage as EventListener)
  wv.addEventListener('did-fail-load', onFailLoad as EventListener)
  wv.addEventListener('render-process-gone', onGone as EventListener)
  wv.addEventListener('unresponsive', onGone as EventListener)
}
function detach() {
  const wv = webviewEl.value
  if (!wv) return
  wv.removeEventListener('new-window', onNewWindow as EventListener)
  wv.removeEventListener('dom-ready', onDomReady)
  wv.removeEventListener('console-message', onConsoleMessage as EventListener)
  wv.removeEventListener('did-fail-load', onFailLoad as EventListener)
  wv.removeEventListener('render-process-gone', onGone as EventListener)
  wv.removeEventListener('unresponsive', onGone as EventListener)
}

// 仅在 running 时挂载 webview；停止 / 重启时销毁并复位加载状态
watch(
  running,
  async r => {
    if (r) await nextTick()
    detach()
    if (r) attach(webviewEl.value)
    if (!r) {
      ready.value = false
      exitFullscreen()
    }
  },
  { immediate: true }
)

// ---- 全屏：webview 覆盖整个启动器窗口，同时联动原生窗口全屏；Esc 退出 ----
const fullscreen = ref(false)

async function enterFullscreen() {
  fullscreen.value = true
  await api.setFullScreen(true)
}
function exitFullscreen() {
  if (!fullscreen.value) return
  fullscreen.value = false
  void api.setFullScreen(false)
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') exitFullscreen()
}
onMounted(() => window.addEventListener('keydown', onEsc))
// 工作台常驻挂载（v-show），切页无生命周期钩子；全屏退出由 running 监听兜底

onBeforeUnmount(() => {
  detach()
  exitFullscreen()
  window.removeEventListener('keydown', onEsc)
})

/** 递增 key 强制 Vue 重建 webview 元素（新 guest 进程，从 :src 全新加载） */
const wvKey = ref(0)

function reload() {
  ready.value = false
  dmReady.value = false // 刷新后补丁需重新注入，徽章先隐藏
  const wv = webviewEl.value
  if (!wv) return
  // 不用 loadURL：被拦截过导航后 loadURL 会稳定报 ERR_FAILED(-2)，且给 src 赋同值不触发重载
  let cur = ''
  try { cur = wv.getURL() } catch { /* noop */ }
  if (!cur || !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(cur)) {
    // guest 不在本机界面（加载失败/白屏）：重建 webview 从 :src 全新加载
    rebuildWebview()
    return
  }
  try { wv.reload() } catch { rebuildWebview(); return }
  // 看门狗：8s 内 dom-ready 没来（guest 假死）则强制重建
  setTimeout(() => { if (!ready.value) rebuildWebview() }, 8000)
}

/** 销毁并重建 webview 元素（换 key），重新挂载事件监听 */
async function rebuildWebview(): Promise<void> {
  void api.logInfo(t('wb.reloadRebuild'))
  detach()
  wvKey.value++
  await nextTick()
  attach(webviewEl.value)
}

/** guest 渲染进程崩溃 / 长时间无响应 → 自动恢复，不让工作台卡死 */
function onGone() {
  toast(t('wb.crashed'))
  setTimeout(reload, 400)
}
function openInBrowser() {
  void api.openExternal(url.value)
}

/** 未运行时直接在本页启动，省去切到仪表盘再切回 */
const starting = ref(false)
const startError = ref('')

async function startComfy(): Promise<void> {
  starting.value = true
  startError.value = ''
  try {
    await api.start()
  } catch (e) {
    startError.value = (e as Error).message || String(e)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="wb-page">
    <div class="row wb-head">
      <div class="page-title">{{ t('wb.title') }}</div>
      <template v-if="store.info?.installed">
        <span class="pill" :class="store.status">
          <span class="dot"></span>{{ t(statusText[store.status]) }}
        </span>
        <span class="muted mono">{{ url }}</span>
        <span v-if="running && dmReady" class="pill running" :title="t('wb.dm.takenTip')">{{ t('wb.dm.taken') }}</span>
        <div class="spacer"></div>
        <button class="btn small" :disabled="!running" @click="reload">{{ t('common.refresh') }}</button>
        <button class="btn small" :disabled="!running" @click="openInBrowser">{{ t('wb.openInBrowser') }}</button>
        <button class="btn small" :disabled="!running" @click="enterFullscreen">{{ t('wb.fullscreen') }}</button>
      </template>
    </div>

    <div v-if="!store.info?.installed" class="card" style="text-align: center; padding: 40px">
      <div style="font-size: 16px; margin-bottom: 8px">{{ t('wb.notInstalledTitle') }}</div>
      <div class="muted" style="margin-bottom: 18px">{{ t('wb.notInstalledDesc') }}</div>
      <div class="row" style="justify-content: center">
        <button class="btn primary" @click="emit('nav', 'install')">{{ t('wb.installNow') }}</button>
      </div>
    </div>

    <div v-else class="workbench" :class="{ fullscreen }">
      <button v-if="fullscreen" class="btn small wb-exit-full" @click="exitFullscreen">{{ t('wb.exitFullscreen') }}</button>
      <template v-if="running">
        <div v-if="!ready" class="wb-loading muted">{{ t('wb.loading') }}</div>
        <webview ref="webviewEl" :key="wvKey" :src="url" class="wb-view" allowpopups></webview>
      </template>
      <div v-else class="wb-off card">
        <div style="font-size: 15px; margin-bottom: 8px">{{ t('wb.notRunningTitle') }}</div>
        <div class="muted" style="margin-bottom: 18px">{{ t('wb.notRunningDesc') }}</div>
        <button
          class="btn primary"
          :disabled="starting || store.status === 'starting'"
          @click="startComfy"
        >
          {{ starting || store.status === 'starting' ? t('wb.status.starting') : t('wb.start') }}
        </button>
        <div v-if="startError" class="mono" style="color: var(--red); margin-top: 12px; word-break: break-all">
          {{ startError }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 状态/地址/操作与标题合并为一行，最大化 webview 可视面积 */
.wb-head {
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.wb-head .page-title {
  margin: 0;
}
.wb-page {
  display: flex;
  flex-direction: column;
  /* 恰好填满 .main 内容区（上下各 22px 内边距），webview 自适应撑满剩余空间 */
  height: calc(100vh - 44px);
}
.workbench {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 全屏：覆盖整个启动器窗口（toast z-index 99，保持可见） */
.workbench.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.workbench.fullscreen .wb-view {
  border: none;
  border-radius: 0;
}
.wb-exit-full {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 81;
  opacity: 0.75;
}
.wb-exit-full:hover {
  opacity: 1;
}
.wb-view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
.wb-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
.wb-off {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-bottom: 0;
}
</style>
