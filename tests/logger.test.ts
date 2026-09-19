import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type LoggerModule = typeof import('../src/main/logger')

let logger: LoggerModule
let userData: string

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  logger = await freshImport<LoggerModule>('../src/main/logger')
})

afterEach(() => rmTmpDir(userData))

describe('appendLog', () => {
  it('按天写入日志文件，格式 "HH:MM:SS [stream] text"', () => {
    logger.appendLog({ ts: Date.now(), stream: 'sys', text: 'hello log' })
    const files = fs.readdirSync(path.join(userData, 'logs'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^launcher-\d{4}-\d{2}-\d{2}\.log$/)
    const content = fs.readFileSync(path.join(userData, 'logs', files[0]), 'utf-8')
    expect(content).toMatch(/^\d{2}:\d{2}:\d{2} \[sys\] hello log\n$/)
  })

  it('多行追加到同一文件', () => {
    logger.appendLog({ ts: Date.now(), stream: 'stdout', text: 'l1' })
    logger.appendLog({ ts: Date.now(), stream: 'stderr', text: 'l2' })
    const files = fs.readdirSync(path.join(userData, 'logs'))
    const lines = fs.readFileSync(path.join(userData, 'logs', files[0]), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('[stderr] l2')
  })

  it('只保留最近 7 天的日志文件，首次写入时清理', () => {
    const dir = path.join(userData, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync(path.join(dir, `launcher-2026-09-${String(i).padStart(2, '0')}.log`), 'old')
    }
    fs.writeFileSync(path.join(dir, 'not-a-log.txt'), 'keep')
    logger.appendLog({ ts: Date.now(), stream: 'sys', text: 'trigger clean' })
    const files = fs.readdirSync(dir)
    const launcherLogs = files.filter(f => /^launcher-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    // 清理发生在写入前：10 个旧文件保留最新 7 个，加上今天新写入的 1 个
    expect(launcherLogs.length).toBe(8)
    expect(files).toContain('not-a-log.txt') // 非日志文件不受影响
    // 最旧的三个已被删除
    expect(launcherLogs).not.toContain('launcher-2026-09-01.log')
    expect(launcherLogs).not.toContain('launcher-2026-09-03.log')
    expect(launcherLogs).toContain('launcher-2026-09-04.log')
  })

  it('logDir 指向 userData/logs', () => {
    expect(logger.logDir()).toBe(path.join(userData, 'logs'))
  })
})
