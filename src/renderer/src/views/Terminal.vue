<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, onActivated } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import { t } from '../i18n'
import { theme } from '../theme'

/**
 * xterm 自绘、不读 CSS 变量，配色需按主题手动切换；
 * 亮色下另给一套 ANSI 调色板（默认色是为深底设计的，白底下发灰看不清）。
 */
const DARK_TERM = { background: '#0b0f19', foreground: '#e9ecf4', cursor: '#e9ecf4' }
const LIGHT_TERM = {
  background: '#ffffff',
  foreground: '#1b2230',
  cursor: '#1b2230',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7d4e00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#9a6700',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#24292f'
}

function termTheme(): typeof DARK_TERM | typeof LIGHT_TERM {
  return theme.value === 'light' ? LIGHT_TERM : DARK_TERM
}

const host = ref<HTMLElement | null>(null)
const shellLabel = ref('')
let term: Terminal | null = null
const fit = new FitAddon()
let id = 0
let alive = false
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
let resizeObs: ResizeObserver | null = null

function resize() {
  if (!term) return
  try {
    fit.fit()
    if (alive) void api.termResize(id, term.cols, term.rows)
  } catch {
    /* 页面隐藏时容器尺寸为 0，忽略 */
  }
}

async function openSession() {
  if (!term) return
  const r = (await api.termOpen(term.cols, term.rows)) as { id: number; shell: string }
  id = r.id
  shellLabel.value = r.shell
  alive = true
}

/** 复制选区到系统剪贴板；无选区返回 false（按键继续按原义交给终端） */
function copySelection(): boolean {
  if (!term?.hasSelection()) return false
  void api.clipboardWrite(term.getSelection())
  term.clearSelection() // 清选区，便于下次 Ctrl+C 正常中断
  return true
}

/** 粘贴系统剪贴板内容（term.paste 会做换行归一与 bracketed paste） */
async function pasteClipboard(): Promise<void> {
  const text = await api.clipboardRead()
  if (text) term?.paste(text)
}

/**
 * 复制粘贴接管说明：xterm 只认原生 copy/paste 事件，而终端文本不可选中（xterm 自身 user-select:none），
 * 原生 copy 取不到选区内容 —— 所以复制走 xterm 选区模型 + 主进程剪贴板；粘贴同理走 IPC，
 * 并用 blockNativePaste 屏蔽原生 paste，避免同一次按键被送两遍。
 *
 * 快捷键：Ctrl+Shift+C / Ctrl+Insert 复制；Ctrl+C 有选中时复制、无选中仍作中断；Ctrl+V（含 Ctrl+Shift+V）/ Shift+Insert 粘贴。
 */
function onKey(ev: KeyboardEvent): boolean {
  if (ev.type !== 'keydown') return true // xterm 也会在 keypress / keyup 回调
  const key = ev.key.toLowerCase()
  if (ev.ctrlKey) {
    if ((ev.shiftKey && key === 'c') || key === 'insert') {
      copySelection()
      return false
    }
    if (key === 'c') return !copySelection()
    if (key === 'v') {
      void pasteClipboard()
      return false
    }
    return true
  }
  if (ev.shiftKey && key === 'insert') {
    void pasteClipboard()
    return false
  }
  return true
}

/** 拦截原生 paste（捕获阶段，先于 xterm 的 textarea 监听），避免与剪贴板 IPC 重复粘贴 */
function blockNativePaste(ev: ClipboardEvent): void {
  ev.stopPropagation()
}

/** 右键：有选中复制，否则粘贴（Windows 终端习惯） */
function onContextMenu(): void {
  if (!copySelection()) void pasteClipboard()
}

onMounted(async () => {
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    theme: termTheme()
  })
  term.loadAddon(fit)
  term.attachCustomKeyEventHandler(onKey)
  term.open(host.value!)
  fit.fit()

  offData = api.onTermData(e => {
    if (e.id === id) term?.write(e.data)
  })
  offExit = api.onTermExit(e => {
    if (e.id !== id) return
    alive = false
    term?.writeln(`\r\n\x1b[33m${t('term.exited', { code: e.code })}\x1b[0m`)
  })
  // 按键直通 PTY；会话退出后按回车重开
  term.onData(d => {
    if (alive) void api.termWrite(id, d)
    else if (d === '\r') void openSession()
  })

  resizeObs = new ResizeObserver(() => resize())
  resizeObs.observe(host.value!)

  await openSession()
  term.focus()
})

// KeepAlive 缓存下切回页面时重新适配尺寸并聚焦
onActivated(() => {
  resize()
  term?.focus()
})

// 切主题时热更新配色（xterm 不读 CSS 变量）
watch(theme, () => {
  if (term) term.options.theme = termTheme()
})

onUnmounted(() => {
  offData?.()
  offExit?.()
  resizeObs?.disconnect()
  if (alive) void api.termKill(id)
  term?.dispose()
  term = null
})
</script>

<template>
  <div class="term-page">
    <div class="page-title">{{ t('term.title') }}</div>
    <div class="page-desc">
      {{ shellLabel ? t('term.desc', { shell: shellLabel }) : t('term.descNoShell') }}
    </div>
    <div class="page-desc muted term-hint">{{ t('term.clipboardHint') }}</div>
    <div
      ref="host"
      class="card term-host"
      @paste.capture="blockNativePaste"
      @contextmenu.prevent="onContextMenu"
    ></div>
  </div>
</template>

<style scoped>
.term-page {
  display: flex;
  flex-direction: column;
  /* 恰好填满 .main 内容区（上下各 22px 内边距） */
  height: calc(100vh - 44px);
}
.term-host {
  flex: 1;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
}
.term-hint {
  margin: -12px 0 12px;
}
:deep(.xterm) {
  height: 100%;
}
</style>
