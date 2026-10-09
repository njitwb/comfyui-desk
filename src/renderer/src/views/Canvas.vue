<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { store } from '../store'
import { api } from '../api'
import { t, locale, setLocale } from '../i18n'
import { theme, setTheme } from '../theme'

/** Electron 原生 webview 元素的最小类型（避免引入 electron 类型包） */
interface WebviewEl extends HTMLElement {
  reload(): void
  getURL(): string
  send(channel: string, ...args: unknown[]): Promise<void>
}

const emit = defineEmits<{ nav: [k: string] }>()

/** 画布 webview 预加载桥（resources/canvas-preload.cjs 的 file:// 地址，主进程计算） */
const preloadUrl = ref('')
/** 画布 URL：?comfyuiUrl= 注入管家实际运行的 ComfyUI 地址，?theme/?lang= 提供首帧主题/语言（防闪烁） */
function buildSrc(): string {
  const base = `http://127.0.0.1:${store.info?.port || 8188}`
  return `canvas://app/?comfyuiUrl=${encodeURIComponent(base)}&theme=${theme.value}&lang=${locale.value}`
}
/** 只随端口变化重建，主题/语言走 webview.send 即时推送（避免整页重载） */
const srcUrl = ref('')

const webviewEl = ref<WebviewEl | null>(null)
/** 首次 dom-ready 前显示“加载中”底衬 */
const ready = ref(false)
/** 递增 key 强制 Vue 重建 webview 元素（新 guest 进程，从 :src 全新加载） */
const wvKey = ref(0)

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: msg }))
}

function onNewWindow(e: Event) {
  // 一律阻止默认行为：SPA 里 window.open 的外链（如 GitHub 提示词源）转系统浏览器
  ;(e as { preventDefault?: () => void }).preventDefault?.()
  const u = (e as { url?: string }).url
  if (u) void api.openExternal(u)
}

/** 把当前主题/语言推给画布（webview.send → 预加载桥 ipcRenderer.on → SPA） */
function pushAppearance(): void {
  const wv = webviewEl.value
  if (!wv) return
  void wv.send('cd:appearance', { theme: theme.value, locale: locale.value }).catch(() => {
    /* guest 销毁时 send 会拒绝，忽略 */
  })
}

function onDomReady() {
  ready.value = true
  pushAppearance()
}

/** 画布内切换主题/语言（ipcRenderer.sendToHost）→ 同步桌面并落盘（随后桌面再推回画布，幂等无环） */
function onIpcMessage(e: Event) {
  const d = e as { channel?: string; args?: unknown[] }
  if (d.channel !== 'cd:appearance') return
  const data = (d.args?.[0] ?? {}) as { theme?: unknown; locale?: unknown }
  if (data.theme === 'light' || data.theme === 'dark') {
    setTheme(data.theme)
    void api.saveSettings({ theme: data.theme })
  }
  if (data.locale === 'zh' || data.locale === 'en') {
    setLocale(data.locale)
    void api.saveSettings({ locale: data.locale })
  }
}

function onFailLoad(e: Event) {
  const d = e as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
  if (d.isMainFrame === false) return
  toast(t('cv.loadFailed', { msg: d.errorDescription || d.errorCode || t('cv.loadFailedUnknown') }))
}

/** guest 渲染进程崩溃 / 长时间无响应 → 自动恢复，不让画布卡死 */
function onGone() {
  toast(t('cv.crashed'))
  setTimeout(reload, 400)
}

function attach(wv: WebviewEl | null) {
  detach()
  if (!wv) return
  wv.addEventListener('new-window', onNewWindow as EventListener)
  wv.addEventListener('dom-ready', onDomReady)
  wv.addEventListener('did-fail-load', onFailLoad as EventListener)
  wv.addEventListener('render-process-gone', onGone as EventListener)
  wv.addEventListener('unresponsive', onGone as EventListener)
  wv.addEventListener('ipc-message', onIpcMessage as EventListener)
}

