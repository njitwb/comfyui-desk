import type { MessageTable } from '../types'

/** 节点管理页（src/renderer/src/views/Nodes.vue），键前缀 nodes. */
export default {
  'nodes.title': ['节点管理', 'Nodes'],
  'nodes.desc': ['安装、更新、删除自定义节点；安装后自动处理依赖', 'Install, update, and remove custom nodes; dependencies are handled automatically after install'],
  'nodes.install.title': ['安装节点', 'Install node'],
  'nodes.install.placeholder': ['粘贴 git 仓库地址（如 https://github.com/xxx/ComfyUI-XXX）', 'Paste a git repository URL (e.g. https://github.com/xxx/ComfyUI-XXX)'],
  'nodes.install.proxyHint': ['node 来源为 GitHub 时可在设置中配置代理前缀（国内访问适配）', 'For nodes hosted on GitHub, set a proxy prefix in Settings (useful in mainland China)'],
  'nodes.installing': ['处理中…', 'Working…'],
  'nodes.install': ['安装', 'Install'],
  'nodes.updatingAll': ['更新中…', 'Updating…'],
  'nodes.updateAll': ['全部更新', 'Update all'],
  'nodes.logs.title': ['操作日志', 'Activity log'],
  'nodes.installedCount': ['已安装节点（{n}）', 'Installed nodes ({n})'],
  'nodes.filterPlaceholder': ['过滤...', 'Filter...'],
  'nodes.refresh': ['刷新', 'Refresh'],
  'nodes.col.name': ['名称', 'Name'],
  'nodes.col.source': ['来源', 'Source'],
  'nodes.local': ['本地', 'Local'],
  'nodes.update': ['更新', 'Update'],
  'nodes.openDir': ['目录', 'Folder'],
  'nodes.remove': ['删除', 'Remove'],
  'nodes.empty': ['暂无已安装节点', 'No nodes installed yet'],
  'nodes.done': ['完成：{name}', 'Done: {name}'],
  'nodes.updated': ['{name} 更新完成', '{name} updated'],
  'nodes.updateAllDone': ['全部更新完成：成功 {ok}，失败 {failed}', 'Update complete: {ok} succeeded, {failed} failed'],
  'nodes.confirmRemove': ['确认删除节点 {name}？\n将删除目录 {path}', 'Remove node {name}?\nThis deletes the folder {path}']
} as const satisfies MessageTable
