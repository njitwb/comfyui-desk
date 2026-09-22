import { app, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { buildAdvancedArgs, type AdvArgs } from '../shared/advArgs'
import type { Locale } from '../shared/i18n/types'
import type { Theme } from '../shared/appearance'

export type GitMirror = 'github' | 'gitcode' | 'custom'
export type PipMirror = 'default' | 'tuna' | 'aliyun' | 'ustc'
export type TorchIndex = string
export type TorchMirror = 'official' | 'aliyun'

export interface Settings {
  installPath: string
  comfyVersion: string
  pythonVersion: string
  pythonPath: string
  gitMirror: GitMirror
  customRepoUrl: string
  gitProxyPrefix: string
  pipMirror: PipMirror
  torchIndex: TorchIndex
  torchMirror: TorchMirror
  modelPath: string
  launchArgs: string
  /** 高级启动参数（结构化存储，启动时展开为命令行） */
  advArgs: AdvArgs
  port: number
  hfMirror: boolean
  /** 是否已按显存自动应用过 VRAM 模式（仅首次启动执行一次） */
  vramModeAutoApplied: boolean
  /** 是否为内嵌界面迁移过 --disable-auto-launch（一次性） */
  autoLaunchOffMigrated: boolean
  /** 界面主题；空串 = 未选择，首次启动按系统补齐 */
  theme: Theme | ''
  /** 界面语言；空串 = 未选择，首次启动按系统补齐 */
  locale: Locale | ''
  /** 是否与 ComfyUI 内置主题双向联动 */
  syncComfyTheme: boolean
}

const defaults: Settings = {
  installPath: '',
  comfyVersion: 'master',
  pythonVersion: '',
  pythonPath: '',
  gitMirror: 'gitcode',
  customRepoUrl: '',
  gitProxyPrefix: '',
  pipMirror: 'tuna',
  torchIndex: 'auto',
  torchMirror: 'aliyun',
  modelPath: '',
  // 界面已内嵌，默认不再自动打开浏览器
  launchArgs: '--disable-auto-launch --enable-manager',
  advArgs: { enableManager: true },
  port: 8188,
  hfMirror: true,
  vramModeAutoApplied: false,
  autoLaunchOffMigrated: false,
  theme: '',
  locale: '',
  syncComfyTheme: true
}

export const REPO_URLS: Record<Exclude<GitMirror, 'custom'>, string> = {
  github: 'https://github.com/comfyanonymous/ComfyUI.git',
  gitcode: 'https://gitcode.com/GitHub_Trending/co/ComfyUI'
}

export const PIP_MIRRORS: Record<PipMirror, string> = {
  default: '',
  tuna: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  aliyun: 'https://mirrors.aliyun.com/pypi/simple/',
  ustc: 'https://mirrors.ustc.edu.cn/pypi/simple'
}

/** 网络不可用时的兜底 torch 源列表 */
export const TORCH_FALLBACK = ['cu128', 'cu126', 'cu124', 'cu121', 'cpu']

let cache: Settings | null = null

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

/** 设置文件绝对路径（「关于」页展示用） */
export function settingsPath(): string {
  return settingsFile()
}

/** 迁移：高级选项已并入「额外启动参数」文本框，把 advArgs 展开后合并进去 */
function migrateAdvIntoLaunch(s: Settings): void {
  const gen = buildAdvancedArgs(s.advArgs)
  if (!gen.length) return
  const merged = s.launchArgs.split(/\s+/).filter(Boolean)
  for (let i = 0; i < gen.length; i++) {
    const t = gen[i]
    if (!t.startsWith('--')) continue
    const value = gen[i + 1] !== undefined && !gen[i + 1].startsWith('--') ? gen[i + 1] : null
    if (value !== null) i++
    if (merged.includes(t)) continue
    merged.push(t)
    if (value !== null) merged.push(value)
  }
  s.launchArgs = merged.join(' ')
}

/** 迁移：未显式选择过 auto-launch 时补上 --disable-auto-launch（配合内嵌界面），只执行一次 */
function migrateAutoLaunchOff(s: Settings): boolean {
  if (s.autoLaunchOffMigrated) return false
  const tokens = s.launchArgs.split(/\s+/).filter(Boolean)
  if (!tokens.includes('--auto-launch') && !tokens.includes('--disable-auto-launch')) {
    s.launchArgs = ['--disable-auto-launch', ...tokens].join(' ')
  }
  s.autoLaunchOffMigrated = true
  return true
}

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))
    const merged: Settings = { ...defaults, ...raw }
    migrateAdvIntoLaunch(merged)
    const persist = migrateAutoLaunchOff(merged)
    cache = merged
    if (persist) {
      try {
        fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf-8')
      } catch {
        /* 持久化失败不影响本次运行 */
      }
    }
  } catch {
    cache = { ...defaults }
  }
  return cache!
}

