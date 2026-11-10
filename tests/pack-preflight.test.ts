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
  userData = mkTmpDir('pack-preflight-')
  h.userData = userData
  settings = await freshImport<SettingsModule>('../src/main/settings')
  comfy = path.join(userData, 'runtime', 'ComfyUI')
  fs.mkdirSync(comfy, { recursive: true })
  fs.writeFileSync(path.join(comfy, 'main.py'), '# fake')
  settings.saveSettings({ installPath: path.join(userData, 'runtime') })
  // venv 路径按平台解析（Windows 是 .venv\Scripts\python.exe），避免测试只在 POSIX 成立
  const venvPython = settings.paths().venvPython
  fs.mkdirSync(path.dirname(venvPython), { recursive: true })
  fs.writeFileSync(venvPython, '# fake python')
  pack = await import('../src/main/pack')
})

afterEach(() => rmTmpDir(userData))

describe('pack inspect 预检', () => {
  it('自定义小包：节点缺失、模型仅手动、工作流缺失', async () => {
    const zip = path.join(userData, 'small.zip')
    const manifest = {
      schema: 'comfyui-desk/pack@1',
      id: 'small',
      name: 'Small',
      version: '1.0.0',
      createdAt: '2026-01-01T00:00:00Z',
      nodes: [{ key: 'BundleNode', source: { type: 'bundle', path: 'payload/custom_nodes/BundleNode' } }],
      models: [{ filename: 'm.safetensors', category: 'loras', sources: [{ type: 'manual' }] }],
      workflows: [{ name: 'w', format: 'api', file: 'payload/workflows/w.json' }]
    }
    await createZip(
      [
        { name: 'comfyui-pack.json', buffer: JSON.stringify(manifest) },
        { name: 'payload/custom_nodes/BundleNode/__init__.py', buffer: '# node' },
        { name: 'payload/workflows/w.json', buffer: '{"1":{"class_type":"KSampler"}}' }
      ],
      zip
    )
    const r = await pack.inspectPack(zip)
    expect(r.env.comfyInstalled).toBe(true)
    expect(r.env.venvOk).toBe(true)
    expect(r.components.length).toBe(1)
    const node = r.items.find(i => i.kind === 'node')!
    const model = r.items.find(i => i.kind === 'model')!
    const wf = r.items.find(i => i.kind === 'workflow')!
    expect(node.status).toBe('missing')
    expect(model.status).toBe('manual')
    expect(wf.status).toBe('missing')
  })

  it('官方内置包：7 个组件、全部可导入、缺失模型计入下载量', async () => {
    const r = await pack.inspectPack('builtin:infinite-canvas')
    expect(r.components.length).toBe(7)
    const depth = r.components.find(c => c.id === 'depth')!
    expect(depth.blocked).toBe(false)
    expect(depth.nodeCount).toBe(1)
    expect(r.items.some(i => i.kind === 'node' && i.name === 'ComfyUI-ReShot')).toBe(true)
    expect(r.items.filter(i => i.kind === 'model').length).toBeGreaterThan(30)
    const total = r.components.reduce((n, c) => n + c.downloadBytes, 0)
    // 预检环境没有模型，所有模型都应计入下载量（本机清单里有 size 的条目）
    expect(total).toBeGreaterThan(0)
  })
})
