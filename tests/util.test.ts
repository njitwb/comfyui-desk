import { describe, it, expect } from 'vitest'
import { splitArgs, run, killTree, gitExe, gitDir } from '../src/main/util'

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
