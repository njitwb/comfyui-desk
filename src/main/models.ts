import fs from 'node:fs'
import path from 'node:path'
import { paths } from './settings'
import { t } from './i18n'
import type { ModelCategory, ModelItem } from '../shared/api'

const CATEGORIES = [
  'checkpoints', 'clip', 'clip_vision', 'configs', 'controlnet', 'diffusion_models',
  'embeddings', 'loras', 'style_models', 'text_encoders', 'unet', 'upscale_models', 'vae', 'vae_approx'
]

/** 扫描模型目录（含子目录，最多两层） */
export function scanModels(): ModelCategory[] {
  const root = paths().models
  const result: ModelCategory[] = []
  if (!fs.existsSync(root)) return result
  for (const cat of CATEGORIES) {
    const dir = path.join(root, cat)
    if (!fs.existsSync(dir)) continue
    const files: ModelItem[] = []
    const walk = (d: string, depth: number): void => {
      if (depth > 2) return
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full, depth + 1)
        else {
          try {
            const st = fs.statSync(full)
            files.push({ name: e.name, relPath: full, category: cat, size: st.size, mtime: st.mtimeMs })
          } catch {
            /* ignore */
          }
        }
      }
    }
    walk(dir, 0)
    files.sort((a, b) => b.mtime - a.mtime)
    result.push({ name: cat, count: files.length, files })
  }
  return result
}

export function deleteModel(relPath: string): void {
  const root = paths().models
  if (!path.resolve(relPath).startsWith(path.resolve(root))) throw new Error(t('m.models.invalidPath'))
  fs.rmSync(relPath, { force: true })
}

export function modelCategories(): string[] {
  return CATEGORIES
}
