import { ref, watchEffect } from 'vue'
import { translate, type Locale, type MessageKey } from '../../shared/i18n'

export type { Locale, MessageKey } from '../../shared/i18n'

/** 当前界面语言（响应式：模板里的 t() 会随切换重渲染） */
export const locale = ref<Locale>('zh')

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(locale.value, key, params)
}

export function setLocale(l: Locale): void {
  locale.value = l
}

/** 按当前语言格式化日期 */
export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(locale.value === 'zh' ? 'zh-CN' : 'en-US')
}

// <html lang> 与窗口标题跟随语言；单测在 node 环境引入本模块，故先判断环境
if (typeof document !== 'undefined') {
  watchEffect(() => {
    document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en'
    document.title = translate(locale.value, 'app.title')
  })
}
