import fs from 'node:fs'
import path from 'node:path'
import { dialog } from 'electron'
import { paths, loadSettings } from './settings'
import { comfy } from './process'
import { t } from './i18n'
import type { WorkflowItem } from '../shared/api'

export function workflowDir(): string {
  return paths().workflows
}

/** 判定工作流 JSON 格式：api=可提交 /prompt；ui=界面格式；unknown=无法识别 */
function detectFormat(data: unknown): 'api' | 'ui' | 'unknown' {
  if (!data || typeof data !== 'object') return 'unknown'
  const d = data as Record<string, unknown>
  if (Array.isArray(d.nodes)) return 'ui'
  // 部分导出会包一层 { prompt: {...} }
  const inner = d.prompt && typeof d.prompt === 'object' ? (d.prompt as Record<string, unknown>) : d
  for (const v of Object.values(inner)) {
    if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).class_type === 'string') return 'api'
  }
  return 'unknown'
}

function countNodes(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const d = data as Record<string, unknown>
  if (Array.isArray(d.nodes)) return d.nodes.length
  const inner = d.prompt && typeof d.prompt === 'object' ? (d.prompt as Record<string, unknown>) : d
  return Object.values(inner).filter(v => v && typeof v === 'object' && typeof (v as Record<string, unknown>).class_type === 'string').length
}

/** 递归扫描工作流目录（最多三层子目录） */
export function scanWorkflows(): WorkflowItem[] {
  const root = workflowDir()
  const result: WorkflowItem[] = []
  if (!fs.existsSync(root)) return result
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!e.name.toLowerCase().endsWith('.json')) continue
      try {
        const st = fs.statSync(full)
        let nodeCount = 0
        let format: WorkflowItem['format'] = 'unknown'
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf-8'))
          format = detectFormat(data)
          nodeCount = countNodes(data)
        } catch {
          /* 非合法 JSON，保留 unknown */
        }
        result.push({
          name: e.name,
          relPath: path.relative(root, full).split(path.sep).join('/'),
          path: full,
          size: st.size,
          mtime: st.mtimeMs,
          nodeCount,
          format
        })
      } catch {
        /* ignore */
      }
    }
  }
  walk(root, 0)
  result.sort((a, b) => b.mtime - a.mtime)
  return result
}

function assertSafePath(p: string): string {
  const root = path.resolve(workflowDir())
  const resolved = path.resolve(p)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) throw new Error(t('m.wf.invalidPath'))
  return resolved
}

export function deleteWorkflow(p: string): void {
  fs.rmSync(assertSafePath(p), { force: true })
}

/** 弹窗选择 JSON 并复制到工作流目录，重名时自动加序号 */
export async function importWorkflow(): Promise<WorkflowItem | null> {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: t('m.wf.dialogFilter'), extensions: ['json'] }]
  })
  if (r.canceled || !r.filePaths.length) return null
  const src = r.filePaths[0]
  const dir = workflowDir()
  fs.mkdirSync(dir, { recursive: true })
  const base = path.basename(src, path.extname(src))
  let name = base + '.json'
  let dest = path.join(dir, name)
  let i = 1
  while (fs.existsSync(dest)) {
    name = `${base}_${i++}.json`
    dest = path.join(dir, name)
  }
  fs.copyFileSync(src, dest)
  return scanWorkflows().find(w => w.path === dest) || null
}

/** 提取 API 格式 prompt 对象；UI 格式不可直接提交 */
function extractApiPrompt(data: unknown): Record<string, unknown> {
  const d = data as Record<string, unknown>
  if (d.prompt && typeof d.prompt === 'object') return d.prompt as Record<string, unknown>
  return d
}

/** 把 API 格式工作流提交到运行中的 ComfyUI 队列 */
export async function queueWorkflow(p: string): Promise<{ promptId: string; number: number }> {
  if (comfy.status !== 'running') throw new Error(t('m.wf.notRunning'))
  const file = assertSafePath(p)
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    throw new Error(t('m.wf.notJson'))
  }
  const format = detectFormat(data)
  if (format === 'ui') throw new Error(t('m.wf.uiFormat'))
  if (format !== 'api') throw new Error(t('m.wf.unknownFormat'))
  const port = loadSettings().port
  const resp = await fetch(`http://127.0.0.1:${port}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: extractApiPrompt(data) })
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(t('m.wf.submitFailed', { status: resp.status, detail: text.slice(0, 300) }))
  const out = JSON.parse(text) as { prompt_id?: string; number?: number }
  return { promptId: out.prompt_id || '', number: out.number ?? -1 }
}
