import type { MessageTable } from '../types'

/** 主进程：节点 / 工作流 / 模型扫描（src/main/nodes.ts、workflows.ts、models.ts），键前缀 m.nodes. / m.wf. / m.models. */
export default {
  'm.nodes.installDepsStart': ['安装节点依赖 requirements.txt ...', 'Installing node dependencies from requirements.txt ...'],
  'm.nodes.depsWarn': [
    '[警告] 依赖安装未完全成功，可稍后重试',
    '[Warning] Dependency installation did not fully succeed; you can retry later'
  ],
  'm.nodes.runInstallPy': ['执行 install.py ...', 'Running install.py ...'],
  'm.nodes.invalidUrl': ['请输入有效的 git 仓库地址', 'Please enter a valid git repository URL'],
  'm.nodes.exists': ['节点 {name} 已存在', 'Node {name} already exists'],
  'm.nodes.cloning': ['克隆 {url} ...', 'Cloning {url} ...'],
  'm.nodes.cloneFailed': ['克隆失败: {msg}', 'Clone failed: {msg}'],
  'm.nodes.installDone': ['节点安装完成: {name}', 'Node installed: {name}'],
  'm.nodes.notFound': ['节点不存在: {name}', 'Node not found: {name}'],
  'm.nodes.notGitRepo': ['该节点不是 git 仓库，无法更新', 'This node is not a git repository and cannot be updated'],
  'm.nodes.updating': ['更新 {name} ...', 'Updating {name} ...'],
  'm.nodes.updateFailed': ['更新失败: {msg}', 'Update failed: {msg}'],
  'm.nodes.updateDone': ['{name} 更新完成', '{name} updated'],
  'm.nodes.itemFailed': ['[失败] {name}: {msg}', '[Failed] {name}: {msg}'],
  'm.nodes.updateAllDone': [
    '全部更新完成：成功 {ok}，失败 {failed}',
    'All updates finished: {ok} succeeded, {failed} failed'
  ],
  'm.nodes.invalidPath': ['非法路径', 'Invalid path'],

  'm.wf.invalidPath': ['非法路径', 'Invalid path'],
  'm.wf.dialogFilter': ['ComfyUI 工作流', 'ComfyUI Workflow'],
  'm.wf.notRunning': ['ComfyUI 未运行，请先启动服务', 'ComfyUI is not running. Please start the service first'],
  'm.wf.notJson': ['工作流文件不是合法 JSON', 'The workflow file is not valid JSON'],
  'm.wf.uiFormat': [
    '该文件是界面格式工作流，无法直接运行；请在 ComfyUI 中开启开发者模式并导出「API 格式」JSON',
    'This file is a UI-format workflow and cannot be run directly. Enable developer mode in ComfyUI and export it as an "API format" JSON'
  ],
  'm.wf.unknownFormat': ['无法识别的工作流格式', 'Unrecognized workflow format'],
  'm.wf.submitFailed': ['提交失败 HTTP {status}：{detail}', 'Submission failed (HTTP {status}): {detail}'],

  'm.models.invalidPath': ['非法路径', 'Invalid path']
} as const satisfies MessageTable
