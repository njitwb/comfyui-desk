import type { MessageTable } from '../types'

/** 跨页面通用词 */
export default {
  'common.cancel': ['取消', 'Cancel'],
  'common.delete': ['删除', 'Delete'],
  'common.remove': ['移除', 'Remove'],
  'common.refresh': ['刷新', 'Refresh'],
  'common.search': ['搜索', 'Search'],
  'common.download': ['下载', 'Download'],
  'common.loading': ['加载中…', 'Loading…'],
  'common.open': ['打开', 'Open'],
  'common.reveal': ['定位', 'Reveal'],
  'common.browse': ['浏览', 'Browse'],
  'common.retry': ['重试', 'Retry'],
  'common.unknown': ['未知', 'Unknown'],
  'common.notInstalled': ['未安装', 'Not installed'],
  'common.size': ['大小', 'Size']
} as const satisfies MessageTable
