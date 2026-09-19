import fs from 'node:fs'
import path from 'node:path'
import { isInstalled, loadSettings, paths } from './settings'
import type { Theme } from '../shared/appearance'

/** ComfyUI 调色板设置键（可选值为 dark/light 或第三方配色） */
const PALETTE_KEY = 'Comfy.ColorPalette'

function comfySettingsFile(): string {
  return path.join(paths().comfy, 'user', 'default', 'comfy.settings.json')
}

/** 调色板原始值；ComfyUI 从未写过该设置时为 undefined */
function rawComfyPalette(): unknown {
  try {
    const raw = JSON.parse(fs.readFileSync(comfySettingsFile(), 'utf-8')) as Record<string, unknown>
    return raw[PALETTE_KEY]
  } catch {
    return undefined
  }
}

/** 只认标准深浅色，其它配色返回空串（视为用户自定义，不参与联动） */
function normalizeTheme(v: unknown): Theme | '' {
  return v === 'dark' || v === 'light' ? v : ''
}

function readComfyTheme(): Theme | '' {
  return normalizeTheme(rawComfyPalette())
}

/** 直接改配置文件：仅可用于 ComfyUI 未运行时 */
function writeComfyTheme(theme: Theme): void {
  const file = comfySettingsFile()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
  } catch {
    /* 文件不存在或损坏：以空对象重建 */
  }
  data[PALETTE_KEY] = theme
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 4), 'utf-8')
}

/** 经 /settings 接口写入：同步服务端内存态，避免被 ComfyUI 后续写盘覆盖 */
async function pushComfyTheme(theme: Theme): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${loadSettings().port}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [PALETTE_KEY]: theme })
    })
    return r.ok
  } catch {
    return false
  }
}

/** 启动器主题 → ComfyUI：运行中走接口，未运行则落盘待下次启动生效 */
export async function syncThemeToComfy(theme: Theme): Promise<void> {
  if (!loadSettings().syncComfyTheme) return
  if (await pushComfyTheme(theme)) return
  try {
    writeComfyTheme(theme)
  } catch {
    /* 未安装 / 无写权限：联动失效不影响启动器主题 */
  }
}

/** 启动时对齐主题：ComfyUI 已设置则采用它，未设置过则把启动器主题写过去 */
export function reconcileTheme(launcherTheme: Theme): Theme {
  if (!loadSettings().syncComfyTheme || !isInstalled()) return launcherTheme
  const raw = rawComfyPalette()
  if (raw === undefined) {
    void syncThemeToComfy(launcherTheme)
    return launcherTheme
  }
  return normalizeTheme(raw) || launcherTheme
}

/** 监听 ComfyUI 侧主题变化（在 ComfyUI 界面里改主题 → 回调） */
export function watchComfyTheme(cb: (theme: Theme) => void): void {
  const file = comfySettingsFile()
  const dir = path.dirname(file)
  const name = path.basename(file)
  if (!fs.existsSync(dir)) return
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    fs.watch(dir, (_ev, changed) => {
      if (changed && changed !== name) return
      // 去抖：ComfyUI 保存是「截断 + 写入」，会连出多个事件
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const theme = readComfyTheme()
        if (theme) cb(theme)
      }, 200)
    })
  } catch {
    /* 目录不可监听：降级为单向联动 */
  }
}
