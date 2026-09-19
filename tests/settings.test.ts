import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type SettingsModule = typeof import('../src/main/settings')

let settings: SettingsModule
let userData: string

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  settings = await freshImport<SettingsModule>('../src/main/settings')
})

afterEach(() => {
  rmTmpDir(userData)
})

describe('loadSettings', () => {
  it('设置文件不存在时返回默认值', () => {
    const s = settings.loadSettings()
    expect(s.port).toBe(8188)
    expect(s.gitMirror).toBe('gitcode')
    expect(s.pipMirror).toBe('tuna')
    expect(s.hfMirror).toBe(true)
    expect(s.launchArgs).toContain('--disable-auto-launch')
    expect(s.advArgs).toEqual({ enableManager: true })
  })

  it('磁盘上的部分设置与默认值合并', () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ port: 9000, gitMirror: 'github', autoLaunchOffMigrated: true }),
      'utf-8'
    )
    const s = settings.loadSettings()
    expect(s.port).toBe(9000)
    expect(s.gitMirror).toBe('github')
    expect(s.pipMirror).toBe('tuna') // 默认补齐
  })

  it('损坏的 JSON 回退默认值', () => {
    fs.writeFileSync(path.join(userData, 'settings.json'), '{broken', 'utf-8')
    expect(settings.loadSettings().port).toBe(8188)
  })

  it('一次性迁移：老设置自动补 --disable-auto-launch 并落盘', () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ launchArgs: '--fast', autoLaunchOffMigrated: false }),
      'utf-8'
    )
    const s = settings.loadSettings()
    expect(s.launchArgs.split(/\s+/)).toContain('--disable-auto-launch')
    expect(s.launchArgs.split(/\s+/)).toContain('--fast')
    expect(s.autoLaunchOffMigrated).toBe(true)
    // 已写回磁盘，二次加载不会重复加
    const persisted = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf-8'))
    expect(persisted.autoLaunchOffMigrated).toBe(true)
  })

  it('一次性迁移：已显式设置 auto-launch 时不改写', () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ launchArgs: '--auto-launch', autoLaunchOffMigrated: false }),
      'utf-8'
    )
    const s = settings.loadSettings()
    const tokens = s.launchArgs.split(/\s+/)
    expect(tokens).toContain('--auto-launch')
    expect(tokens).not.toContain('--disable-auto-launch')
    expect(s.autoLaunchOffMigrated).toBe(true)
  })

  it('遗留 advArgs 迁移并入 launchArgs', () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ launchArgs: '--fast', advArgs: { listen: true, vramMode: 'lowvram' } }),
      'utf-8'
    )
    const s = settings.loadSettings()
    const tokens = s.launchArgs.split(/\s+/)
    expect(tokens).toContain('--fast')
    expect(tokens).toContain('--listen')
    expect(tokens).toContain('--lowvram')
  })

  it('advArgs 生成的参数与已有文本不重复合并', () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ launchArgs: '--listen', advArgs: { listen: true } }),
      'utf-8'
    )
    const s = settings.loadSettings()
    expect(s.launchArgs.split(/\s+/).filter(t => t === '--listen')).toHaveLength(1)
  })
})

describe('saveSettings', () => {
  it('部分更新合并并写盘', () => {
    settings.saveSettings({ port: 8888 })
    const s = settings.saveSettings({ comfyVersion: 'v0.3.60' })
    expect(s.port).toBe(8888)
    expect(s.comfyVersion).toBe('v0.3.60')
    const onDisk = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf-8'))
    expect(onDisk.port).toBe(8888)
    expect(onDisk.comfyVersion).toBe('v0.3.60')
  })
})

