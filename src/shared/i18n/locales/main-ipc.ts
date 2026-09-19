import type { MessageTable } from '../types'

/** 主进程：IPC 层（src/main/ipc.ts、src/main/index.ts），键前缀 m.ipc. */
export default {
  'm.ipc.streamLine': ['[{tag}] {text}', '[{tag}] {text}'],
  'm.ipc.tag.install': ['安装', 'Install'],
  'm.ipc.tag.update': ['更新', 'Update'],
  'm.ipc.tag.torch': ['Torch', 'Torch'],
  'm.ipc.tag.nodes': ['节点', 'Nodes'],
  'm.ipc.tag.repair': ['修复', 'Repair'],
  'm.ipc.log.ui': ['[界面] {message}', '[UI] {message}'],
  'm.ipc.log.installStart': [
    '[安装] 开始安装 ComfyUI {version}（torch 源：{index}）',
    '[Install] Installing ComfyUI {version} (torch index: {index})'
  ],
  'm.ipc.log.installFailed': ['[安装] 安装失败：{error}', '[Install] Install failed: {error}'],
  'm.ipc.log.updateStart': ['[更新] 开始更新 ComfyUI → {version}', '[Update] Updating ComfyUI → {version}'],
  'm.ipc.log.updateFailed': ['[更新] 更新失败：{error}', '[Update] Update failed: {error}'],
  'm.ipc.log.torchSwitchStart': ['[Torch] 开始切换 torch 源：{index}', '[Torch] Switching torch index: {index}'],
  'm.ipc.log.torchSwitchFailed': ['[Torch] 切换失败：{error}', '[Torch] Switch failed: {error}'],
  'm.ipc.stage.done': ['完成', 'Done'],
  'm.ipc.torchSwitched': ['Torch 切换完成', 'Torch switched'],
  'm.ipc.log.modelDeleted': ['[模型] 已删除 {path}', '[Models] Deleted {path}'],
  'm.ipc.log.modelDownloadTaken': [
    '[模型] 接管界面内下载：{name} url={url}',
    '[Models] Intercepted in-app download: {name} url={url}'
  ],
  'm.ipc.log.nodeInstallFailed': ['[节点] 安装失败：{error}', '[Nodes] Install failed: {error}'],
  'm.ipc.log.nodeUpdateFailed': ['[节点] {name} 更新失败：{error}', '[Nodes] Failed to update {name}: {error}'],
  'm.ipc.log.nodeDeleted': ['[节点] 已删除 {name}', '[Nodes] Deleted {name}'],
  'm.ipc.log.workflowQueued': [
    '[工作流] 提交运行 {path}（队列 #{number}）',
    '[Workflows] Queued run {path} (queue #{number})'
  ],
  'm.ipc.log.workflowDeleted': ['[工作流] 已删除 {path}', '[Workflows] Deleted {path}'],
  'm.ipc.log.repairStart': ['[修复] 开始环境修复（{mode}）', '[Repair] Repairing environment ({mode})'],
  'm.ipc.log.repairFailed': ['[修复] 修复失败：{error}', '[Repair] Repair failed: {error}'],
  'm.ipc.err.invalidComfyDir': [
    '所选目录不是有效的 ComfyUI 安装（未找到 main.py）',
    'The selected directory is not a valid ComfyUI installation (main.py not found)'
  ]
} as const satisfies MessageTable
