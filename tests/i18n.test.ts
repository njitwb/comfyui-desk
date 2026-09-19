import { describe, expect, it } from 'vitest'
import { MESSAGES, translate } from '../src/shared/i18n'

/** 各模块文案表（新增 locales/*.ts 会被自动纳入守卫） */
const mods = import.meta.glob<{ default: Record<string, readonly [string, string]> }>(
  '../src/shared/i18n/locales/*.ts',
  { eager: true }
)

describe('i18n 文案表', () => {
  it('中英文都不为空', () => {
    const bad: string[] = []
    for (const [key, pair] of Object.entries(MESSAGES)) {
      if (!pair[0].trim() || !pair[1].trim()) bad.push(key)
    }
    expect(bad).toEqual([])
  })

  it('模块之间没有重复键（重复会被合并时静默覆盖）', () => {
    const seen = new Map<string, string>()
    const dup: string[] = []
    for (const [file, mod] of Object.entries(mods)) {
      for (const key of Object.keys(mod.default)) {
        const prev = seen.get(key)
        if (prev) dup.push(`${key}：${prev} 与 ${file}`)
        else seen.set(key, file)
      }
    }
    expect(dup).toEqual([])
  })

  it('合并结果覆盖所有模块的键且无遗漏', () => {
    const total = Object.values(mods).reduce((n, m) => n + Object.keys(m.default).length, 0)
    expect(Object.keys(MESSAGES).length).toBe(total)
    expect(total).toBeGreaterThan(0)
  })

  it('键名统一为 `<模块>.<语义>` 形式', () => {
    const bad = Object.keys(MESSAGES).filter(k => !/^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/.test(k))
    expect(bad).toEqual([])
  })

  it('按语言取值并替换 {占位符}', () => {
    expect(translate('zh', 'app.title')).toBe('ComfyUI 桌面管家')
    expect(translate('en', 'app.title')).toBe('ComfyUI Desk')
    // 启动日志是主进程输出格式的一部分，两种语言都不应被改坏
    expect(translate('zh', 'app.logStartup', { version: '1.2.3' })).toBe('[管家] ComfyUI 桌面管家 v1.2.3 启动')
    expect(translate('en', 'app.logStartup', { version: '1.2.3' })).toBe('[Desk] ComfyUI Desk v1.2.3 started')
  })

  it('缺失键回显键名，便于定位漏配', () => {
    expect(translate('en', 'no.such.key' as never)).toBe('no.such.key')
  })
})
