<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { store, refreshDsh, refreshSettings } from '../store'
import { api } from '../api'
import { t } from '../i18n'

/** Electron 原生 webview 元素的最小类型（避免引入 electron 类型包） */
interface WebviewEl extends HTMLElement {
  reload(): void
  getURL(): string
}

/**
 * DeepSeek Harness 标签页：内嵌 dsh 自己的 Web UI。
 *
 * dsh 的 Web 端每个 /api 与 WebSocket 请求都要求先凭启动时打印的一次性 token 换取会话 cookie，
 * 所以这里必须加载「带 token 的地址」（store.dsh.url），而不是裸的 http://127.0.0.1:port。
 * 换到的 cookie 是 host-only + Path=/，页面内刷新不会丢。
 */
const srcUrl = ref('')
/** 展示用地址：一次性 token 打码，避免明文出现在界面上 */
const displayUrl = computed(() => srcUrl.value.replace(/([?&]token=)[^&]*/i, '$1••••••'))

const dshChip = computed(() => {
  const st = store.dsh?.status
  if (st === 'running') return { cls: 'running', text: t('hv.status.running') }
  if (st === 'starting') return { cls: 'starting', text: t('hv.status.starting') }
  if (st === 'error') return { cls: 'error', text: t('hv.status.error') }
  return { cls: 'stopped', text: t('hv.status.stopped') }
})

const webviewEl = ref<WebviewEl | null>(null)
const ready = ref(false)
/** 递增 key 强制 Vue 重建 webview 元素（新 guest 进程，从 :src 全新加载） */
const wvKey = ref(0)
const starting = ref(false)

function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: msg }))
}

function onNewWindow(e: Event) {
  ;(e as { preventDefault?: () => void }).preventDefault?.()
  const u = (e as { url?: string }).url
  if (u) void api.openExternal(u)
}

function onDomReady() {
  ready.value = true
}

function onFailLoad(e: Event) {
  const d = e as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
  if (d.isMainFrame === false) return
  toast(t('hv.loadFailed', { msg: d.errorDescription || d.errorCode || t('hv.loadFailedUnknown') }))
}

/** guest 渲染进程崩溃 / 长时间无响应 → 自动恢复 */
function onGone() {
  toast(t('hv.crashed'))
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
}

function detach() {
  const wv = webviewEl.value
  if (!wv) return
  wv.removeEventListener('new-window', onNewWindow as EventListener)
  wv.removeEventListener('dom-ready', onDomReady)
  wv.removeEventListener('did-fail-load', onFailLoad as EventListener)
  wv.removeEventListener('render-process-gone', onGone as EventListener)
  wv.removeEventListener('unresponsive', onGone as EventListener)
}

/** 销毁并重建 webview 元素（换 key），重新挂载事件监听 */
async function rebuildWebview(): Promise<void> {
  ready.value = false
  detach()
  wvKey.value++
  await nextTick()
  attach(webviewEl.value)
}

function reload() {
  ready.value = false
  const wv = webviewEl.value
  if (!wv) return
  let cur = ''
  try {
    cur = wv.getURL()
  } catch {
    /* noop */
  }
  if (!cur || !/^https?:\/\/127\.0\.0\.1(?::\d+)?(?:[/?#]|$)/i.test(cur)) {
    void rebuildWebview()
    return
  }
  try {
    wv.reload()
  } catch {
    void rebuildWebview()
    return
  }
  setTimeout(() => {
    if (!ready.value) void rebuildWebview()
  }, 8000)
}

// Harness 地址变化（重启后 token 变）→ 重建 webview 从新地址加载
watch(
  () => store.dsh?.url || '',
  () => {
    const next = store.dsh?.url || ''
    if (!next || next === srcUrl.value) return
    srcUrl.value = next
    void rebuildWebview()
  }
)

/** 等待 Harness 就绪：running 即取地址；error/stopped 立即返回不阻塞；最长 70s（首次初始化 profile 较慢） */
async function waitForDsh(timeoutMs = 70000): Promise<void> {
  if (!store.settings) await refreshSettings()
  if (store.settings?.['dshEnabled'] === false) return
  await refreshDsh()
  if (store.dsh?.status === 'running') return
  try {
    store.dsh = await api.dshStart()
  } catch {
    /* 主进程未就绪时忽略，按超时处理 */
  }
  const deadline = Date.now() + timeoutMs
  while (store.dsh?.status === 'starting' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400))
    await refreshDsh()
  }
}

