import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type SettingsModule = typeof import('../src/main/settings')
type ModelsModule = typeof import('../src/main/models')

let settings: SettingsModule
let models: ModelsModule
let userData: string
let modelsRoot: string

const setMtime = (p: string, t: number) => fs.utimesSync(p, t / 1000, t / 1000)
const touch = (p: string, mtime: number) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, 'x')
  setMtime(p, mtime)
}

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  modelsRoot = path.join(userData, 'models')
  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ modelPath: modelsRoot, installPath: path.join(userData, 'runtime') })
  models = await import('../src/main/models')
})

afterEach(() => rmTmpDir(userData))

describe('modelCategories', () => {
  it('返回全部内置类别', () => {
    const cats = models.modelCategories()
    expect(cats).toContain('checkpoints')
    expect(cats).toContain('loras')
    expect(cats).toContain('diffusion_models')
    expect(cats.length).toBeGreaterThan(10)
  })
})

describe('scanModels', () => {
  it('目录不存在返回空数组', () => {
    expect(models.scanModels()).toEqual([])
  })

  it('扫描已知类别、按修改时间倒序', () => {
    touch(path.join(modelsRoot, 'checkpoints', 'old.safetensors'), 1000)
    touch(path.join(modelsRoot, 'checkpoints', 'new.safetensors'), 3000)
    touch(path.join(modelsRoot, 'checkpoints', 'mid.safetensors'), 2000)
    touch(path.join(modelsRoot, 'loras', 'a.safetensors'), 500)

    const result = models.scanModels()
    const ckpt = result.find(c => c.name === 'checkpoints')!
    expect(ckpt.count).toBe(3)
    expect(ckpt.files.map(f => f.name)).toEqual(['new.safetensors', 'mid.safetensors', 'old.safetensors'])
    expect(ckpt.files[0].size).toBe(1)
    expect(ckpt.files[0].category).toBe('checkpoints')

    const loras = result.find(c => c.name === 'loras')!
    expect(loras.count).toBe(1)

    // 结果只包含已知类别
    expect(result.every(c => models.modelCategories().includes(c.name))).toBe(true)
  })

  it('递归两层子目录，忽略隐藏文件与第 3 层', () => {
    touch(path.join(modelsRoot, 'vae', 'sub1', 'a.safetensors'), 1000)
    touch(path.join(modelsRoot, 'vae', 'sub1', 'sub2', 'b.safetensors'), 2000)
    touch(path.join(modelsRoot, 'vae', 'sub1', 'sub2', 'sub3', 'c.safetensors'), 3000)
    touch(path.join(modelsRoot, 'vae', '.hidden.safetensors'), 4000)

    const vae = models.scanModels().find(c => c.name === 'vae')!
    expect(vae.files.map(f => f.name).sort()).toEqual(['a.safetensors', 'b.safetensors'])
  })

  it('未知类别目录不出现在结果中', () => {
    touch(path.join(modelsRoot, 'not-a-category', 'x.bin'), 1000)
    expect(models.scanModels()).toEqual([])
  })
})

describe('deleteModel', () => {
  it('删除模型目录内文件', () => {
    const f = path.join(modelsRoot, 'loras', 'a.safetensors')
    touch(f, 1000)
    models.deleteModel(f)
    expect(fs.existsSync(f)).toBe(false)
  })

  it('拒绝模型目录外的路径', () => {
    const outside = path.join(userData, 'elsewhere', 'x.safetensors')
    touch(outside, 1000)
    expect(() => models.deleteModel(outside)).toThrow('非法路径')
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('不存在的文件不强报错（force 删除）', () => {
    expect(() => models.deleteModel(path.join(modelsRoot, 'loras', 'ghost.safetensors'))).not.toThrow()
  })
})
