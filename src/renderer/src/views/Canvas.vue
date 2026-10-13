<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { store, refreshAgent, refreshDsh, refreshSettings } from '../store'
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
/** 画布 URL：?comfyuiUrl= 注入管家实际运行的 ComfyUI 地址，?theme/?lang= 提供首帧主题/语言（防闪烁），
 *  ?agentUrl/?agentToken= 让画布内 SPA 自动连接本地伴生服务（Agent 未就绪时不注入，避免连错端口） */
function buildSrc(): string {
  const base = `http://127.0.0.1:${store.info?.port || 8188}`
  let src = `canvas://app/?comfyuiUrl=${encodeURIComponent(base)}&theme=${theme.value}&lang=${locale.value}`
  const agent = store.agent
  if (agent?.url && agent.token) {
    src += `&agentUrl=${encodeURIComponent(agent.url)}&agentToken=${encodeURIComponent(agent.token)}`
  }
  return src
}
/** 只随端口 / Agent 信息变化重建，主题/语言走 webview.send 即时推送（避免整页重载） */
const srcUrl = ref('')
/** 展示用 URL：连接令牌打码，避免明文出现在标题栏 */
const displayUrl = computed(() => srcUrl.value.replace(/agentToken=[^&]*/i, 'agentToken=••••••'))

/** 画布 Agent 状态徽标 */
const agentChip = computed(() => {
  const st = store.agent?.status
  if (st === 'running') return { cls: 'running', text: t('cv.agent.connected') }
  if (st === 'starting') return { cls: 'starting', text: t('cv.agent.starting') }
  if (st === 'error') return { cls: 'error', text: t('cv.agent.error') }
  return { cls: 'stopped', text: t('cv.agent.off') }
})

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
  pushDockState()
}

/** 画布内切换主题/语言（ipcRenderer.sendToHost）→ 同步桌面并落盘（随后桌面再推回画布，幂等无环） */
function onIpcMessage(e: Event) {
  const d = e as { channel?: string; args?: unknown[] }
  // 画布内点 Agent 按钮 → 开关右侧的 Harness（dsh）对话 dock
  if (d.channel === 'cd:agent-dock') {
    const data = (d.args?.[0] ?? {}) as { action?: unknown }
    if (data.action === 'toggle') setDockOpen(!dockOpen.value)
    return
  }
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
// Agent 信息（url/token）变化 → 重建，让画布带上最新参数重新连接（覆盖慢启动 / 中途开关 / 令牌变化）
watch(
  () => `${store.agent?.url || ''}|${store.agent?.token || ''}`,
  () => {
    if (!srcUrl.value) return
    const next = buildSrc()
    if (next === srcUrl.value) return
    srcUrl.value = next
    rebuildWebview()
  }
)
// 主题/语言变化 → 即时推送给画布（不重建）
watch([theme, locale], pushAppearance)

/** 等待伴生服务就绪：running 即通过；error/stopped 立即返回不阻塞；最长 12s */
async function waitForAgent(timeoutMs = 12000): Promise<void> {
  if (!store.settings) await refreshSettings()
  if (store.settings?.['canvasAgentEnabled'] === false) return
  await refreshAgent()
  if (store.agent?.status === 'running') return
  // 兜底再触发一次（幂等）：主进程可能还在启动中，或上次启动失败需要重试
  try {
    store.agent = await api.agentStart()
  } catch {
    /* 主进程未就绪时忽略，按超时处理 */
  }
  const deadline = Date.now() + timeoutMs
  while (store.agent?.status === 'starting' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300))
    await refreshAgent()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onEsc)
  preloadUrl.value = (await api.getCanvasPreloadUrl()) || ''
  await waitForAgent()
  srcUrl.value = buildSrc()
  await nextTick()
  attach(webviewEl.value)
  // 上次退出时 dock 是开的，重进后接着开
  if (dockOpen.value) void ensureDsh()
})

