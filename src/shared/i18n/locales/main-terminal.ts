import type { MessageTable } from '../types'

/** 主进程：终端与 Python / GPU 探测（src/main/terminal.ts、python.ts、gpu.ts），键前缀 m.term. / m.py. / m.gpu. */
export default {
  'm.py.tagUnrecognized': ['无法识别 Python 版本标签: {detail}', 'Unrecognized Python version tag: {detail}'],
  'm.py.versionUnknown': ['未知', 'Unknown'],
  'm.py.venvFailed': ['创建虚拟环境失败: {detail}', 'Failed to create virtual environment: {detail}'],
  'm.gpu.unknownName': ['未知显卡', 'Unknown GPU']
} as const satisfies MessageTable
