import { describe, it, expect } from 'vitest'
import { splitArgs, run, killTree, gitExe, gitDir, compareSemver } from '../src/main/util'

describe('splitArgs', () => {
  it('按空格切分', () => {
    expect(splitArgs('--listen --port 8188')).toEqual(['--listen', '--port', '8188'])
  })

  it('连续空白与换行折叠', () => {
    expect(splitArgs('  --fast\n\t--lowvram  ')).toEqual(['--fast', '--lowvram'])
  })

  it('双引号保留空格并去引号', () => {
    expect(splitArgs('--path "D:\\My Models\\x" --fast')).toEqual(['--path', 'D:\\My Models\\x', '--fast'])
  })

  it('单引号同样处理', () => {
    expect(splitArgs("--note 'hello world'")).toEqual(['--note', 'hello world'])
  })

  it('空串返回空数组', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('   ')).toEqual([])
  })
})

describe('gitExe / gitDir', () => {
  it('与 resources/git 实际存在状态一致', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const bundled = fs.existsSync(path.join(process.cwd(), 'resources', 'git', 'cmd', 'git.exe'))
    if (bundled) {
      expect(gitDir()).not.toBeNull()
      expect(gitExe()).toContain('git.exe')
    } else {
      expect(gitDir()).toBeNull()
      expect(gitExe()).toBe('git')
    }
  })
})

describe('run', () => {
  it('成功执行并收集 stdout', async () => {
    const r = await run(process.execPath, ['-e', 'console.log("hello-cm")'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('hello-cm')
  })

  it('收集 stderr 与非零退出码', async () => {
    const r = await run(process.execPath, ['-e', 'console.error("oops");process.exit(3)'])
    expect(r.code).toBe(3)
    expect(r.err).toContain('oops')
  })

  it('onData 实时回调收到输出', async () => {
    const chunks: string[] = []
    await run(process.execPath, ['-e', 'console.log("a");console.log("b")'], { onData: s => chunks.push(s) })
    expect(chunks.join('')).toContain('a')
    expect(chunks.join('')).toContain('b')
  })

  it('超时结束进程并标记 [timeout]', async () => {
    const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 500 })
    expect(r.code).toBe(-1)
    expect(r.err).toContain('[timeout]')
  })

  it('不存在的可执行文件 reject', async () => {
    await expect(run('definitely-not-exist-cmd-xyz', [])).rejects.toThrow()
  })
})

describe('killTree', () => {
  it('undefined / 0 直接返回不抛错', () => {
    expect(() => killTree(undefined)).not.toThrow()
    expect(() => killTree(0)).not.toThrow()
  })
})

describe('compareSemver', () => {
  it('逐段数值比较，不受字典序影响', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0)
    expect(compareSemver('2.0.0', '10.0.0')).toBeLessThan(0)
  })

  it('忽略 v/V 前缀', () => {
    expect(compareSemver('v1.2.0', '1.2.0')).toBe(0)
    expect(compareSemver('V1.2.1', 'v1.2.0')).toBeGreaterThan(0)
  })

  it('段数不同时缺省补 0', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0)
    expect(compareSemver('1.2.1', '1.2')).toBeGreaterThan(0)
  })

  it('非数字段按 0 处理', () => {
    expect(compareSemver('master', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', 'master')).toBeGreaterThan(0)
  })
})
