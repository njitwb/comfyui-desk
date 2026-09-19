import type { MessageTable } from '../types'

/** 日志页（src/renderer/src/views/Logs.vue），键前缀 logs. */
export default {
  'logs.pageTitle': ['运行日志', 'Runtime logs'],
  'logs.desc': [
    '实时显示 ComfyUI 进程的输出（stdout / stderr / 系统事件）',
    'Live output from the ComfyUI process (stdout / stderr / system events)'
  ],
  'logs.filterPlaceholder': ['过滤关键字...', 'Filter keywords...'],
  'logs.streamAll': ['全部', 'All'],
  'logs.streamSys': ['系统', 'System'],
  'logs.autoScroll': ['自动滚动', 'Auto-scroll'],
  'logs.copyAll': ['复制全部', 'Copy all'],
  'logs.clearView': ['清空视图', 'Clear view'],
  'logs.empty': ['暂无日志', 'No logs yet']
} as const satisfies MessageTable
