import type { MessageTable } from '../types'

/** 主进程：ComfyUI 进程管理（src/main/process.ts），键前缀 m.proc. */
export default {
  'm.proc.autoVram': [
    '[设置] 检测到显存 {vram} GB，已自动启用 --{mode}（仅首次自动设置，可在「设置」页调整）',
    '[Settings] Detected {vram} GB VRAM; enabled --{mode} automatically (first launch only, adjust it on the "Settings" page)'
  ],
  'm.proc.alreadyRunning': ['ComfyUI 已在运行中', 'ComfyUI is already running'],
  'm.proc.notInstalled': [
    '尚未安装 ComfyUI，请先到「安装」页完成安装',
    'ComfyUI is not installed yet. Please complete the installation on the "Install" page'
  ],
  'm.proc.venvMissing': [
    '运行环境缺失，请到「诊断」页执行环境修复',
    'Runtime environment is missing. Please repair it on the "Diagnostics" page'
  ],
  'm.proc.starting': ['[启动] {cmd}', '[Start] {cmd}'],
  'm.proc.portInUse': [
    '[启动失败] 端口 {port} 已被占用，可能是残留的 ComfyUI 进程或其他程序',
    '[Start failed] Port {port} is already in use, possibly by a leftover ComfyUI process or another program'
  ],
  'm.proc.portInUseHint': [
    '[提示] 可在「设置」页更换端口；排查占用可在终端执行 netstat -ano | findstr :{port}',
    '[Tip] Change the port on the "Settings" page; to find the process using it, run netstat -ano | findstr :{port} in a terminal'
  ],
  'm.proc.error': ['[错误] {msg}', '[Error] {msg}'],
  'm.proc.exited': ['[退出] 进程结束，退出码 {code}', '[Exit] Process ended with exit code {code}'],
  'm.proc.stopping': ['[停止] 正在关闭 ComfyUI ...', '[Stop] Shutting down ComfyUI ...']
} as const satisfies MessageTable
