import type { MessageTable } from '../types'

/** 终端页（src/renderer/src/views/Terminal.vue），键前缀 term. */
export default {
  'term.title': ['终端', 'Terminal'],
  'term.desc': [
    '交互式终端（{shell}） — 已自动加载 ComfyUI 运行环境（venv / git 均已在 PATH 中）',
    'Interactive terminal ({shell}) — ComfyUI runtime loaded (venv / git already on PATH)'
  ],
  'term.descNoShell': [
    '交互式终端 — 已自动加载 ComfyUI 运行环境（venv / git 均已在 PATH 中）',
    'Interactive terminal — ComfyUI runtime loaded (venv / git already on PATH)'
  ],
  'term.exited': [
    '[会话已退出 (code {code})，按回车开启新会话]',
    '[Session exited (code {code}), press Enter to start a new session]'
  ]
} as const satisfies MessageTable
