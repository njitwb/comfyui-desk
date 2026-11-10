import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'
import { listZipEntries, extractZip } from '../src/main/pack-zip'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type SettingsModule = typeof import('../src/main/settings')
type ExportModule = typeof import('../src/main/pack-export')

let settings: SettingsModule
let exporter: ExportModule
let userData: string
let comfy: string

beforeEach(async () => {
  userData = mkTmpDir('pack-export-')
  h.userData = userData
  settings = await freshImport<SettingsModule>('../src/main/settings')
  comfy = path.join(userData, 'runtime', 'ComfyUI')
  fs.mkdirSync(comfy, { recursive: true })
  fs.writeFileSync(path.join(comfy, 'main.py'), '# fake')
  settings.saveSettings({ installPath: path.join(userData, 'runtime') })
  exporter = await import('../src/main/pack-export')
})

afterEach(() => rmTmpDir(userData))

describe('pack-export', () => {
  it('官方内置包候选项包含 7 个组件与模型来源', async () => {
    const c = await exporter.previewExport('builtin')
    expect(c.id).toBe('infinite-canvas')
    expect(c.components.length).toBe(7)
    expect(c.models.length).toBeGreaterThan(30)
    const z = c.models.find(m => m.filename === 'z_image_turbo_bf16.safetensors')!
    expect(z.hasLink).toBe(true)
  })

  it('导出官方 text 组件：只含清单与模型链接，不再重复打包 API 工作流', async () => {
    const out = path.join(userData, 'out.zip')
    const r = await exporter.exportPack(
      { source: 'builtin', builtinId: 'infinite-canvas', components: ['text'], includeUiWorkflows: false, outPath: out, modelStrategies: {} },
      () => {}
    )
    expect(fs.existsSync(out)).toBe(true)
    const names = listZipEntries(out).map(e => e.name)
    expect(names).toContain('comfyui-pack.json')
    expect(names.some(n => n.endsWith('_api.json'))).toBe(false)
    expect(names.some(n => n.startsWith('payload/workflows/'))).toBe(false)
    expect(r.modelCount).toBe(1)
  })

  it('从当前环境导出：无 git 节点打包、模型按策略打包', async () => {
    const nodes = path.join(comfy, 'custom_nodes', 'LocalNode')
    fs.mkdirSync(nodes, { recursive: true })
    fs.writeFileSync(path.join(nodes, '__init__.py'), 'NODE_CLASS_MAPPINGS={}')
    const models = path.join(comfy, 'models', 'diffusion_models')
    fs.mkdirSync(models, { recursive: true })
    fs.writeFileSync(path.join(models, 'x.safetensors'), 'MODEL')
    const wf = path.join(comfy, 'user', 'default', 'workflows')
    fs.mkdirSync(wf, { recursive: true })
    fs.writeFileSync(path.join(wf, 'a.json'), '{"1":{"class_type":"KSampler"}}')

    const preview = await exporter.previewExport('current')
    expect(preview.components[0].nodeCount).toBe(1)
    expect(preview.models[0].filename).toBe('x.safetensors')

    const out = path.join(userData, 'current.zip')
    const r = await exporter.exportPack(
      {
        source: 'current',
        components: ['current'],
        includeUiWorkflows: false,
        outPath: out,
        modelStrategies: { 'diffusion_models/x.safetensors': 'bundle' }
      },
      () => {}
    )
    expect(r.bundledCount).toBeGreaterThanOrEqual(1)
    const names = listZipEntries(out).map(e => e.name)
    expect(names).toContain('payload/custom_nodes/LocalNode/__init__.py')
    expect(names).toContain('payload/models/current/x.safetensors')
    expect(names).toContain('payload/workflows/current/a.json')

    const dest = path.join(userData, 'unpack')
    await extractZip(out, dest)
    const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'comfyui-pack.json'), 'utf-8'))
    expect(manifest.components[0].nodes[0].source.type).toBe('bundle')
    expect(manifest.components[0].models[0].sources[0].type).toBe('bundle')
  })
})
