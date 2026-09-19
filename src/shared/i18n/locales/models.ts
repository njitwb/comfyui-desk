import type { MessageTable } from '../types'

/** 模型管理页（src/renderer/src/views/Models.vue），键前缀 models. */
export default {
  'models.title': ['模型管理', 'Models'],
  'models.desc': ['查看已下载模型、按类别管理，支持直接下载（含 HF 国内镜像适配）', 'Browse downloaded models by category and download new ones (HF mirror supported)'],
  'models.dl.title': ['下载模型', 'Download models'],
  'models.dl.urlPlaceholder': ['粘贴模型链接（直链或模型页面链接均可，自动转直链）', 'Paste a model link (direct or model page link, converted automatically)'],
  'models.dl.namePlaceholder': ['文件名（留空自动）', 'Filename (auto if blank)'],
  'models.dl.hfMirror': ['HF 镜像', 'HF mirror'],
  'models.dl.add': ['添加下载', 'Add download'],
  'models.dl.hint': ['模型保存到对应类别目录；huggingface.co 勾选「HF 镜像」走 hf-mirror.com；工作台界面里点「下载」也会自动加入这里', 'Models are saved to their category folder. For huggingface.co, check "HF mirror" to use hf-mirror.com. Downloads started in the workbench are added here automatically.'],
  'models.dlList.title': ['下载管理', 'Downloads'],
  'models.status.downloading': ['下载中', 'Downloading'],
  'models.status.paused': ['已暂停', 'Paused'],
  'models.status.completed': ['已完成', 'Completed'],
  'models.status.error': ['出错', 'Error'],
  'models.dl.pct': ['下载中 {p}%', 'Downloading {p}%'],
  'models.pause': ['暂停', 'Pause'],
  'models.resume': ['继续', 'Resume'],
  'models.confirmDelete': ['确认删除模型文件？\n{path}', 'Delete this model file?\n{path}'],
  'models.toast.deleted': ['已删除 {name}', 'Deleted {name}'],
  'models.toast.done': ['下载完成：{name}', 'Download complete: {name}'],
  'models.library': ['模型库', 'Model library'],
  'models.scanning': ['扫描中…', 'Scanning…'],
  'models.col.file': ['文件名', 'File'],
  'models.col.date': ['日期', 'Date'],
  'models.col.relPath': ['相对路径', 'Relative path'],
  'models.empty.cat': ['该类别暂无模型文件', 'No model files in this category'],
  'models.empty.dir': ['未找到模型目录（请先在设置中配置「模型下载路径」）', 'Model folder not found (set "Model download path" in Settings first)']
} as const satisfies MessageTable
