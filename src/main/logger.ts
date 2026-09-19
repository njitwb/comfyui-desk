import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { LogLine } from '../shared/api'

const KEEP_DAYS = 7
let dir = ''
let cleaned = false

/** 日志落盘目录（launcher-YYYY-MM-DD.log） */
export function logDir(): string {
  if (!dir) dir = path.join(app.getPath('userData'), 'logs')
  return dir
}

function todayFile(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return path.join(logDir(), `launcher-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`)
}

/** 首次写入时清理超出保留天数的日志文件 */
function cleanOld(): void {
  if (cleaned) return
  cleaned = true
  try {
    const files = fs
      .readdirSync(logDir())
      .filter(f => /^launcher-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) {
      fs.rmSync(path.join(logDir(), f), { force: true })
    }
  } catch {
    /* ignore */
  }
}

export function appendLog(l: LogLine): void {
  try {
    fs.mkdirSync(logDir(), { recursive: true })
    cleanOld()
    const t = new Date(l.ts).toTimeString().slice(0, 8)
    fs.appendFileSync(todayFile(), `${t} [${l.stream}] ${l.text}\n`, 'utf-8')
  } catch {
    /* 写日志失败不影响业务 */
  }
}
