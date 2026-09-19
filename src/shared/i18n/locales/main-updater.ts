import type { MessageTable } from '../types'

/** 主进程：updater.ts（应用自更新），键前缀 m.updater. */
export default {
  'm.updater.devMode': [
    '开发模式下不支持自动更新，请前往发布页手动下载',
    'Auto-update is unavailable in development mode, please download the installer manually'
  ],
  'm.updater.noAsset': [
    '该 release 没有提供 Windows x64 安装包，请前往发布页手动下载',
    'This release provides no Windows x64 installer, please download it manually'
  ],
  'm.updater.logStart': ['[更新] 开始下载 v{version}：{name}', '[Update] Downloading v{version}: {name}'],
  'm.updater.checksumFailed': [
    '安装包 sha256 校验不通过，已删除损坏文件，请重试',
    'Installer checksum mismatch, the corrupted file was removed, please retry'
  ],
  'm.updater.downloading': ['正在下载更新 {percent}%', 'Downloading update {percent}%'],
  'm.updater.verifying': ['正在校验安装包…', 'Verifying the installer…'],
  'm.updater.installing': ['正在静默安装，应用即将自动重启…', 'Installing silently, the app will restart automatically…']
} as const satisfies MessageTable
