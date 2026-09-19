import type { MessageTable } from '../types'

/** 诊断页（src/renderer/src/views/Tools.vue），键前缀 tools. */
export default {
  'tools.title': ['诊断', 'Diagnostics'],
  'tools.desc': [
    '运行环境诊断与修复：依赖完整性、torch / CUDA、虚拟环境恢复',
    'Diagnose and repair the runtime: dependencies, torch / CUDA, virtual environment recovery'
  ],
  'tools.diagTitle': ['一键诊断', 'One-click diagnostics'],
  'tools.scanning': ['诊断中…', 'Scanning…'],
  'tools.rescan': ['重新诊断', 'Rescan'],
  'tools.empty': ['点击「重新诊断」开始检查', 'Click "Rescan" to start'],
  'tools.repairTitle': ['修复操作', 'Repair actions'],
  'tools.repairPip': ['修复 pip', 'Repair pip'],
  'tools.reinstallTorch': ['重装 Torch', 'Reinstall Torch'],
  'tools.reinstallDeps': ['重装依赖', 'Reinstall dependencies'],
  'tools.rebuildAll': ['重建整个环境', 'Rebuild environment'],
  'tools.repairing': ['修复进行中，请稍候…', 'Repairing, please wait…'],
  'tools.repairDone': ['修复完成', 'Repair complete']
} as const satisfies MessageTable