onBeforeUnmount(() => {
  detach()
  detachDsh()
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

// ---- 右侧 Harness（dsh）对话 dock：画布里的 agent 界面直接内嵌 dsh 原生 Web UI ----
// 不能在画布 SPA（canvas://app）里用 iframe 内嵌 dsh：dsh 的鉴权用 SameSite=Strict 的 cookie，
// 跨站的 iframe 不会带上它，界面会因鉴权失败而空转。这里改用顶层 <webview>（与 Harness 标签同机制）。
const DOCK_OPEN_KEY = 'canvas-harness-dock-open'
/** dock 固定宽度（不随窗口/拖拽变化） */
const DOCK_WIDTH = 440
const dockOpen = ref(localStorage.getItem(DOCK_OPEN_KEY) === '1')
const dshUrl = ref('')
const dshReady = ref(false)
const dshStarting = ref(false)
const dshWebviewEl = ref<WebviewEl | null>(null)
/** 递增 key 强制重建 dsh webview（换端口 / 重启后 token 变） */
const dshWvKey = ref(0)

const dshChip = computed(() => {
  const st = store.dsh?.status
  if (st === 'running') return { cls: 'running', text: t('hv.status.running') }
  if (st === 'starting') return { cls: 'starting', text: t('hv.status.starting') }
  if (st === 'error') return { cls: 'error', text: t('hv.status.error') }
  return { cls: 'stopped', text: t('hv.status.stopped') }
})

function setDockOpen(open: boolean): void {
  dockOpen.value = open
  localStorage.setItem(DOCK_OPEN_KEY, open ? '1' : '0')
  pushDockState()
  if (open) void ensureDsh()
}

/** 把 dock 开关状态推给画布 SPA，用于高亮工具栏里的 Agent 按钮 */
function pushDockState(): void {
  const wv = webviewEl.value
  if (!wv) return
  void wv.send('cd:agent-dock', { open: dockOpen.value }).catch(() => {
    /* guest 销毁时 send 会拒绝，忽略 */
  })
}

/** 确保 dsh 在跑（画布与 Harness 标签共用同一个 dsh 进程） */
async function ensureDsh(): Promise<void> {
  if (!store.settings) await refreshSettings()
  if (store.settings?.['dshEnabled'] === false) return
  await refreshDsh()
  if (store.dsh?.status !== 'running' || !store.dsh.url) {
    dshStarting.value = true
    try {
      store.dsh = await api.dshStart()
    } catch {
      /* 主进程未就绪时忽略，按超时处理 */
    } finally {
      dshStarting.value = false
    }
  }
  const deadline = Date.now() + 70000
  while (store.dsh?.status === 'starting' && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400))
    await refreshDsh()
  }
  syncDshUrl()
}

/** dsh 地址变化（首次就绪 / 重启后 token 变）→ 让 webview 从新地址加载 */
function syncDshUrl(): void {
  const next = store.dsh?.url || ''
  if (!next || next === dshUrl.value) return
  dshUrl.value = next
  void rebuildDshWebview()
}

function attachDsh(wv: WebviewEl | null): void {
  detachDsh()
  if (!wv) return
  wv.addEventListener('new-window', onNewWindow as EventListener)
  wv.addEventListener('dom-ready', onDshReady)
  wv.addEventListener('did-fail-load', onDshFailLoad as EventListener)
  wv.addEventListener('render-process-gone', onDshGone as EventListener)
  wv.addEventListener('unresponsive', onDshGone as EventListener)
}

function detachDsh(): void {
  const wv = dshWebviewEl.value
  if (!wv) return
  wv.removeEventListener('new-window', onNewWindow as EventListener)
  wv.removeEventListener('dom-ready', onDshReady)
  wv.removeEventListener('did-fail-load', onDshFailLoad as EventListener)
  wv.removeEventListener('render-process-gone', onDshGone as EventListener)
  wv.removeEventListener('unresponsive', onDshGone as EventListener)
}

function onDshReady(): void {
  dshReady.value = true
}

function onDshFailLoad(e: Event): void {
  const d = e as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
  if (d.isMainFrame === false) return
  toast(t('hv.loadFailed', { msg: d.errorDescription || d.errorCode || t('hv.loadFailedUnknown') }))
}

function onDshGone(): void {
  toast(t('hv.crashed'))
  setTimeout(reloadDsh, 400)
}

async function rebuildDshWebview(): Promise<void> {
  dshReady.value = false
  detachDsh()
  dshWvKey.value++
  await nextTick()
  attachDsh(dshWebviewEl.value)
}