function detach() {
  const wv = webviewEl.value
  if (!wv) return
  wv.removeEventListener('new-window', onNewWindow as EventListener)
  wv.removeEventListener('dom-ready', onDomReady)
  wv.removeEventListener('did-fail-load', onFailLoad as EventListener)
  wv.removeEventListener('render-process-gone', onGone as EventListener)
  wv.removeEventListener('unresponsive', onGone as EventListener)
  wv.removeEventListener('ipc-message', onIpcMessage as EventListener)
}

// 画布常驻挂载（v-show），无 running 依赖；端口变化时重建 webview 从新 URL 加载
watch(() => store.info?.port, () => {
  srcUrl.value = buildSrc()
  rebuildWebview()
})
// 主题/语言变化 → 即时推送给画布（不重建）
watch([theme, locale], pushAppearance)

onMounted(async () => {
  window.addEventListener('keydown', onEsc)
  preloadUrl.value = (await api.getCanvasPreloadUrl()) || ''
  srcUrl.value = buildSrc()
  await nextTick()
  attach(webviewEl.value)
})

onBeforeUnmount(() => {
  detach()
  exitFullscreen()
  window.removeEventListener('keydown', onEsc)
})

function reload() {
  ready.value = false
  const wv = webviewEl.value
  if (!wv) return
  // 不用 loadURL：给 src 赋同值不触发重载；guest 不在 canvas 界面（加载失败/白屏）则重建
  let cur = ''
  try {
    cur = wv.getURL()
  } catch {
    /* noop */
  }
  if (!cur || !/^canvas:\/\/app(?:[/?#]|$)/i.test(cur)) {
    rebuildWebview()
    return
  }
  try {
    wv.reload()
  } catch {
    rebuildWebview()
    return
  }
  // 看门狗：8s 内 dom-ready 没来（guest 假死）则强制重建
  setTimeout(() => {
    if (!ready.value) rebuildWebview()
  }, 8000)
}

/** 销毁并重建 webview 元素（换 key），重新挂载事件监听 */
async function rebuildWebview(): Promise<void> {
  ready.value = false
  detach()
  wvKey.value++
  await nextTick()
  attach(webviewEl.value)
}

function openInBrowser() {
  void api.openExternal(srcUrl.value)
}

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
</script>

<template>
  <div class="cv-page">
    <div class="row cv-head">
      <div class="page-title">{{ t('cv.title') }}</div>
      <span class="muted mono">{{ srcUrl }}</span>
      <div class="spacer"></div>
      <button class="btn small" @click="reload">{{ t('common.refresh') }}</button>
      <button class="btn small" @click="openInBrowser">{{ t('wb.openInBrowser') }}</button>
      <button class="btn small" @click="enterFullscreen">{{ t('wb.fullscreen') }}</button>
    </div>

    <div class="canvas-box" :class="{ fullscreen }">
      <button v-if="fullscreen" class="btn small cv-exit-full" @click="exitFullscreen">{{ t('wb.exitFullscreen') }}</button>
      <div v-if="!ready" class="cv-loading muted">{{ t('cv.loading') }}</div>
      <webview v-if="preloadUrl" ref="webviewEl" :key="wvKey" :src="srcUrl" :preload="preloadUrl" class="cv-view" allowpopups></webview>
    </div>
  </div>
</template>

<style scoped>
.cv-head {
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.cv-head .page-title {
  margin: 0;
}
.cv-page {
  display: flex;
  flex-direction: column;
  /* 恰好填满 .main 内容区（上下各 22px 内边距），webview 自适应撑满剩余空间 */
  height: calc(100vh - 44px);
}
.canvas-box {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 全屏：覆盖整个启动器窗口（toast z-index 99，保持可见） */
.canvas-box.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.canvas-box.fullscreen .cv-view {
  border: none;
  border-radius: 0;
}
.cv-exit-full {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 81;
  opacity: 0.75;
}
.cv-exit-full:hover {
  opacity: 1;
}
.cv-view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
.cv-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
</style>
