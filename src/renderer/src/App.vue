<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { store, refreshSettings } from './store'
import { api } from './api'
import { t, locale, setLocale } from './i18n'
import { theme, setTheme } from './theme'
import { LOCALE_LABELS, type Locale, type MessageKey } from '../../shared/i18n'
import type { Theme } from '../../shared/appearance'
import Dashboard from './views/Dashboard.vue'
import Workbench from './views/Workbench.vue'
import Install from './views/Install.vue'
import Logs from './views/Logs.vue'
import Terminal from './views/Terminal.vue'
import Models from './views/Models.vue'
import Nodes from './views/Nodes.vue'
import Workflows from './views/Workflows.vue'
import Tools from './views/Tools.vue'
import Settings from './views/Settings.vue'
import About from './views/About.vue'
import appIcon from './assets/brand/app-icon.png'

type PageKey = 'dashboard' | 'workbench' | 'install' | 'logs' | 'terminal' | 'models' | 'nodes' | 'workflows' | 'tools' | 'settings' | 'about'
const page = ref<PageKey>('dashboard')
const collapsed = ref(false)

const navs: { key: PageKey; label: MessageKey; icon: string }[] = [
  { key: 'dashboard', label: 'nav.dashboard', icon: '◈' },
  { key: 'workbench', label: 'nav.workbench', icon: '▣' },
  { key: 'install', label: 'nav.install', icon: '⬇' },
  { key: 'logs', label: 'nav.logs', icon: '≡' },
  { key: 'terminal', label: 'nav.terminal', icon: '❯' },
  { key: 'models', label: 'nav.models', icon: '▦' },
  { key: 'nodes', label: 'nav.nodes', icon: '⌘' },
  { key: 'workflows', label: 'nav.workflows', icon: '◇' },
  { key: 'tools', label: 'nav.tools', icon: '⚒' },
  { key: 'settings', label: 'nav.settings', icon: '⚙' },
  { key: 'about', label: 'nav.about', icon: 'ⓘ' }
]

const pages: Record<PageKey, unknown> = { dashboard: Dashboard, workbench: Workbench, install: Install, logs: Logs, terminal: Terminal, models: Models, nodes: Nodes, workflows: Workflows, tools: Tools, settings: Settings, about: About }
const current = computed(() => pages[page.value])

const statusKey: Record<string, MessageKey> = { stopped: 'app.status.stopped', starting: 'app.status.starting', running: 'app.status.running', error: 'app.status.error' }

/** 主题 / 语言切换：即时生效并写入设置持久化 */
function toggleTheme(): void {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
  setTheme(next)
  void api.saveSettings({ theme: next }).then(() => refreshSettings())
}

function toggleLocale(): void {
  const next: Locale = locale.value === 'zh' ? 'en' : 'zh'
  setLocale(next)
  void api.saveSettings({ locale: next }).then(() => refreshSettings())
}

// 启动/运行失败提醒：关闭后同次失败不再打扰
const errDismissed = ref(false)
watch(
  () => store.status,
  (n, o) => {
    if (n === 'error' && o !== 'error') errDismissed.value = false
  }
)
const lastErrorLine = computed(() => {
  for (let i = store.logs.length - 1; i >= 0; i--) {
    const l = store.logs[i]
    if (l.stream !== 'stdout' && l.text.trim()) return l.text.trim()
  }
  return ''
})

// 全局轻提示：任意页面可 dispatch 'app-toast'
const appToast = ref('')
let appToastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string) {
  appToast.value = msg.trim()
  if (appToastTimer) clearTimeout(appToastTimer)
  appToastTimer = setTimeout(() => (appToast.value = ''), 4000)
}
window.addEventListener('app-toast', (e: Event) => showToast((e as CustomEvent<string>).detail || ''))

// 主进程接管了界面内下载 → 提示并跳模型管理
api.onDownloadTaken(({ filename }) => {
  showToast(t('app.toast.downloadTaken', { filename }))
  page.value = 'models'
})
</script>

