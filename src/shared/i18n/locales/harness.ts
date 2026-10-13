import type { MessageTable } from '../types'

/** DeepSeek Harness 页（src/renderer/src/views/Harness.vue），键前缀 hv. */
export default {
  'hv.title': ['DeepSeek Harness', 'DeepSeek Harness'],
  'hv.sub': [
    '本地运行的 agent harness，画布与它共用一个 agent；首次使用需在设置里填 DeepSeek API Key',
    'A locally running agent harness that shares one agent with the canvas; add a DeepSeek API key in Settings before first use'
  ],
  'hv.status.running': ['运行中', 'Running'],
  'hv.status.starting': ['启动中…', 'Starting…'],
  'hv.status.stopped': ['已停止', 'Stopped'],
  'hv.status.error': ['异常', 'Error'],
  'hv.loading': ['正在加载 Harness 界面 …', 'Loading the Harness UI …'],
  'hv.off.title': ['Harness 未运行', 'Harness is not running'],
  'hv.off.desc': [
    'Harness 由应用托管，随应用自动启动。若已关闭，可在此手动启动。',
    'Harness is managed by the app and starts with it. If it was turned off, you can start it here.'
  ],
  'hv.start': ['启动 Harness', 'Start Harness'],
  'hv.loadFailed': ['Harness 界面加载失败：{msg}', 'Failed to load the Harness UI: {msg}'],
  'hv.loadFailedUnknown': ['未知错误', 'unknown error'],
  'hv.crashed': ['Harness 界面无响应，正在自动恢复 …', 'The Harness UI became unresponsive; recovering automatically …']
} as const satisfies MessageTable
