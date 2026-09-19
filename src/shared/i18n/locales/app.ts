import type { MessageTable } from '../types'

/** 应用外壳：窗口标题、运行状态、全局提示与错误横幅 */
export default {
  'app.title': ['ComfyUI 桌面管家', 'ComfyUI Desk'],
  'app.subtitle': ['一站式管理工具', 'All-in-one manager'],
  'app.status.stopped': ['已停止', 'Stopped'],
  'app.status.starting': ['启动中', 'Starting'],
  'app.status.running': ['运行中', 'Running'],
  'app.status.error': ['错误', 'Error'],
  'app.logStartup': ['[管家] ComfyUI 桌面管家 v{version} 启动', '[Desk] ComfyUI Desk v{version} started'],
  'app.error.title': ['ComfyUI 运行异常', 'ComfyUI failed to run'],
  'app.error.viewLogs': ['查看日志', 'View logs'],
  'app.error.dismiss': ['知道了', 'Got it'],
  'app.toast.downloadTaken': ['已开始下载 {filename}，已跳转到模型管理', 'Downloading {filename}, switched to Models']
} as const satisfies MessageTable
