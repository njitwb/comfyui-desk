import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  runMock: vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ code: number; out: string; err: string }>>()
}))
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, run: h.runMock }
})

import { detectGpu } from '../src/main/gpu'

beforeEach(() => h.runMock.mockReset())

const psOut = (data: unknown) => ({ code: 0, out: JSON.stringify(data), err: '' })

describe('detectGpu', () => {
  it('解析 WMI 单显卡（JSON 对象而非数组）', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'powershell') return psOut({ Name: 'NVIDIA GeForce RTX 4090', DriverVersion: '560.70' })
      if (cmd === 'nvidia-smi') return { code: 0, out: '24564\n', err: '' }
      return { code: 1, out: '', err: '' }
    })
    const gpus = await detectGpu()
    expect(gpus).toHaveLength(1)
    expect(gpus[0]).toEqual({ name: 'NVIDIA GeForce RTX 4090', driver: '560.70', vendor: 'nvidia', vram: 24564 })
  })

  it('多显卡混合：按顺序只为 NVIDIA 卡填显存', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'powershell')
        return psOut([
          { Name: 'Intel UHD Graphics 770', DriverVersion: '31.0' },
          { Name: 'NVIDIA GeForce RTX 3060', DriverVersion: '552.12' },
          { Name: 'AMD Radeon RX 6600', DriverVersion: '32.0' }
        ])
      if (cmd === 'nvidia-smi') return { code: 0, out: '12288\n', err: '' }
      return { code: 1, out: '', err: '' }
    })
    const gpus = await detectGpu()
    expect(gpus.map(g => g.vendor)).toEqual(['intel', 'nvidia', 'amd'])
    expect(gpus[0].vram).toBe(0)
    expect(gpus[1].vram).toBe(12288)
    expect(gpus[2].vram).toBe(0)
  })

  it('多张 NVIDIA 卡按 nvidia-smi 顺序对应', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'powershell')
        return psOut([
          { Name: 'NVIDIA RTX A', DriverVersion: '1' },
          { Name: 'NVIDIA RTX B', DriverVersion: '1' }
        ])
      if (cmd === 'nvidia-smi') return { code: 0, out: '8192\n16384\n', err: '' }
      return { code: 1, out: '', err: '' }
    })
    const gpus = await detectGpu()
    expect(gpus[0].vram).toBe(8192)
    expect(gpus[1].vram).toBe(16384)
  })

  it('nvidia-smi 不可用时显存为 0', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'powershell') return psOut({ Name: 'GeForce GTX 1060', DriverVersion: '1' })
      if (cmd === 'nvidia-smi') throw new Error('not found')
      return { code: 1, out: '', err: '' }
    })
    const gpus = await detectGpu()
    expect(gpus[0].vendor).toBe('nvidia')
    expect(gpus[0].vram).toBe(0)
  })

  it('powershell 失败返回空数组', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'powershell') throw new Error('no powershell')
      return { code: 1, out: '', err: '' }
    })
    expect(await detectGpu()).toEqual([])
  })

  it('非 JSON 输出返回空数组', async () => {
    h.runMock.mockResolvedValue({ code: 0, out: 'not-json', err: '' })
    expect(await detectGpu()).toEqual([])
  })

  it('厂商识别：unknown 兜底', async () => {
    h.runMock.mockImplementation(async cmd => {
      if (cmd === 'powershell') return psOut({ Name: 'Virtual Display Adapter', DriverVersion: '' })
      return { code: 1, out: '', err: '' }
    })
    expect((await detectGpu())[0].vendor).toBe('unknown')
  })
})
