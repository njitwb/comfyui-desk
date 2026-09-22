import fs from 'node:fs'
import path from 'node:path'
import { run, gitExe } from './util'
import { paths, isInstalled } from './settings'
import { pip, ensureVenv } from './python'
import { installTorch, installRequirements } from './installer'
import { t } from './i18n'
import type { DiagItem, ProgressEvent } from '../shared/api'

/** 包名归一化（PEP 503）：比较时忽略大小写与 - _ . 差异 */
function normName(n: string): string {
  return n.trim().toLowerCase().replace(/[-_.]+/g, '-')
}

/** 解析 requirements.txt：返回包名与 == 固定版本（跳过 -r/--index-url 等指令行、带条件标记的行与注释） */
export function parseRequirements(file: string): Array<{ name: string; version: string }> {
  const out: Array<{ name: string; version: string }> = []
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch {
    return out
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line || line.startsWith('-') || line.includes(';')) continue
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/)
    if (!m) continue
    out.push({ name: m[1], version: /^==\s*([^\s,]+)$/.exec(m[2].trim())?.[1] || '' })
  }
  return out
}

/** 已安装包名 → 版本 */
async function installedPackages(py: string): Promise<Map<string, string> | null> {
  try {
    const r = await run(py, ['-m', 'pip', 'list', '--format=json', '--disable-pip-version-check'], { timeoutMs: 60000 })
    if (r.code !== 0) return null
    const list = JSON.parse(r.out) as Array<{ name: string; version: string }>
    return new Map(list.map(x => [normName(x.name), x.version]))
  } catch {
    return null
  }
}

/** 名称列表摘要：最多列 3 个，其余折叠为 +N */
function summarize(names: string[]): string {
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
}

/**
 * 对比 requirements.txt 与实际安装情况：声明了却没装的包、以及 == 固定版本不符的包。
 * pip check 只看已装包之间的依赖关系，装都没装的包它发现不了（镜像缺新包导致安装中断就是这种情况）。
 */
async function requirementsIssues(comfyDir: string, py: string): Promise<{ missing: string[]; mismatched: string[] }> {
  const missing: string[] = []
  const mismatched: string[] = []
  const reqs = parseRequirements(path.join(comfyDir, 'requirements.txt'))
  if (!reqs.length) return { missing, mismatched }
  const installed = await installedPackages(py)
  if (!installed) return { missing, mismatched }
  for (const { name, version } of reqs) {
    const have = installed.get(normName(name))
    if (!have) missing.push(name)
    else if (version && have !== version) mismatched.push(`${name} ${version}≠${have}`)
  }
  return { missing, mismatched }
}

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

    const { missing, mismatched } = await requirementsIssues(p.comfy, p.venvPython)
    const c = await run(p.venvPython, ['-m', 'pip', 'check'], { timeoutMs: 60000 })
    const parts: string[] = []
    if (missing.length) parts.push(t('m.diag.deps.missing', { n: String(missing.length), list: summarize(missing) }))
    if (mismatched.length)
      parts.push(t('m.diag.deps.mismatch', { n: String(mismatched.length), list: summarize(mismatched) }))
    if (c.code !== 0) parts.push((c.out || c.err).trim().split('\n')[0] || t('m.diag.deps.conflict'))
    items.push({
      id: 'deps',
      name: t('m.diag.deps.name'),
      status: missing.length ? 'fail' : parts.length ? 'warn' : 'pass',
      message: parts.length ? parts.join('; ') : t('m.diag.deps.ok')
    })
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
