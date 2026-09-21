import type { MessageTable } from '../types'

/** 主进程：模型下载（src/main/downloads.ts），键前缀 m.dl. */
export default {
  'm.dl.logResume': [
    '[模型] 恢复中断的下载：{filename}（断点续传）',
    '[Model] Resuming interrupted download: {filename} (breakpoint resume)'
  ],
  'm.dl.logDone': ['[模型] 下载完成：{path}', '[Model] Download complete: {path}'],
  'm.dl.logFailed': ['[模型] 下载失败 {filename}：{error}', '[Model] Download failed {filename}: {error}'],
  'm.dl.logStart': ['[模型] 开始下载 {filename} → {category}', '[Model] Start download {filename} → {category}'],
  'm.dl.logStartMirror': [
    '[模型] 开始下载 {filename} → {category}（HF 镜像）',
    '[Model] Start download {filename} → {category} (HF mirror)'
  ],
  'm.dl.logPaused': ['[模型] 已暂停 {filename}', '[Model] Paused {filename}'],
  'm.dl.logResumed': ['[模型] 继续下载 {filename}', '[Model] Resuming download {filename}'],
  'm.dl.logCleared': ['[模型] 已清除记录 {filename}', '[Model] Record cleared {filename}'],
  'm.dl.logCanceled': ['[模型] 已取消下载 {filename}', '[Model] Download canceled {filename}'],
  'm.dl.errTooManyRedirects': ['重定向次数过多', 'Too many redirects'],
  'm.dl.errTimeout': ['请求超时（网络不可达或站点无响应）', 'Request timed out (network unreachable or no response)'],
  'm.dl.errInvalidJson': ['接口返回内容无法解析', 'The API response could not be parsed'],
  'm.dl.errBadRepo': ['无效的模型仓库 ID：{id}', 'Invalid model repository ID: {id}'],
  'm.dl.logOnlineSearch': [
    '[模型] 搜索 {source}「{query}」：{count} 条结果',
    '[Model] Search {source} for "{query}": {count} result(s)'
  ],
  'm.dl.errNotModelFile': [
    '服务器返回网页而非模型文件（可能是页面链接或需登录才可下载）',
    'The server returned a web page instead of a model file (the link may be a page link or require sign-in to download)'
  ]
} as const satisfies MessageTable
