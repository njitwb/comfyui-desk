import type { MessageTable } from '../types'

/** 无限画布页（src/renderer/src/views/Canvas.vue），键前缀 cv. */
export default {
  'cv.title': ['无限画布', 'Infinite Canvas'],
  'cv.loading': ['无限画布加载中…', 'Loading the canvas…'],
  'cv.crashed': ['画布进程异常，正在自动恢复…', 'Canvas process crashed, recovering automatically…'],
  'cv.reloadRebuild': ['画布重载异常，强制重建', 'Canvas reload failed, forcing rebuild'],
  'cv.loadFailed': ['无限画布加载失败：{msg}', 'Failed to load the canvas: {msg}'],
  'cv.loadFailedUnknown': ['未知错误', 'Unknown error']
} as const satisfies MessageTable