/** 保存设置（部分更新，未提供的字段保留当前值） */
export function saveSettings(s: Partial<Settings>): Settings {
  cache = { ...loadSettings(), ...s }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf-8')
  return cache
}

/** 首次启动：把没选择过的主题 / 语言按系统补齐并落盘 */
export function resolveAppearance(): { theme: Theme; locale: Locale } {
  const s = loadSettings()
  const patch: Partial<Settings> = {}
  if (s.theme !== 'dark' && s.theme !== 'light') patch.theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  if (s.locale !== 'zh' && s.locale !== 'en') patch.locale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const merged = Object.keys(patch).length ? saveSettings(patch) : s
  return { theme: merged.theme as Theme, locale: merged.locale as Locale }
}

export function comfyRepoUrl(s: Settings = loadSettings()): string {
  if (s.gitMirror === 'custom' && s.customRepoUrl) return s.customRepoUrl
  return REPO_URLS[s.gitMirror === 'custom' ? 'github' : s.gitMirror]
}

/** 对 GitHub 地址应用代理前缀 */
export function transformGitUrl(url: string, s: Settings = loadSettings()): string {
  if (s.gitProxyPrefix && /github\.com/i.test(url)) {
    return s.gitProxyPrefix.replace(/\/+$/, '') + '/' + url.replace(/^https?:\/\//, 'https://')
  }
  return url
}

export interface AppPaths {
  root: string
  comfy: string
  venv: string
  venvPython: string
  venvScripts: string
  customNodes: string
  models: string
  workflows: string
}

/** 默认安装目录：打包版放在 exe 旁（便携场景），开发模式放文档目录 */
export function defaultRoot(): string {
  if (app.isPackaged) return path.join(path.dirname(app.getPath('exe')), 'ComfyUI-Runtime')
  return path.join(app.getPath('documents'), 'ComfyUI-Runtime')
}

export function paths(s: Settings = loadSettings()): AppPaths {
  const root = s.installPath || defaultRoot()
  const comfy = path.join(root, 'ComfyUI')
  return {
    root,
    comfy,
    venv: path.join(root, '.venv'),
    venvPython: path.join(root, '.venv', 'Scripts', 'python.exe'),
    venvScripts: path.join(root, '.venv', 'Scripts'),
    customNodes: path.join(comfy, 'custom_nodes'),
    models: s.modelPath || path.join(comfy, 'models'),
    workflows: path.join(comfy, 'user', 'default', 'workflows')
  }
}

export function isInstalled(): boolean {
  return fs.existsSync(path.join(paths().comfy, 'main.py'))
}

/** 读取 ComfyUI 版本号（comfyui_version.py） */
export function installedVersion(): string {
  const vf = path.join(paths().comfy, 'comfyui_version.py')
  try {
    if (fs.existsSync(vf)) {
      const m = fs.readFileSync(vf, 'utf-8').match(/__version__\s*=\s*["']([^"']+)["']/)
      if (m) return m[1]
    }
  } catch {
    /* ignore */
  }
  return ''
}
