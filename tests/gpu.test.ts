import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  runMock: vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ code: number; out: string; err: string }>>()
}))
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, run: h.runMock }
})

import { detectGpu } from '../src/main/gpu'

const IS_WIN = process.platform === 'win32'

beforeEach(() => h.runMock.mockReset())

// 按平台返回「一次成功打满」的默认实现：无匹配命令一律失败
function nvidia(name: string, driver: string, vram: number): () => Promise<{ code: number; out: string; err: string }> {
  return async (cmd: string) => {
    if (cmd === 'nvidia-smi') {
      const out = IS_WIN ? `${vram}\n` : `${name}, ${driver}, ${vram}\n`
      return { code: 0, out, err: '' }
    }
    if (cmd === 'powershell') return { code: 0, out: JSON.stringify({ Name: name, DriverVersion: driver }), err: '' }
    return { code: 1, out: '', err: '' }
  }
}

describe('detectGpu', () => {
  it('识别单张 NVIDIA 卡并读取显存', async () => {
    h.runMock.mockImplementation(nvidia('NVIDIA GeForce RTX 4090', '560.70', 24564))
    const gpus = await detectGpu()
    expect(gpus).toHaveLength(1)
    expect(gpus[0].vendor).toBe('nvidia')
    expect(gpus[0].name).toContain('NVIDIA GeForce RTX 4090')
    expect(gpus[0].vram).toBe(24564)
  })

  it('厂商识别：unknown 兜底', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'nvidia-smi') return { code: 0, out: IS_WIN ? '\n' : 'Virtual Display Adapter, , 0\n', err: '' }
      if (cmd === 'powershell') return { code: 0, out: JSON.stringify({ Name: 'Virtual Display Adapter', DriverVersion: '' }), err: '' }
      return { code: 1, out: '', err: '' }
    })
    const gpus = await detectGpu()
    expect(gpus.length).toBeGreaterThan(0)
    expect(gpus[0].vendor).toBe('unknown')
  })

  it('nvidia-smi 不可用时显存为 0', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'nvidia-smi') throw new Error('not found')
      if (cmd === 'powershell') return { code: 0, out: JSON.stringify({ Name: 'GeForce GTX 1060', DriverVersion: '1' }), err: '' }
      // POSIX 会再尝试 lspci，一并失败
      return { code: 1, out: '', err: '' }
    })
    const gpus = await detectGpu()
    if (IS_WIN) {
      expect(gpus[0].vendor).toBe('nvidia')
      expect(gpus[0].vram).toBe(0)
    } else {
      expect(gpus).toEqual([])
    }
  })

  it('检测完全失败返回空数组', async () => {
    h.runMock.mockImplementation(async () => ({ code: 1, out: '', err: '' }))
    expect(await detectGpu()).toEqual([])
  })

  it('异常输出不抛错（Windows 非 JSON 为空，POSIX 尽量解析）', async () => {
    h.runMock.mockResolvedValue({ code: 0, out: 'not-json', err: '' })
    if (IS_WIN) {
      expect(await detectGpu()).toEqual([])
    } else {
      // CSV 分列后「not-json」被当作名称，厂商识别为 unknown，不崩溃即可
      const gpus = await detectGpu()
      expect(gpus).toHaveLength(1)
      expect(gpus[0].vendor).toBe('unknown')
    }
  })

  it('多张 NVIDIA 卡按 nvidia-smi 顺序对应显存', async () => {
    if (IS_WIN) {
      h.runMock.mockImplementation(async cmd => {
        if (cmd === 'powershell')
          return { code: 0, out: JSON.stringify([{ Name: 'NVIDIA RTX A', DriverVersion: '1' }, { Name: 'NVIDIA RTX B', DriverVersion: '1' }]), err: '' }
        if (cmd === 'nvidia-smi') return { code: 0, out: '8192\n16384\n', err: '' }
        return { code: 1, out: '', err: '' }
      })
      const gpus = await detectGpu()
      expect(gpus[0].vram).toBe(8192)
      expect(gpus[1].vram).toBe(16384)
    } else {
      h.runMock.mockImplementation(async cmd => {
        if (cmd === 'nvidia-smi') return { code: 0, out: 'NVIDIA RTX A, 1, 8192\nNVIDIA RTX B, 1, 16384\n', err: '' }
        return { code: 1, out: '', err: '' }
      })
      const gpus = await detectGpu()
      expect(gpus[0].vram).toBe(8192)
      expect(gpus[1].vram).toBe(16384)
    }
  })
})