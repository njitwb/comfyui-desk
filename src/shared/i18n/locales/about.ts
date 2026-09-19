import type { MessageTable } from '../types'

/** 关于页（src/renderer/src/views/About.vue），键前缀 about. */
export default {
  'about.title': ['关于', 'About'],
  'about.desc': [
    'ComfyUI 一站式桌面管家 —— 安装、启动、模型 / 节点 / 工作流管理',
    'All-in-one ComfyUI desk — install, launch, and manage models / nodes / workflows'
  ],
  'about.version': ['版本 v{version} · MIT License', 'Version v{version} · MIT License'],
  'about.env.title': ['运行环境', 'Runtime'],
  'about.platform': ['平台', 'Platform'],
  'about.data.title': ['数据位置', 'Data locations'],
  'about.settingsFile': ['设置文件', 'Settings file'],
  'about.userData': ['用户数据目录', 'User data directory'],
  'about.logDir': ['日志目录', 'Log directory'],
  'about.links.title': ['相关链接', 'Links'],
  'about.update.title': ['版本更新', 'Updates'],
  'about.update.checking': ['正在检查更新…', 'Checking for updates…'],
  'about.update.currentLatest': ['当前 v{current} · 最新 v{latest}', 'Current v{current} · Latest v{latest}'],
  'about.update.currentOnly': ['当前版本 v{current}', 'Current version v{current}'],
  'about.update.publishedAt': ['发布于 {date}', 'Published {date}'],
  'about.update.available': ['发现新版本 v{version}', 'New version v{version} is available'],
  'about.update.latest': ['已是最新版本', 'You are up to date'],
  'about.update.none': ['暂无发布版本', 'No releases published yet'],
  'about.update.failed': ['检查失败：{message}', 'Check failed: {message}'],
  'about.update.checkAgain': ['重新检查', 'Check again'],
  'about.update.download': ['前往下载', 'Download update'],
  'about.update.install': ['立即更新', 'Update now'],
  'about.update.installing': ['更新中…', 'Updating…'],
  'about.update.preparing': ['准备更新…', 'Preparing…'],
  'about.update.installHint': [
    '将自动下载安装包并静默安装，随后应用会重启（ComfyUI 会被停止）',
    'The installer is downloaded and run silently, then the app restarts (ComfyUI is stopped)'
  ],
  'about.update.manualOnly': [
    '该版本未提供 Windows 安装包，可前往发布页手动下载',
    'No Windows installer for this release, download it from the releases page'
  ],
  'about.update.later': ['稍后', 'Later'],
  'about.link.project': ['项目开源地址', 'Project repository'],
  'about.link.repo': ['ComfyUI 官方仓库', 'Official ComfyUI repository'],
  'about.link.docs': ['ComfyUI 文档', 'ComfyUI documentation']
} as const satisfies MessageTable
