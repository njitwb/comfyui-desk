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
  'about.link.project': ['项目开源地址', 'Project repository'],
  'about.link.repo': ['ComfyUI 官方仓库', 'Official ComfyUI repository'],
  'about.link.docs': ['ComfyUI 文档', 'ComfyUI documentation']
} as const satisfies MessageTable
