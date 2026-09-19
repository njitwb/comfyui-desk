import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({ userData: '', openResult: { canceled: true, filePaths: [] as string[] } }))
vi.mock('electron', () =>
  electronMockFactory(() => h.userData, {
    dialog: { showOpenDialog: async () => h.openResult }
  })
)

type SettingsModule = typeof import('../src/main/settings')
type WorkflowsModule = typeof import('../src/main/workflows')
type ProcessModule = typeof import('../src/main/process')

let settings: SettingsModule
let workflows: WorkflowsModule
let comfy: ProcessModule['comfy']
let userData: string
let wfRoot: string

const API_WF = JSON.stringify({ n1: { class_type: 'KSampler', inputs: {} }, n2: { class_type: 'CLIPTextEncode', inputs: {} } })
const UI_WF = JSON.stringify({ nodes: [{ id: 1 }, { id: 2 }, { id: 3 }], links: [] })
const WRAPPED_API = JSON.stringify({ prompt: { a: { class_type: 'SaveImage' } } })

const writeWf = (rel: string, content: string, mtime = 1000) => {
  const p = path.join(wfRoot, ...rel.split('/'))
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  fs.utimesSync(p, mtime / 1000, mtime / 1000)
  return p
}

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  h.openResult = { canceled: true, filePaths: [] }
  settings = await freshImport<SettingsModule>('../src/main/settings')
  const root = path.join(userData, 'runtime')
  settings.saveSettings({ installPath: root, port: 8188 })
  wfRoot = settings.paths().workflows
  workflows = await import('../src/main/workflows')
  comfy = (await import('../src/main/process')).comfy
})

afterEach(() => {
  comfy.status = 'stopped'
  vi.unstubAllGlobals()
  rmTmpDir(userData)
})

describe('scanWorkflows', () => {
  it('目录不存在返回空', () => {
    expect(workflows.scanWorkflows()).toEqual([])
  })

  it('识别 api / ui / unknown 格式并统计节点数', () => {
    writeWf('api.json', API_WF, 1000)
    writeWf('ui.json', UI_WF, 2000)
    writeWf('broken.json', 'not json', 3000)
    writeWf('notes.txt', 'ignored', 4000)

    const list = workflows.scanWorkflows()
    expect(list).toHaveLength(3)
    const byName = Object.fromEntries(list.map(w => [w.name, w]))
    expect(byName['api.json'].format).toBe('api')
    expect(byName['api.json'].nodeCount).toBe(2)
    expect(byName['ui.json'].format).toBe('ui')
    expect(byName['ui.json'].nodeCount).toBe(3)
    expect(byName['broken.json'].format).toBe('unknown')
    expect(byName['broken.json'].nodeCount).toBe(0)
  })

  it('包裹一层 prompt 的导出也识别为 api', () => {
    writeWf('wrapped.json', WRAPPED_API)
    const w = workflows.scanWorkflows()[0]
    expect(w.format).toBe('api')
    expect(w.nodeCount).toBe(1)
  })

  it('按 mtime 倒序、relPath 用 / 分隔、忽略隐藏文件', () => {
    writeWf('old.json', API_WF, 1000)
    writeWf('sub/new.json', API_WF, 5000)
    writeWf('.hidden.json', API_WF, 9000)
    const list = workflows.scanWorkflows()
    expect(list.map(w => w.relPath)).toEqual(['sub/new.json', 'old.json'])
  })

  it('递归到三层子目录', () => {
    writeWf('a/b/c/deep.json', API_WF)
    expect(workflows.scanWorkflows().map(w => w.relPath)).toEqual(['a/b/c/deep.json'])
  })
})

describe('deleteWorkflow', () => {
  it('删除工作流目录内文件', () => {
    const p = writeWf('x.json', API_WF)
    workflows.deleteWorkflow(p)
    expect(fs.existsSync(p)).toBe(false)
  })

  it('拒绝目录外路径', () => {
    const outside = path.join(userData, 'out.json')
    fs.writeFileSync(outside, API_WF)
    expect(() => workflows.deleteWorkflow(outside)).toThrow('非法路径')
    expect(fs.existsSync(outside)).toBe(true)
  })
})

describe('importWorkflow', () => {
  it('用户取消返回 null', async () => {
    expect(await workflows.importWorkflow()).toBeNull()
  })

  it('复制选中文件到工作流目录', async () => {
    const src = path.join(userData, 'pick.json')
    fs.writeFileSync(src, API_WF)
    h.openResult = { canceled: false, filePaths: [src] }
    const item = await workflows.importWorkflow()
    expect(item).not.toBeNull()
    expect(item!.name).toBe('pick.json')
    expect(fs.existsSync(path.join(wfRoot, 'pick.json'))).toBe(true)
    expect(item!.format).toBe('api')
  })

  it('重名自动追加序号', async () => {
    writeWf('pick.json', API_WF)
    const src = path.join(userData, 'pick.json')
    fs.writeFileSync(src, API_WF)
    h.openResult = { canceled: false, filePaths: [src] }
    const item = await workflows.importWorkflow()
    expect(item!.name).toBe('pick_1.json')
  })
})

describe('queueWorkflow', () => {
  const mockFetchOk = () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ prompt_id: 'pid-1', number: 7 })
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('ComfyUI 未运行时拒绝提交', async () => {
    const p = writeWf('api.json', API_WF)
    await expect(workflows.queueWorkflow(p)).rejects.toThrow('未运行')
  })

  it('api 格式提交到 /prompt 并返回 promptId', async () => {
    comfy.status = 'running'
    const fetchMock = mockFetchOk()
    const p = writeWf('api.json', API_WF)
    const r = await workflows.queueWorkflow(p)
    expect(r).toEqual({ promptId: 'pid-1', number: 7 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://127.0.0.1:8188/prompt')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.prompt.n1.class_type).toBe('KSampler')
  })

  it('包裹 prompt 的导出解包后提交', async () => {
    comfy.status = 'running'
    const fetchMock = mockFetchOk()
    const p = writeWf('wrapped.json', WRAPPED_API)
    await workflows.queueWorkflow(p)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt.a.class_type).toBe('SaveImage')
  })

  it('ui 格式明确报错', async () => {
    comfy.status = 'running'
    mockFetchOk()
    const p = writeWf('ui.json', UI_WF)
    await expect(workflows.queueWorkflow(p)).rejects.toThrow('界面格式')
  })

  it('非法 JSON 报错', async () => {
    comfy.status = 'running'
    const p = writeWf('bad.json', 'not json')
    await expect(workflows.queueWorkflow(p)).rejects.toThrow('合法 JSON')
  })

  it('HTTP 错误带出状态码', async () => {
    comfy.status = 'running'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'server boom' }))
    )
    const p = writeWf('api.json', API_WF)
    await expect(workflows.queueWorkflow(p)).rejects.toThrow('HTTP 500')
  })

  it('拒绝目录外路径', async () => {
    comfy.status = 'running'
    const outside = path.join(userData, 'out.json')
    fs.writeFileSync(outside, API_WF)
    await expect(workflows.queueWorkflow(outside)).rejects.toThrow('非法路径')
  })
})
