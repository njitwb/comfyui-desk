import type { MessageTable } from '../types'

/** 侧边栏：导航项、收起/展开、主题与语言切换入口 */
export default {
  'nav.dashboard': ['仪表盘', 'Dashboard'],
  'nav.workbench': ['工作台', 'Workbench'],
  'nav.install': ['安装', 'Install'],
  'nav.logs': ['日志', 'Logs'],
  'nav.terminal': ['终端', 'Terminal'],
  'nav.models': ['模型管理', 'Models'],
  'nav.nodes': ['节点管理', 'Nodes'],
  'nav.workflows': ['工作流', 'Workflows'],
  'nav.tools': ['诊断', 'Diagnostics'],
  'nav.settings': ['设置', 'Settings'],
  'nav.about': ['关于', 'About'],
  'nav.collapse': ['收起侧边栏', 'Collapse sidebar'],
  'nav.expand': ['展开侧边栏', 'Expand sidebar'],
  'nav.theme.toDark': ['切换到深色主题', 'Switch to dark theme'],
  'nav.theme.toLight': ['切换到亮色主题', 'Switch to light theme'],
  'nav.theme.dark': ['深色', 'Dark'],
  'nav.theme.light': ['亮色', 'Light'],
  'nav.lang.toZh': ['切换到中文', 'Switch to 中文'],
  'nav.lang.toEn': ['切换到 English', 'Switch to English']
} as const satisfies MessageTable