function reloadDsh(): void {
  dshReady.value = false
  const wv = dshWebviewEl.value
  if (!wv) return
  let cur = ''
  try {
    cur = wv.getURL()
  } catch {
    /* noop */
  }
  if (!cur || !/^https?:\/\/127\.0\.0\.1(?::\d+)?(?:[/?#]|$)/i.test(cur)) {
    void rebuildDshWebview()
    return
  }
  try {
    wv.reload()
  } catch {
    void rebuildDshWebview()
    return
  }
  setTimeout(() => {
    if (!dshReady.value) void rebuildDshWebview()
  }, 8000)
}

// dsh 就绪 / 重启后地址变化 → 加载新地址
watch(() => store.dsh?.url || '', syncDshUrl)
// webview 元素在 dshUrl 就绪后才创建，需在其挂载后补挂事件监听
watch([dshUrl, dshWvKey], async () => {
  await nextTick()
  attachDsh(dshWebviewEl.value)
})
</script>

<template>
  <div class="cv-page">
    <div class="row cv-head">
      <div class="page-title">{{ t('cv.title') }}</div>
      <span class="pill" :class="agentChip.cls"><span class="dot"></span>{{ agentChip.text }}</span>
      <span class="muted mono">{{ displayUrl }}</span>
      <div class="spacer"></div>
      <button class="btn small" @click="reload">{{ t('common.refresh') }}</button>
      <button class="btn small" @click="openInBrowser">{{ t('wb.openInBrowser') }}</button>
      <button class="btn small" @click="enterFullscreen">{{ t('wb.fullscreen') }}</button>
    </div>

    <div class="canvas-box" :class="{ fullscreen }">
      <div class="cv-stage">
        <button v-if="fullscreen" class="btn small cv-exit-full" @click="exitFullscreen">{{ t('wb.exitFullscreen') }}</button>
        <div v-if="!ready" class="cv-loading muted">{{ t('cv.loading') }}</div>
        <webview v-if="preloadUrl" ref="webviewEl" :key="wvKey" :src="srcUrl" :preload="preloadUrl" class="cv-view" allowpopups></webview>
      </div>

      <!-- 右侧 Harness（dsh）对话 dock：画布里的 agent 界面 -->
      <aside v-show="dockOpen" class="cv-dock" :style="{ width: DOCK_WIDTH + 'px' }">
        <div class="row cv-dock-head">
          <span class="cv-dock-title">{{ t('hv.title') }}</span>
          <span class="pill" :class="dshChip.cls"><span class="dot"></span>{{ dshChip.text }}</span>
          <div class="spacer"></div>
          <button class="btn small" @click="reloadDsh">{{ t('common.refresh') }}</button>
          <button class="btn small" :title="t('cv.agent.dockCollapse')" @click="setDockOpen(false)">{{ t('cv.agent.dockCollapse') }}</button>
        </div>

        <div class="cv-dock-body">
          <div v-if="!dshUrl" class="cv-dock-off">
            <div class="cv-dock-off-title">{{ t('hv.off.title') }}</div>
            <div class="muted" style="margin: 6px 0 14px">{{ t('hv.off.desc') }}</div>
            <div v-if="store.dsh?.error" class="cv-dock-err mono">{{ store.dsh.error }}</div>
            <button class="btn" :disabled="dshStarting || store.dsh?.status === 'starting'" @click="ensureDsh()">
              {{ store.dsh?.status === 'starting' ? t('hv.status.starting') : t('hv.start') }}
            </button>
          </div>
          <template v-else>
            <div v-if="!dshReady" class="cv-dock-loading muted">{{ t('hv.loading') }}</div>
            <webview :key="dshWvKey" ref="dshWebviewEl" :src="dshUrl" class="cv-dock-view" allowpopups></webview>
          </template>
        </div>
      </aside>
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
  flex-direction: row;
}
/* 画布主体：dock 展开时自动收窄 */
.cv-stage {
  position: relative;
  flex: 1;
  min-width: 0;
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
/* ---- 右侧 Harness（dsh）对话 dock ---- */
.cv-dock {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 380px;
  border-left: 1px solid var(--border);
}
.cv-dock-head {
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.cv-dock-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.cv-dock-body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.cv-dock-view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg-soft);
}
.cv-dock-loading,
.cv-dock-off {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}
.cv-dock-off {
  flex-direction: column;
}
.cv-dock-off-title {
  font-size: 15px;
  font-weight: 600;
}
.cv-dock-err {
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