<template>
  <div class="layout">
    <aside v-show="!collapsed" class="sidebar">
      <div class="brand">
        <div class="logo"><img :src="appIcon" alt="" /></div>
        <div>
          <div class="name">{{ t('app.title') }}</div>
          <div class="sub">{{ t('app.subtitle') }}</div>
        </div>
      </div>
      <button class="side-fold" :title="t('nav.collapse')" @click="collapsed = true">
        <span class="ico">«</span>{{ t('nav.collapse') }}
      </button>
      <nav class="nav">
        <div
          v-for="n in navs"
          :key="n.key"
          class="nav-item"
          :class="{ active: page === n.key }"
          @click="page = n.key"
        >
          <span class="ico">{{ n.icon }}</span>
          <span>{{ t(n.label) }}</span>
        </div>
      </nav>
      <div class="side-foot">
        <span class="pill" :class="store.status">
          <span class="dot"></span>{{ t(statusKey[store.status]) }}
        </span>
        <div class="muted" style="margin-top: 8px" v-if="store.info?.version">
          ComfyUI {{ store.info.version }}
        </div>
        <div class="side-toggles">
          <button
            class="side-toggle"
            :title="theme === 'dark' ? t('nav.theme.toLight') : t('nav.theme.toDark')"
            @click="toggleTheme"
          >
            <span class="ico">{{ theme === 'dark' ? '☀' : '☾' }}</span>{{ theme === 'dark' ? t('nav.theme.light') : t('nav.theme.dark') }}
          </button>
          <button
            class="side-toggle"
            :title="locale === 'zh' ? t('nav.lang.toEn') : t('nav.lang.toZh')"
            @click="toggleLocale"
          >
            <span class="ico">⇄</span>{{ LOCALE_LABELS[locale === 'zh' ? 'en' : 'zh'] }}
          </button>
        </div>
      </div>
    </aside>
    <button v-if="collapsed" class="btn side-expand" :title="t('nav.expand')" @click="collapsed = false">☰</button>
    <main class="main">
      <!-- 工作台常驻挂载（v-show）：webview 脱离 DOM 后会重载，不能走 KeepAlive 挂起 -->
      <Workbench v-show="page === 'workbench'" @nav="(k: PageKey) => (page = k)" />
      <!-- 状态型页面缓存实例（开关切换不丢终端输出/安装进度）；:key 必加，否则 KeepAlive 会缓存错配 -->
      <KeepAlive :include="['Terminal', 'Logs', 'Install', 'Tools']">
        <component :is="current" :key="page" v-if="page !== 'workbench'" @nav="(k: PageKey) => (page = k)" />
      </KeepAlive>
    </main>
    <div v-if="store.progress" class="toast mono">{{ store.progress.stage }} · {{ store.progress.message }}</div>
    <!-- pointer-events:none 避免盖住工作台头部按钮 -->
    <div v-if="appToast" class="toast" style="top: 52px; right: 20px; bottom: auto; left: auto; pointer-events: none">{{ appToast }}</div>
    <div v-if="store.status === 'error' && !errDismissed" class="toast err" style="max-width: 460px; bottom: 80px">
      <div style="font-weight: 600; margin-bottom: 4px">{{ t('app.error.title') }}</div>
      <div v-if="lastErrorLine" class="mono" style="margin-bottom: 8px; word-break: break-all">{{ lastErrorLine }}</div>
      <div class="row" style="justify-content: flex-end; gap: 6px">
        <button class="btn small" @click="page = 'logs'">{{ t('app.error.viewLogs') }}</button>
        <button class="btn small" @click="errDismissed = true">{{ t('app.error.dismiss') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 收起侧边栏按钮：独立一行 + 图标与文字 */
.side-fold {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  background: var(--glass-bg);
  color: var(--text-dim);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s, transform 0.15s;
}
.side-fold:hover {
  border-color: var(--tint-accent-border);
  background: var(--glass-bg-strong);
  color: var(--text);
}
.side-fold .ico {
  font-size: 13px;
  line-height: 1;
}
/* 侧边栏底部：主题 / 语言切换 */
.side-toggles {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.side-toggle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 4px;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  background: var(--glass-bg);
  color: var(--text-dim);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.side-toggle:hover {
  border-color: var(--tint-accent-border);
  background: var(--glass-bg-strong);
  color: var(--text);
}
.side-toggle .ico {
  font-size: 12px;
  line-height: 1;
}
.side-expand {
  position: fixed;
  left: 10px;
  top: 12px;
  z-index: 40;
  padding: 4px 10px;
}
</style>