/** 手动启动（未运行时占位卡片上的按钮） */
async function startNow(): Promise<void> {
  starting.value = true
  try {
    store.dsh = await api.dshStart()
    if (store.dsh.url) {
      srcUrl.value = store.dsh.url
      await nextTick()
      attach(webviewEl.value)
    }
  } finally {
    starting.value = false
  }
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

onMounted(async () => {
  window.addEventListener('keydown', onEsc)
  await waitForDsh()
  if (store.dsh?.url) {
    srcUrl.value = store.dsh.url
    await nextTick()
    attach(webviewEl.value)
  }
})

onBeforeUnmount(() => {
  detach()
  exitFullscreen()
  window.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <div class="hv-page">
    <div class="row hv-head">
      <div class="page-title">{{ t('hv.title') }}</div>
      <span class="pill" :class="dshChip.cls"><span class="dot"></span>{{ dshChip.text }}</span>
      <span class="muted mono">{{ displayUrl }}</span>
      <div class="spacer"></div>
      <button class="btn small" @click="reload">{{ t('common.refresh') }}</button>
      <button class="btn small" :disabled="!srcUrl" @click="openInBrowser">{{ t('wb.openInBrowser') }}</button>
      <button class="btn small" :disabled="!srcUrl" @click="enterFullscreen">{{ t('wb.fullscreen') }}</button>
    </div>

    <div class="harness-box" :class="{ fullscreen }">
      <button v-if="fullscreen" class="btn small hv-exit-full" @click="exitFullscreen">{{ t('wb.exitFullscreen') }}</button>

      <!-- 未就绪：占位说明 + 手动启动 -->
      <div v-if="!srcUrl" class="hv-off">
        <div class="hv-off-title">{{ t('hv.off.title') }}</div>
        <div class="muted" style="margin: 6px 0 14px">{{ t('hv.off.desc') }}</div>
        <div v-if="store.dsh?.error" class="hv-err mono">{{ store.dsh.error }}</div>
        <button class="btn" :disabled="starting || store.dsh?.status === 'starting'" @click="startNow">
          {{ store.dsh?.status === 'starting' ? t('hv.status.starting') : t('hv.start') }}
        </button>
        <div class="muted" style="margin-top: 14px; font-size: 12px">{{ t('hv.sub') }}</div>
      </div>

      <template v-else>
        <div v-if="!ready" class="hv-loading muted">{{ t('hv.loading') }}</div>
        <webview ref="webviewEl" :key="wvKey" :src="srcUrl" class="hv-view" allowpopups></webview>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hv-head {
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.hv-head .page-title {
  margin: 0;
}
.hv-page {
  display: flex;
  flex-direction: column;
  /* 恰好填满 .main 内容区（上下各 22px 内边距） */
  height: calc(100vh - 44px);
}
.harness-box {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.harness-box.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.harness-box.fullscreen .hv-view {
  border: none;
  border-radius: 0;
}
.hv-exit-full {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 81;
  opacity: 0.75;
}
.hv-exit-full:hover {
  opacity: 1;
}
.hv-view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
.hv-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
.hv-off {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-soft);
  padding: 24px;
}
.hv-off-title {
  font-size: 15px;
  font-weight: 600;
}
.hv-err {
  max-width: 560px;
  margin-bottom: 14px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--tint-red);
  color: var(--red);
  font-size: 12px;
  word-break: break-all;
}
</style>
