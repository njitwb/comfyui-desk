import { describe, it, expect } from 'vitest'
import { resolveModelSources, hasCloudSource, sourceLabel } from '../src/main/pack-catalog'

describe('pack-catalog 模型来源解析', () => {
  it('显式直链优先，末尾补在线搜索与手动兜底', () => {
    const s = resolveModelSources('z_image_turbo_bf16.safetensors', 'diffusion_models')
    expect(s[0]).toMatchObject({ type: 'hf', repo: 'Comfy-Org/z_image_turbo' })
    expect(s.some(x => x.type === 'search')).toBe(true)
    expect(s[s.length - 1]).toEqual({ type: 'manual' })
    expect(hasCloudSource(s)).toBe(true)
  })

  it('未知模型也能得到搜索 + 手动来源', () => {
    const s = resolveModelSources('totally_unknown_model.safetensors', 'loras')
    expect(s.map(x => x.type)).toContain('search')
    expect(s[s.length - 1]).toEqual({ type: 'manual' })
  })

  it('家族规则能推导同仓库不同文件名', () => {
    const s = resolveModelSources('minimax_h3_ref2va_bf16.safetensors', 'diffusion_models')
    expect(s[0]).toMatchObject({ type: 'hf', repo: 'Comfy-Org/MiniMax-H3' })
  })

  it('来源展示文案可读', () => {
    expect(sourceLabel({ type: 'hf', repo: 'a/b', file: 'x' })).toContain('a/b')
    expect(sourceLabel({ type: 'manual' })).toContain('手动')
  })
})
