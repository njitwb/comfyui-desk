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

onMounted(async () => {
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    theme: termTheme()
  })
  term.loadAddon(fit)
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
    <div ref="host" class="card term-host"></div>
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
:deep(.xterm) {
  height: 100%;
}
</style>
