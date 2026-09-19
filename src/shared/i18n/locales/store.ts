import type { MessageTable } from '../types'

/** 渲染层共享状态（src/renderer/src/store.ts），键前缀 store. */
export default {
  'store.cpuEdition': ['CPU 版', 'CPU']
} as const satisfies MessageTable
