import type { MessageTable } from '../types'

/** 仪表盘页（src/renderer/src/views/Dashboard.vue），键前缀 dash. */
export default {
  'dash.title': ['仪表盘', 'Dashboard'],
  'dash.desc': ['查看 ComfyUI 运行状态并进行启动 / 关闭 / 重启操作', 'View ComfyUI status and start, stop, or restart it'],
  'dash.notInstalled': ['尚未安装 ComfyUI', 'ComfyUI is not installed yet'],
  'dash.notInstalledHint': [
    '前往安装页一键部署，或选择电脑上已有的 ComfyUI 目录',
    'Deploy it in one click on the Install page, or select an existing ComfyUI folder on this computer'
  ],
  'dash.installNow': ['立即安装', 'Install now'],
  'dash.pickExisting': ['选择已安装目录', 'Select installed folder'],
  'dash.status.stopped': ['已停止', 'Stopped'],
  'dash.status.starting': ['启动中…', 'Starting…'],
  'dash.status.running': ['运行中', 'Running'],
  'dash.status.error': ['运行错误', 'Error'],
  'dash.openGui': ['打开 ComfyUI 界面', 'Open ComfyUI interface'],
  'dash.start': ['启动', 'Start'],
  'dash.restart': ['重启', 'Restart'],
  'dash.stop': ['关闭', 'Stop'],
  'dash.pickedOk': ['已识别安装目录，可以启动 ComfyUI', 'Installation folder detected. You can start ComfyUI now'],
  'dash.pickedNoEnv': [
    '已识别安装目录；运行环境缺失，启动前请到「诊断」页执行环境修复',
    'Installation folder detected, but the runtime environment is missing. Run the environment repair on the Diagnostics page before starting'
  ],
  'dash.updateDone': ['更新完成', 'Update complete'],
  'dash.switchDone': ['Torch 切换完成，重启 ComfyUI 后生效', 'Torch switched. Restart ComfyUI to apply'],
  'dash.version': ['ComfyUI 版本', 'ComfyUI version'],
  'dash.gpu': ['显卡', 'GPU'],
  'dash.gpuNone': ['未检测到', 'Not detected'],
  'dash.driver': ['驱动版本', 'Driver version'],
  'dash.installPath': ['安装路径', 'Install path'],
  'dash.openDir': ['打开目录', 'Open folder'],
  'dash.updateTitle': ['更新 ComfyUI', 'Update ComfyUI'],
  'dash.checking': ['检查中…', 'Checking…'],
  'dash.checkUpdate': ['检查更新', 'Check for updates'],
  'dash.updating': ['更新中…', 'Updating…'],
  'dash.updateTo': ['更新到 {version}', 'Update to {version}'],
  'dash.update': ['更新', 'Update'],
  'dash.hasUpdate': ['发现新版本 {latest}（当前 {current}）', 'New version {latest} available (current {current})'],
  'dash.isLatest': ['已是最新版本（{current}）', 'Already up to date ({current})'],
  'dash.checkHint': ['点击「检查更新」检测是否有新版本', 'Click "Check for updates" to look for a new version'],
  'dash.switchTitle': ['切换 Torch / CUDA', 'Switch Torch / CUDA'],
  'dash.selectVersion': ['选择版本', 'Select version'],
  'dash.switch': ['切换', 'Switch'],
  'dash.switchHint': ['重装匹配的 torch / torchvision / torchaudio', 'Reinstall matching torch / torchvision / torchaudio']
} as const satisfies MessageTable
