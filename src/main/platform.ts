import fs from 'node:fs'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/** venv 内保存解释器与脚本的目录名（Windows=Scripts，POSIX=bin） */
export function venvScriptsRel(): string {
  return isWin ? 'Scripts' : 'bin'
}

/** venv 内 Python 可执行文件名 */
export function venvPythonFileName(): string {
  return isWin ? 'python.exe' : 'python'
}

/**
 * wheel 平台标签的匹配片段。
 * 阿里云 pytorch-wheels 与官方 download.pytorch.org 的 wheel 文件名里，Linux 会带
 * manylinux_2_x_x86_64 / manylinux2014_x86_64 / linux_x86_64 等多种标签，这里统一做匹配。
 */
export function wheelPlatformRe(): string {
  if (isWin) return '(?:win_amd64|win_arm64)'
  if (isMac) return 'macosx_[0-9_]+' + (process.arch === 'arm64' ? 'arm64' : '(?:x86_64|universal2)')
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch
  return `(?:manylinux_2_(?:\\d+_)?\\d+_${arch}|manylinux\\d+_${arch}|linux_${arch})`
}

/** POSIX 下判断文件是否可执行（存在且有 x 权限） */
export function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}