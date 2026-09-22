import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({
  userData: '',
  runMock: vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<{ code: number; out: string; err: string }>>()
}))
vi.mock('electron', () => electronMockFactory(() => h.userData))
vi.mock('../src/main/util', async importOriginal => {
  const m = await importOriginal<typeof import('../src/main/util')>()
  return { ...m, run: h.runMock, gitExe: () => 'git' }
})

type SettingsModule = typeof import('../src/main/settings')
type DiagModule = typeof import('../src/main/diagnostics')

let settings: SettingsModule
let diag: DiagModule
let userData: string

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  h.runMock.mockReset()
  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ installPath: path.join(userData, 'runtime') })
  diag = await import('../src/main/diagnostics')
})

afterEach(() => rmTmpDir(userData))

const fakeComfy = () => {
  const p = settings.paths()
  fs.mkdirSync(p.comfy, { recursive: true })
  fs.writeFileSync(path.join(p.comfy, 'main.py'), '# comfy')
}

const fakeVenv = () => {
  const p = settings.paths()
  fs.mkdirSync(p.venvScripts, { recursive: true })
  fs.writeFileSync(p.venvPython, '')
}

describe('runDiagnostics', () => {
  it('全新环境：源码与 venv 均 fail，git 可用则 pass', async () => {
    h.runMock.mockResolvedValue({ code: 0, out: 'git version 2.45.0.windows.1', err: '' })
    const items = await diag.runDiagnostics()
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    expect(byId.src.status).toBe('fail')
    expect(byId.venv.status).toBe('fail')
    expect(byId.git.status).toBe('pass')
    // venv 缺失时跳过 pip/torch/deps 检查
    expect(byId.pip).toBeUndefined()
    expect(byId.torch).toBeUndefined()
  })

  it('完整环境：全部 pass', async () => {
    fakeComfy()
    fakeVenv()
    h.runMock.mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ')
      if (joined.includes('pip --version')) return { code: 0, out: 'pip 24.2 from /x\n', err: '' }
      if (joined.includes('import torch')) return { code: 0, out: '2.4.1+cu124\nTrue\n', err: '' }
      if (joined.includes('pip check')) return { code: 0, out: 'No broken requirements found.\n', err: '' }
      if (joined.includes('--version')) return { code: 0, out: 'git version 2.45.0', err: '' }
      return { code: 0, out: '', err: '' }
    })
    const items = await diag.runDiagnostics()
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    expect(byId.src.status).toBe('pass')
    expect(byId.venv.status).toBe('pass')
    expect(byId.pip.status).toBe('pass')
    expect(byId.pip.message).toContain('pip 24.2')
    expect(byId.torch.status).toBe('pass')
    expect(byId.torch.message).toContain('2.4.1+cu124')
    expect(byId.torch.message).toContain('CUDA 可用')
    expect(byId.deps.status).toBe('pass')
    expect(byId.cuda).toBeUndefined() // CUDA 可用时无 warn 项
  })

  it('CUDA 不可用时给出 cuda warn', async () => {
    fakeComfy()
    fakeVenv()
    h.runMock.mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ')
      if (joined.includes('pip --version')) return { code: 0, out: 'pip 24.2', err: '' }
      if (joined.includes('import torch')) return { code: 0, out: '2.4.1+cpu\nFalse\n', err: '' }
      if (joined.includes('pip check')) return { code: 0, out: '', err: '' }
      return { code: 0, out: '', err: '' }
    })
    const items = await diag.runDiagnostics()
    const cuda = items.find(i => i.id === 'cuda')!
    expect(cuda.status).toBe('warn')
    expect(cuda.message).toContain('CUDA 不可用')
  })

  it('torch 未安装时报 fail', async () => {
    fakeComfy()
    fakeVenv()
    h.runMock.mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ')
      if (joined.includes('pip --version')) return { code: 0, out: 'pip 24.2', err: '' }
      if (joined.includes('import torch')) return { code: 1, out: '', err: 'ModuleNotFoundError: No module named torch' }
      if (joined.includes('pip check')) return { code: 0, out: '', err: '' }
      return { code: 0, out: '', err: '' }
    })
    const items = await diag.runDiagnostics()
    const torch = items.find(i => i.id === 'torch')!
    expect(torch.status).toBe('fail')
  })

  it('pip 不可用时报 fail', async () => {
    fakeComfy()
    fakeVenv()
    h.runMock.mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ')
      if (joined.includes('pip --version')) return { code: 1, out: '', err: 'no pip' }
      if (joined.includes('import torch')) return { code: 0, out: '2.4.1\nTrue\n', err: '' }
      if (joined.includes('pip check')) return { code: 1, out: 'conflict here\nmore', err: '' }
      return { code: 0, out: '', err: '' }
    })
    const items = await diag.runDiagnostics()
    const byId = Object.fromEntries(items.map(i => [i.id, i]))
    expect(byId.pip.status).toBe('fail')
    expect(byId.deps.status).toBe('warn')
  })

  it('git 命令失败时给 warn 而非中断', async () => {
    h.runMock.mockRejectedValue(new Error('spawn fail'))
    const items = await diag.runDiagnostics()
    expect(items.find(i => i.id === 'git')!.status).toBe('warn')
  })

  it('requirements.txt 里的包没装（如镜像缺包导致安装中断）时报 fail', async () => {
    fakeComfy()
    fakeVenv()
    fs.writeFileSync(
      path.join(settings.paths().comfy, 'requirements.txt'),
      ['comfyui-frontend-package==1.52.7', 'comfyui-workflow-templates==0.11.60', 'einops', 'torch'].join('\n')
    )
    h.runMock.mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ')
      if (joined.includes('pip --version')) return { code: 0, out: 'pip 24.2', err: '' }
      if (joined.includes('import torch')) return { code: 0, out: '2.4.1\nTrue\n', err: '' }
      if (joined.includes('pip list'))
        return {
          code: 0,
          out: JSON.stringify([{ name: 'comfyui-frontend-package', version: '1.52.7' }, { name: 'torch', version: '2.4.1' }]),
          err: ''
        }
      // 镜像缺包时 pip check 依然报“无冲突”，正是此前漏诊的原因
      if (joined.includes('pip check')) return { code: 0, out: 'No broken requirements found.\n', err: '' }
      return { code: 0, out: '', err: '' }
    })
    const items = await diag.runDiagnostics()
    const deps = items.find(i => i.id === 'deps')!
    expect(deps.status).toBe('fail')
    expect(deps.message).toContain('comfyui-workflow-templates')
    expect(deps.message).toContain('einops')
  })

  it('== 固定版本与已装版本不符时给 warn', async () => {
    fakeComfy()
    fakeVenv()
    fs.writeFileSync(path.join(settings.paths().comfy, 'requirements.txt'), 'comfyui-workflow-templates==0.11.60\n')
    h.runMock.mockImplementation(async (_cmd, args) => {
      const joined = args.join(' ')
      if (joined.includes('pip --version')) return { code: 0, out: 'pip 24.2', err: '' }
      if (joined.includes('import torch')) return { code: 0, out: '2.4.1\nTrue\n', err: '' }
      if (joined.includes('pip list'))
        return { code: 0, out: JSON.stringify([{ name: 'ComfyUI_Workflow.Templates', version: '0.11.59' }]), err: '' }
      if (joined.includes('pip check')) return { code: 0, out: '', err: '' }
      return { code: 0, out: '', err: '' }
    })
    const deps = (await diag.runDiagnostics()).find(i => i.id === 'deps')!
    expect(deps.status).toBe('warn')
    expect(deps.message).toContain('0.11.60≠0.11.59')
  })

  it('requirements.txt 解析：跳过指令行/条件行/注释，忽略 specifier', () => {
    const f = path.join(userData, 'req.txt')
    fs.writeFileSync(
      f,
      [
        '# 注释',
        '--extra-index-url https://example.com/simple',
        '-r other.txt',
        'numpy>=1.25.0',
        'comfyui-frontend-package==1.52.7  # 行尾注释',
        'pywin32; sys_platform == "win32"',
        'Pillow[extra]==10.0.0'
      ].join('\n')
    )
    expect(diag.parseRequirements(f)).toEqual([
      { name: 'numpy', version: '' },
      { name: 'comfyui-frontend-package', version: '1.52.7' },
      { name: 'Pillow', version: '10.0.0' }
    ])
  })
})

describe('repairEnv', () => {
  it('pip 修复执行 ensurepip 并报告进度', async () => {
    fakeVenv()
    h.runMock.mockResolvedValue({ code: 0, out: '', err: '' })
    const events: Array<{ message: string; percent: number }> = []
    await diag.repairEnv('pip', 'py', 'cpu', e => events.push({ message: e.message, percent: e.percent }))
    expect(h.runMock.mock.calls.some(c => (c[1] as string[]).includes('ensurepip'))).toBe(true)
    expect(events[events.length - 1].percent).toBe(100)
  })

  it('ensurepip 失败抛错', async () => {
    fakeVenv()
    h.runMock.mockResolvedValue({ code: 1, out: '', err: 'boom' })
    await expect(diag.repairEnv('pip', 'py', 'cpu', () => {})).rejects.toThrow('pip 修复失败')
  })

  it('rebuild 模式未提供 python 路径时报错', async () => {
    await expect(diag.repairEnv('rebuild', '', 'cpu', () => {})).rejects.toThrow('Python 路径')
  })
})
