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
  'term.clipboardHint': [
    '复制：Ctrl+Shift+C 或 Ctrl+Insert（Ctrl+C 在有选中内容时复制，无选中则中断进程） · 粘贴：Ctrl+V 或 Shift+Insert · 右键：有选中复制，否则粘贴',
    'Copy: Ctrl+Shift+C or Ctrl+Insert (Ctrl+C copies when text is selected, otherwise interrupts) · Paste: Ctrl+V or Shift+Insert · Right-click: copy if selected, otherwise paste'
  ],
  'term.exited': [
    '[会话已退出 (code {code})，按回车开启新会话]',
    '[Session exited (code {code}), press Enter to start a new session]'
  ]
} as const satisfies MessageTable
