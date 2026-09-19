import type { MessageTable } from '../types'

/** 主进程：其余模块（settings.ts / util.ts / logger.ts / gpu.ts / guest-guard.ts / index.ts），键前缀 m.misc. */
export default {
  /** webview 弹窗防火墙：模型链接转交下载 */
  'm.misc.guard.popupTaken': ['[模型] 接管弹窗下载：{url}', '[Model] Taking over popup download: {url}'],
  /** webview 导航防火墙：模型链接本页跳转 */
  'm.misc.guard.navDownloadBlocked': [
    '[模型] 拦截界面本页下载跳转：{url}',
    '[Model] Blocked in-page download navigation: {url}'
  ]
} as const satisfies MessageTable
