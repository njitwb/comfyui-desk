import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'
import { createZip } from '../src/main/pack-zip'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type SettingsModule = typeof import('../src/main/settings')
type PackModule = typeof import('../src/main/pack')

let settings: SettingsModule
let pack: PackModule
let userData: string
let comfy: string

beforeEach(async () => {
  userData = mkTmpDir('pack-apply-')
  h.userData = userData
  settings = await freshImport<SettingsModule>('../src/main/settings')
  comfy = path.join(userData, 'runtime', 'ComfyUI')
  fs.mkdirSync(comfy, { recursive: true })
  fs.writeFileSync(path.join(comfy, 'main.py'), '# fake')
  const venv = path.join(userData, 'runtime', '.venv', 'bin')
  fs.mkdirSync(venv, { recursive: true })
  fs.writeFileSync(path.join(venv, 'python'), '# fake python')
  settings.saveSettings({ installPath: path.join(userData, 'runtime') })
  pack = await import('../src/main/pack')
})

afterEach(() => rmTmpDir(userData))

describe('pack apply 执行（离线 bundle 场景）', () => {
  it('拷贝节点与模型、写入工作流并记录安装', async () => {
    const zip = path.join(userData, 'small.zip')
    const manifest = {
      schema: 'comfyui-desk/pack@1',
      id: 'small',
      name: 'Small',
      version: '1.0.0',
      createdAt: '2026-01-01T00:00:00Z',
      nodes: [{ key: 'BundleNode', source: { type: 'bundle', path: 'payload/custom_nodes/BundleNode' } }],
      models: [
        { filename: 'm.safetensors', category: 'loras', size: 5, sources: [{ type: 'bundle', path: 'payload/models/m.safetensors' }] }
      ],
      workflows: [{ name: 'w', format: 'api', file: 'payload/workflows/w.json' }]
    }
    await createZip(
      [
        { name: 'comfyui-pack.json', buffer: JSON.stringify(manifest) },
        { name: 'payload/custom_nodes/BundleNode/__init__.py', buffer: 'NODE_CLASS_MAPPINGS={}' },
        { name: 'payload/models/m.safetensors', buffer: 'MODEL' },
        { name: 'payload/workflows/w.json', buffer: '{"1":{"class_type":"KSampler"}}' }
      ],
      zip
    )

    const events: string[] = []
    const r = await pack.applyPack({ zipPath: zip, components: ['default'], continueOnManual: true }, e => {
      events.push(e.kind === 'stage' ? `stage:${e.stage}` : e.kind === 'item' ? `item:${e.item.status}` : 'log')
    })

    expect(r.cancelled).toBe(false)
    expect(r.failed).toEqual([])
    expect(r.installed).toEqual(expect.arrayContaining(['BundleNode', 'm.safetensors']))
    expect(r.restartRequired).toBe(true)
    expect(events).toContain('stage:done')

    expect(fs.existsSync(path.join(comfy, 'custom_nodes', 'BundleNode', '__init__.py'))).toBe(true)
    expect(fs.readFileSync(path.join(comfy, 'models', 'loras', 'm.safetensors'), 'utf-8')).toBe('MODEL')
    const wf = path.join(comfy, 'user', 'default', 'workflows', 'small', 'default', 'w.json')
    expect(fs.existsSync(wf)).toBe(true)

    const rec = JSON.parse(fs.readFileSync(path.join(userData, 'packs.json'), 'utf-8'))
    expect(rec[0].id).toBe('small')
  })
})
