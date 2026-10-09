import { reactive } from 'vue'
import { api } from './api'
import { t } from './i18n'
import type { ComfyInfo, ComfyStatus, LogLine, ProgressEvent, TorchVariant } from '../../shared/api'

const DEFAULT_MAX_LOGS = 5000

/** 日志上限：读取设置 logMaxLines，非法（0/NaN/缺省）时回退默认值 */
function maxLogs(): number {
  const v = Number((store.settings as Record<string, unknown> | null)?.['logMaxLines'])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_MAX_LOGS
}

/** 超出上限时丢弃最早的行，避免日志无限增长导致界面卡顿 */
function trimLogs(): void {
  const max = maxLogs()
  if (store.logs.length > max) store.logs.splice(0, store.logs.length - max)
}

export const store = reactive({
  status: 'stopped' as ComfyStatus,
  info: null as ComfyInfo | null,
  settings: null as Record<string, unknown> | null,
  logs: [] as LogLine[],
  /** 安装/更新/修复等长任务进度 */
  progress: null as ProgressEvent | null,
  busy: false,
  /** 可选 torch 索引（cu130/cu128/.../cpu），启动时动态拉取 */
  torchIndexes: [] as string[],
  /** 各源下匹配当前 venv Python 的最新 torch 版本 */
  torchVariants: [] as TorchVariant[]
})

/** 加载可用的 torch/CUDA 索引列表（只拉一次） */
export async function loadTorchIndexes(force = false): Promise<void> {
  if (!force && store.torchIndexes.length) return
  try {
    store.torchIndexes = (await api.torchIndexes()) as string[]
  } catch {
    store.torchIndexes = ['cu128', 'cu126', 'cu124', 'cu121', 'cpu']
  }
}

/** 加载各源可安装的 torch 精确版本（只拉一次） */
export async function loadTorchVariants(force = false): Promise<void> {
  if (!force && store.torchVariants.length) return
  try {
    const vs = (await api.torchVariants()) as TorchVariant[]
    if (!vs.length) throw new Error('empty')
    store.torchVariants = vs
  } catch {
    await loadTorchIndexes()
    store.torchVariants = store.torchIndexes.map(index => ({ index, torch: '' }))
  }
}

/** 显示名：cu128 -> CUDA 12.8；cpu -> CPU 版 */
export function torchLabel(index: string): string {
  if (index.startsWith('cu')) {
    const n = index.slice(2)
    return `CUDA ${n.slice(0, -1)}.${n.slice(-1)}`
  }
  if (index === 'cpu') return t('store.cpuEdition')
  if (index.startsWith('rocm')) return `ROCm ${index.slice(4)}`
  return index.toUpperCase()
}

export function initStore(): void {
  api.onStatus(s => {
    store.status = s
    void refreshInfo()
  })
  api.onLog(line => {
    store.logs.push(line)
    trimLogs()
  })
  api.onInstallProgress(e => {
    store.progress = e.percent >= 100 ? null : e
  })
  void refreshInfo()
  void (async () => {
    store.settings = await api.getSettings()
    store.status = (await api.getStatus()) as ComfyStatus
    const recent = (await api.recentLogs()) as LogLine[]
    store.logs.push(...recent.slice(-maxLogs()))
  })()
}

export async function refreshInfo(): Promise<void> {
  try {
    store.info = (await api.getInfo()) as ComfyInfo
  } catch {
    /* ignore */
  }
}

export async function refreshSettings(): Promise<void> {
  store.settings = await api.getSettings()
}
