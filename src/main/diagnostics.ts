import fs from 'node:fs'
import path from 'node:path'
import { run, gitExe } from './util'
import { paths, isInstalled } from './settings'
import { pip, ensureVenv } from './python'
import { installTorch, installRequirements } from './installer'
import { t } from './i18n'
import type { DiagItem, ProgressEvent } from '../shared/api'

/** 一键体检：逐项检查运行环境 */
export async function runDiagnostics(): Promise<DiagItem[]> {
  const items: DiagItem[] = []
  const p = paths()

  items.push(
    isInstalled()
      ? { id: 'src', name: t('m.diag.src.name'), status: 'pass', message: p.comfy }
      : { id: 'src', name: t('m.diag.src.name'), status: 'fail', message: t('m.diag.src.missing') }
  )

  const hasVenv = fs.existsSync(p.venvPython)
  items.push(
    hasVenv
      ? { id: 'venv', name: t('m.diag.venv.name'), status: 'pass', message: p.venvPython }
      : { id: 'venv', name: t('m.diag.venv.name'), status: 'fail', message: t('m.diag.venv.missing') }
  )

  if (hasVenv) {
    const r = await run(p.venvPython, ['-m', 'pip', '--version'], { timeoutMs: 15000 })
    items.push(
      r.code === 0
        ? { id: 'pip', name: t('m.diag.pip.name'), status: 'pass', message: (r.out || '').trim() }
        : { id: 'pip', name: t('m.diag.pip.name'), status: 'fail', message: t('m.diag.pip.unavailable') }
    )

    const tr = await run(p.venvPython, ['-c', 'import torch;print(torch.__version__);print(torch.cuda.is_available())'], { timeoutMs: 60000 })
    if (tr.code === 0) {
      const lines = tr.out.trim().split(/\r?\n/)
      const cuda = lines[1] === 'True'
      items.push({
        id: 'torch',
        name: t('m.diag.torch.name'),
        status: 'pass',
        message: cuda
          ? t('m.diag.torch.passCuda', { ver: lines[0] })
          : t('m.diag.torch.passNoCuda', { ver: lines[0] })
      })
      if (!cuda) items.push({ id: 'cuda', name: t('m.diag.cuda.name'), status: 'warn', message: t('m.diag.cuda.warn') })
    } else {
      items.push({ id: 'torch', name: t('m.diag.torch.name'), status: 'fail', message: t('m.diag.torch.missing') })
    }

    const c = await run(p.venvPython, ['-m', 'pip', 'check'], { timeoutMs: 60000 })
    items.push(
      c.code === 0
        ? { id: 'deps', name: t('m.diag.deps.name'), status: 'pass', message: t('m.diag.deps.ok') }
        : { id: 'deps', name: t('m.diag.deps.name'), status: 'warn', message: (c.out || c.err).trim().split('\n')[0] || t('m.diag.deps.conflict') }
    )
  }

  try {
    const g = await run(gitExe(), ['--version'], { timeoutMs: 8000 })
    items.push(
      g.code === 0
        ? { id: 'git', name: t('m.diag.git.name'), status: 'pass', message: g.out.trim() }
        : { id: 'git', name: t('m.diag.git.name'), status: 'warn', message: t('m.diag.git.unavailable') }
    )
  } catch {
    items.push({ id: 'git', name: t('m.diag.git.name'), status: 'warn', message: t('m.diag.git.unavailable') })
  }

  return items
}

/** 环境修复：rebuild = 彻底重建虚拟环境 */
export async function repairEnv(
  mode: 'pip' | 'torch' | 'deps' | 'rebuild',
  pythonPath: string,
  torchIndex: string,
  on: (e: ProgressEvent) => void
): Promise<void> {
  const p = paths()
  if (mode === 'rebuild') {
    on({ stage: t('m.diag.stage.repair'), message: t('m.diag.repair.removeVenv'), percent: 5 })
    fs.rmSync(p.venv, { recursive: true, force: true })
    if (!pythonPath) throw new Error(t('m.diag.repair.needPython'))
    on({ stage: t('m.diag.stage.repair'), message: t('m.diag.repair.rebuildVenv'), percent: 10 })
    await ensureVenv(pythonPath, d => on({ stage: t('m.diag.stage.repair'), message: d.trim().split('\n').pop() || '', percent: 18 }))
    await installTorch(torchIndex, on, 30)
    await installRequirements(on, 70)
    on({ stage: t('m.diag.stage.done'), message: t('m.diag.repair.rebuilt'), percent: 100 })
    return
  }
  if (mode === 'pip') {
    on({ stage: t('m.diag.stage.repair'), message: t('m.diag.repair.pipStart'), percent: 20 })
    const r = await run(p.venvPython, ['-m', 'ensurepip', '--upgrade'], { timeoutMs: 120000 })
    if (r.code !== 0) throw new Error(t('m.diag.repair.pipFailed'))
    on({ stage: t('m.diag.stage.done'), message: t('m.diag.repair.pipDone'), percent: 100 })
    return
  }
  if (mode === 'torch') {
    await installTorch(torchIndex, on, 10)
    on({ stage: t('m.diag.stage.done'), message: t('m.diag.repair.torchDone'), percent: 100 })
    return
  }
  await installRequirements(on, 20)
  on({ stage: t('m.diag.stage.done'), message: t('m.diag.repair.depsDone'), percent: 100 })
}
