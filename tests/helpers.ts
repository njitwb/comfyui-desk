import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

/** 创建隔离的临时目录（每个测试文件/用例独立） */
export function mkTmpDir(prefix = 'cm-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** 递归删除临时目录 */
export function rmTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * 模拟 electron 模块：app.getPath 指向临时 userData。
 * userData 传 getter：mock factory 只求值一次，各用例换目录后需惰性读取最新值。
 */
export function electronMockFactory(userData: () => string, extra: Record<string, unknown> = {}) {
  return {
    app: {
      getPath: (name: string) => {
        const dir = userData()
        if (name === 'userData') return dir
        if (name === 'documents') return path.join(dir, 'documents')
        if (name === 'exe') return path.join(dir, 'app', 'launcher.exe')
        return dir
      },
      isPackaged: false,
      ...((extra.app as Record<string, unknown>) || {})
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
      ...((extra.dialog as Record<string, unknown>) || {})
    }
  }
}

/** 重置 module registry 后动态导入（清除 settings/downloads 等模块级缓存） */
export async function freshImport<T>(spec: string): Promise<T> {
  vi.resetModules()
  return (await import(spec)) as T
}

/** 轮询等待条件满足（用于异步下载状态） */
export async function waitFor(cond: () => boolean, timeoutMs = 8000, interval = 50): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (cond()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await new Promise(r => setTimeout(r, interval))
  }
}
