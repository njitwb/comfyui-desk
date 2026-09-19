import type { MessageTable } from '../types'

/** 安装页（src/renderer/src/views/Install.vue），键前缀 install. */
export default {
  'install.pageTitle': ['安装 ComfyUI', 'Install ComfyUI'],
  'install.desc': [
    '选择 Python 版本、ComfyUI 版本与安装路径，一键完成部署（含 Torch 与全部依赖）',
    'Pick a Python interpreter, ComfyUI version and install path to deploy in one click (Torch and all dependencies included)'
  ],
  'install.basicConfig': ['基础配置', 'Basic setup'],
  'install.pythonLabel': ['Python 解释器', 'Python interpreter'],
  'install.noPython': ['未检测到 Python', 'No Python detected'],
  'install.pythonHint': [
    '将基于该解释器创建独立虚拟环境，不污染系统环境',
    'Creates an isolated virtual environment from this interpreter, leaving the system environment untouched'
  ],
  'install.versionLabel': ['ComfyUI 版本', 'ComfyUI version'],
  'install.versionFail': ['获取版本列表失败', 'Failed to load versions'],
  'install.pathLabel': ['安装路径', 'Install path'],
  'install.pathPlaceholder': ['例如 D:\\AI\\ComfyUI', 'e.g. D:\\AI\\ComfyUI'],
  'install.pathHint': [
    '默认安装到程序目录下的 ComfyUI-Runtime，可更改为任意位置',
    'Installs to ComfyUI-Runtime under the app folder by default; you can change it to any location'
  ],
  'install.torchVersion': ['Torch 版本', 'Torch version'],
  'install.torchAuto': [
    '自动推荐（NVIDIA 选最新 CUDA，否则 CPU）',
    'Recommended automatically (latest CUDA for NVIDIA, CPU otherwise)'
  ],
  'install.installing': ['安装中…', 'Installing…'],
  'install.start': ['开始安装', 'Install'],
  'install.redetect': ['重新检测', 'Detect again'],
  'install.hardware': ['硬件检测', 'Hardware detection'],
  'install.driverVersion': ['驱动版本 {v}', 'Driver {v}'],
  'install.noGpu': ['未检测到显卡，可点击「重新检测」', 'No GPU detected — click "Detect again"'],
  'install.done': [
    '安装完成！回到仪表盘即可启动 ComfyUI。',
    'Installation complete! Go back to the dashboard to start ComfyUI.'
  ],
  'install.stagePreparing': ['准备', 'Preparing']
} as const satisfies MessageTable
