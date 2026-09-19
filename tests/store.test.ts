import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type StoreModule = typeof import('../src/renderer/src/store')

let storeMod: StoreModule
let apiMock: {
  [k: string]: ReturnType<typeof vi.fn>
}

beforeEach(async () => {
  apiMock = {
    getSettings: vi.fn(async () => ({ port: 8188 })),
    getStatus: vi.fn(async () => 'stopped'),
    recentLogs: vi.fn(async () => [{ ts: 1, stream: 'sys', text: 'old' }]),
    getInfo: vi.fn(async () => ({ installed: true, version: '0.3.60' })),
    onStatus: vi.fn(() => () => {}),
    onLog: vi.fn(() => () => {}),
    onInstallProgress: vi.fn(() => () => {}),
    torchIndexes: vi.fn(async () => ['cu128', 'cu124', 'cpu']),
    torchVariants: vi.fn(async () => [
      { index: 'cu128', torch: '2.9.0+cu128' },
      { index: 'cpu', torch: '2.9.0+cpu' }
    ])
  }
  vi.stubGlobal('window', { api: apiMock })
  vi.resetModules()
  storeMod = await import('../src/renderer/src/store')
})

afterEach(() => vi.unstubAllGlobals())

const flush = () => new Promise(r => setTimeout(r, 0))

describe('torchLabel', () => {
  it('cu 前缀转 CUDA 版本号', () => {
    expect(storeMod.torchLabel('cu128')).toBe('CUDA 12.8')
    expect(storeMod.torchLabel('cu130')).toBe('CUDA 13.0')
    expect(storeMod.torchLabel('cu126')).toBe('CUDA 12.6')
  })

  it('cpu / rocm / 其他', () => {
    expect(storeMod.torchLabel('cpu')).toBe('CPU 版')
    expect(storeMod.torchLabel('rocm6.2')).toBe('ROCm 6.2')
    expect(storeMod.torchLabel('xpu')).toBe('XPU')
  })
})

describe('loadTorchIndexes', () => {
  it('成功拉取并缓存（二次调用不再请求）', async () => {
    await storeMod.loadTorchIndexes()
    expect(storeMod.store.torchIndexes).toEqual(['cu128', 'cu124', 'cpu'])
    await storeMod.loadTorchIndexes()
    expect(apiMock.torchIndexes).toHaveBeenCalledTimes(1)
  })

  it('force 重新拉取', async () => {
    await storeMod.loadTorchIndexes()
    await storeMod.loadTorchIndexes(true)
    expect(apiMock.torchIndexes).toHaveBeenCalledTimes(2)
  })

  it('接口失败回退静态列表', async () => {
    apiMock.torchIndexes.mockRejectedValue(new Error('offline'))
    await storeMod.loadTorchIndexes()
    expect(storeMod.store.torchIndexes).toEqual(['cu128', 'cu126', 'cu124', 'cu121', 'cpu'])
  })
})

describe('loadTorchVariants', () => {
  it('成功拉取精确版本', async () => {
    await storeMod.loadTorchVariants()
    expect(storeMod.store.torchVariants).toEqual([
      { index: 'cu128', torch: '2.9.0+cu128' },
      { index: 'cpu', torch: '2.9.0+cpu' }
    ])
  })

  it('接口失败时退化为仅索引列表', async () => {
    apiMock.torchVariants.mockRejectedValue(new Error('offline'))
    await storeMod.loadTorchVariants()
    expect(storeMod.store.torchVariants).toEqual([
      { index: 'cu128', torch: '' },
      { index: 'cu124', torch: '' },
      { index: 'cpu', torch: '' }
    ])
  })

  it('返回空列表也视为失败走兜底', async () => {
    apiMock.torchVariants.mockResolvedValue([])
    await storeMod.loadTorchVariants()
    expect(storeMod.store.torchVariants.every(v => v.torch === '')).toBe(true)
  })
})

describe('initStore 事件接线', () => {
  it('初始加载设置/状态/历史日志', async () => {
    storeMod.initStore()
    await flush()
    expect(storeMod.store.settings).toEqual({ port: 8188 })
    expect(storeMod.store.status).toBe('stopped')
    expect(storeMod.store.logs).toEqual([{ ts: 1, stream: 'sys', text: 'old' }])
    expect(storeMod.store.info).toEqual({ installed: true, version: '0.3.60' })
  })

  it('onStatus 更新状态并刷新 info', async () => {
    storeMod.initStore()
    await flush()
    const statusCb = apiMock.onStatus.mock.calls[0][0] as (s: string) => void
    apiMock.getInfo.mockClear()
    statusCb('running')
    expect(storeMod.store.status).toBe('running')
    await flush()
    expect(apiMock.getInfo).toHaveBeenCalled()
  })

  it('onLog 追加并裁剪到 3000 条', async () => {
    storeMod.initStore()
    await flush()
    const logCb = apiModLog()
    for (let i = 0; i < 3100; i++) logCb({ ts: i, stream: 'stdout', text: `l${i}` })
    expect(storeMod.store.logs.length).toBe(3000)
    expect(storeMod.store.logs[storeMod.store.logs.length - 1].text).toBe('l3099')
  })

  it('onInstallProgress 100% 时清空进度', async () => {
    storeMod.initStore()
    const progressCb = apiMock.onInstallProgress.mock.calls[0][0] as (e: { percent: number }) => void
    progressCb({ stage: 'Torch', message: 'x', percent: 50 })
    expect(storeMod.store.progress).toEqual({ stage: 'Torch', message: 'x', percent: 50 })
    progressCb({ stage: '完成', message: 'done', percent: 100 })
    expect(storeMod.store.progress).toBeNull()
  })

  function apiModLog(): (l: { ts: number; stream: string; text: string }) => void {
    return apiMock.onLog.mock.calls[0][0] as (l: { ts: number; stream: string; text: string }) => void
  }
})
