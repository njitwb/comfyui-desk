import type { MessageTable } from '../types'

/** 主进程：诊断与修复（src/main/diagnostics.ts），键前缀 m.diag. */
export default {
  'm.diag.src.name': ['ComfyUI 源码', 'ComfyUI source'],
  'm.diag.src.missing': [
    '未找到 main.py，请先在「安装」页安装',
    'main.py not found. Please install on the "Install" page first'
  ],
  'm.diag.venv.name': ['Python 虚拟环境', 'Python virtual environment'],
  'm.diag.venv.missing': ['未创建虚拟环境', 'Virtual environment not created'],
  'm.diag.pip.name': ['pip', 'pip'],
  'm.diag.pip.unavailable': ['pip 不可用，可执行修复', 'pip unavailable; run repair'],
  'm.diag.torch.name': ['PyTorch', 'PyTorch'],
  'm.diag.torch.passCuda': ['torch {ver} / CUDA 可用', 'torch {ver} / CUDA available'],
  'm.diag.torch.passNoCuda': ['torch {ver} / CUDA 不可用', 'torch {ver} / CUDA unavailable'],
  'm.diag.torch.missing': ['未安装或无法导入 torch', 'torch not installed or cannot be imported'],
  'm.diag.cuda.name': ['CUDA 加速', 'CUDA acceleration'],
  'm.diag.cuda.warn': ['CUDA 不可用，将以 CPU 模式运行（速度慢）', 'CUDA unavailable; will run in CPU mode (slow)'],
  'm.diag.deps.name': ['依赖完整性', 'Dependency integrity'],
  'm.diag.deps.ok': ['无冲突', 'No conflicts'],
  'm.diag.deps.conflict': ['存在依赖冲突', 'Dependency conflicts found'],
  'm.diag.git.name': ['Git', 'Git'],
  'm.diag.git.unavailable': ['git 不可用，安装/更新节点功能将受限', 'git unavailable; node install/update will be limited'],
  'm.diag.stage.repair': ['修复', 'Repair'],
  'm.diag.stage.done': ['完成', 'Done'],
  'm.diag.repair.removeVenv': ['删除旧虚拟环境...', 'Removing old virtual environment...'],
  'm.diag.repair.rebuildVenv': ['重建虚拟环境...', 'Rebuilding virtual environment...'],
  'm.diag.repair.rebuilt': ['环境重建完成', 'Environment rebuild complete'],
  'm.diag.repair.needPython': [
    '重建环境需要提供 Python 路径（安装页选择）',
    'A Python path is required to rebuild the environment (select one on the Install page)'
  ],
  'm.diag.repair.pipStart': ['修复 pip ...', 'Repairing pip ...'],
  'm.diag.repair.pipFailed': ['pip 修复失败', 'pip repair failed'],
  'm.diag.repair.pipDone': ['pip 已修复', 'pip repaired'],
  'm.diag.repair.torchDone': ['PyTorch 重装完成', 'PyTorch reinstall complete'],
  'm.diag.repair.depsDone': ['依赖修复完成', 'Dependencies repaired']
} as const satisfies MessageTable
