import type { MessageTable } from '../types'

/** 工作台页（src/renderer/src/views/Workbench.vue），键前缀 wb. */
export default {
  'wb.title': ['工作台', 'Workbench'],
  'wb.status.stopped': ['已停止', 'Stopped'],
  'wb.status.starting': ['启动中…', 'Starting…'],
  'wb.status.running': ['运行中', 'Running'],
  'wb.status.error': ['运行错误', 'Run error'],
  'wb.openInBrowser': ['在浏览器打开', 'Open in browser'],
  'wb.fullscreen': ['全屏', 'Fullscreen'],
  'wb.exitFullscreen': ['退出全屏 (Esc)', 'Exit fullscreen (Esc)'],
  'wb.loading': ['ComfyUI 界面加载中…', 'Loading the ComfyUI interface…'],
  'wb.notInstalledTitle': ['尚未安装 ComfyUI', 'ComfyUI is not installed yet'],
  'wb.notInstalledDesc': ['安装完成后即可在此直接使用 ComfyUI 界面', 'Once installed, you can use the ComfyUI interface right here'],
  'wb.installNow': ['去安装', 'Go to install'],
  'wb.notRunningTitle': ['ComfyUI 未在运行', 'ComfyUI is not running'],
  'wb.notRunningDesc': ['启动后，界面将直接显示在这里', 'Once started, the interface will show up right here'],
  'wb.start': ['启动 ComfyUI', 'Start ComfyUI'],
  'wb.crashed': ['界面进程异常，正在自动恢复…', 'Interface process crashed, recovering automatically…'],
  'wb.reloadRebuild': ['webview 重载异常，强制重建', 'webview reload failed, forcing rebuild'],
  'wb.loadFailed': ['ComfyUI 界面加载失败：{msg}', 'Failed to load the ComfyUI interface: {msg}'],
  'wb.loadFailedUnknown': ['未知错误', 'Unknown error'],
  'wb.dm.log': ['接管[{source}] file={filename} cat={category} url={url}', 'Takeover [{source}] file={filename} cat={category} url={url}'],
  'wb.dm.logNoCategory': ['(无)', '(none)'],
  'wb.dm.addFailed': ['加入下载失败：{msg}', 'Failed to add download: {msg}'],
  'wb.dm.patchUnsupported': ['界面下载拦截不可用：webview 不支持脚本注入（只有主进程兜底，目录按 URL 关键词推断）', 'In-app download interception unavailable: webview does not support script injection (main-process fallback only, folder inferred from URL keywords)'],
  'wb.dm.patchLoadFailed': ['界面下载拦截加载失败：{msg}', 'Failed to load in-app download interception: {msg}'],
  'wb.dm.takenTip': ['界面内的模型下载已由管家接管', 'Model downloads inside the interface are handled by the manager'],
  'wb.dm.taken': ['⬇ 接管', '⬇ Managed']
} as const satisfies MessageTable