describe('comfyRepoUrl', () => {
  it('github/gitcode 镜像地址', () => {
    expect(settings.comfyRepoUrl({ ...settings.loadSettings(), gitMirror: 'github' })).toBe(
      'https://github.com/comfyanonymous/ComfyUI.git'
    )
    expect(settings.comfyRepoUrl({ ...settings.loadSettings(), gitMirror: 'gitcode' })).toContain('gitcode.com')
  })

  it('custom 使用自定义地址，缺省回退 github', () => {
    const base = settings.loadSettings()
    expect(settings.comfyRepoUrl({ ...base, gitMirror: 'custom', customRepoUrl: 'https://example.com/x.git' })).toBe(
      'https://example.com/x.git'
    )
    expect(settings.comfyRepoUrl({ ...base, gitMirror: 'custom', customRepoUrl: '' })).toContain('github.com')
  })
})

describe('transformGitUrl', () => {
  it('非 github 地址不变', () => {
    const s = { ...settings.loadSettings(), gitProxyPrefix: 'https://ghproxy.com' }
    expect(settings.transformGitUrl('https://gitcode.com/a/b', s)).toBe('https://gitcode.com/a/b')
  })

  it('github 地址加代理前缀（多余斜杠处理）', () => {
    const s = { ...settings.loadSettings(), gitProxyPrefix: 'https://ghproxy.com/' }
    expect(settings.transformGitUrl('https://github.com/a/b.git', s)).toBe(
      'https://ghproxy.com/https://github.com/a/b.git'
    )
  })

  it('空前缀不变换', () => {
    const s = { ...settings.loadSettings(), gitProxyPrefix: '' }
    expect(settings.transformGitUrl('https://github.com/a/b.git', s)).toBe('https://github.com/a/b.git')
  })
})

describe('paths', () => {
  it('按 installPath 推导目录结构', () => {
    const root = path.join(userData, 'runtime')
    const p = settings.paths({ ...settings.loadSettings(), installPath: root, modelPath: '' })
    expect(p.root).toBe(root)
    expect(p.comfy).toBe(path.join(root, 'ComfyUI'))
    expect(p.venvPython).toBe(path.join(root, '.venv', 'Scripts', 'python.exe'))
    expect(p.customNodes).toBe(path.join(root, 'ComfyUI', 'custom_nodes'))
    expect(p.models).toBe(path.join(root, 'ComfyUI', 'models'))
    expect(p.workflows).toBe(path.join(root, 'ComfyUI', 'user', 'default', 'workflows'))
  })

  it('modelPath 覆盖默认模型目录', () => {
    const root = path.join(userData, 'runtime')
    const mp = path.join(userData, 'my-models')
    const p = settings.paths({ ...settings.loadSettings(), installPath: root, modelPath: mp })
    expect(p.models).toBe(mp)
  })

  it('未设置 installPath 时走默认目录（documents/ComfyUI-Runtime）', () => {
    const p = settings.paths({ ...settings.loadSettings(), installPath: '', modelPath: '' })
    expect(p.root).toBe(path.join(userData, 'documents', 'ComfyUI-Runtime'))
  })
})

describe('isInstalled / installedVersion', () => {
  it('main.py 存在视为已安装', () => {
    const root = path.join(userData, 'runtime')
    expect(settings.isInstalled()).toBe(false)
    fs.mkdirSync(path.join(root, 'ComfyUI'), { recursive: true })
    settings.saveSettings({ installPath: root })
    expect(settings.isInstalled()).toBe(false)
    fs.writeFileSync(path.join(root, 'ComfyUI', 'main.py'), '# main')
    expect(settings.isInstalled()).toBe(true)
  })

  it('从 comfyui_version.py 解析版本号', () => {
    const root = path.join(userData, 'runtime')
    fs.mkdirSync(path.join(root, 'ComfyUI'), { recursive: true })
    settings.saveSettings({ installPath: root })
    expect(settings.installedVersion()).toBe('')
    fs.writeFileSync(path.join(root, 'ComfyUI', 'comfyui_version.py'), '__version__ = "0.3.60"\n')
    expect(settings.installedVersion()).toBe('0.3.60')
  })
})
