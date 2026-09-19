import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { initStore } from './store'
import { api } from './api'
import { setLocale, type Locale } from './i18n'
import { setTheme } from './theme'
import type { Theme } from '../../shared/appearance'

/** 先按持久化的主题与语言落位再挂载，避免亮色 / 英文用户看到一瞬深色中文 */
async function bootstrap(): Promise<void> {
  try {
    const s = (await api.getSettings()) as { theme?: Theme | ''; locale?: Locale | '' }
    if (s.theme === 'dark' || s.theme === 'light') setTheme(s.theme)
    if (s.locale === 'zh' || s.locale === 'en') setLocale(s.locale)
  } catch {
    /* 读取失败则用默认（深色 + 中文）启动 */
  }
  // 主题联动：ComfyUI 侧改主题时主进程会通知
  api.onThemeChanged(setTheme)
  initStore()
  createApp(App).mount('#app')
}

void bootstrap()
