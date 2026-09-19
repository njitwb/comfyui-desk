import { translate, type Locale, type MessageKey } from '../shared/i18n'

/** 主进程取词（日志 / 进度 / 报错文案），locale 随设置同步 */
let cur: Locale = 'zh'

export function setMainLocale(l: Locale): void {
  cur = l
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(cur, key, params)
}
