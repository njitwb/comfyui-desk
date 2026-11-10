import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { effectiveComponents, validatePackManifest, PACK_SCHEMA } from '../src/shared/pack'

function builtin(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources/packs/infinite-canvas/comfyui-pack.json'), 'utf-8'))
}

describe('整合包 manifest 校验', () => {
  it('内置包 manifest 合法', () => {
    const v = validatePackManifest(builtin())
    expect(v.errors).toEqual([])
  })

  it('拒绝未知 schema', () => {
    expect(validatePackManifest({ ...builtin(), schema: 'other@2' }).errors[0]).toContain('不支持的 schema')
  })

  it('拒绝不安全的模型目录与工作流路径', () => {
    const m = builtin() as { components: Array<{ models?: Array<{ category: string }>; workflows?: Array<{ file: string }> }> }
    const first = m.components[0]
    first.models![0].category = '../escape'
    const v1 = validatePackManifest(m)
    expect(v1.errors.some(e => e.includes('category'))).toBe(true)

    const m2 = builtin() as { components: Array<{ workflows?: Array<{ file: string }> }> }
    m2.components[0].workflows![0].file = '/abs/path.json'
    const v2 = validatePackManifest(m2)
    expect(v2.errors.some(e => e.includes('file'))).toBe(true)
  })

  it('组件 id 重复会报错', () => {
    const m = builtin() as { components: Array<{ id: string }> }
    m.components.push({ ...m.components[0] })
    const v = validatePackManifest(m)
    expect(v.errors.some(e => e.includes('组件 id 重复'))).toBe(true)
  })

  it('扁平写法会包装成 default 组件', () => {
    const flat = {
      schema: PACK_SCHEMA,
      id: 'flat',
      name: 'Flat',
      version: '1.0.0',
      createdAt: '2026-01-01T00:00:00Z',
      nodes: [{ key: 'N', source: { type: 'git', url: 'https://github.com/a/b.git' }, requirements: true }]
    }
    expect(validatePackManifest(flat).errors).toEqual([])
    expect(effectiveComponents(flat as never).map(c => c.id)).toEqual(['default'])
  })
})
