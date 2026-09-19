import { ref, watchEffect } from 'vue'
import type { Theme } from '../../shared/appearance'

/** 当前主题（写入 html[data-theme]，配色见 styles.css） */
export const theme = ref<Theme>('dark')

export function setTheme(v: Theme): void {
  theme.value = v
}

// 单测在 node 环境引入本模块，故先判断环境
if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.dataset.theme = theme.value
  })
}
