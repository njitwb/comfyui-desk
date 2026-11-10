/**
 * 整合包（ComfyUI Pack）schema 与纯函数校验。
 * 主进程负责读写 zip / 安装，渲染层负责展示；两端共用这里的类型与校验逻辑，
 * 保证预检与执行看到的是同一份清单。
 */

export const PACK_SCHEMA = 'comfyui-desk/pack@1' as const

export type PackSchema = typeof PACK_SCHEMA

/** 模型来源：按顺序尝试，前一个失败自动回退到下一个 */
export type PackModelSource =
  | { type: 'hf'; repo: string; file: string; revision?: string }
  | { type: 'ms'; repo: string; file: string; revision?: string }
  | { type: 'url'; url: string }
  /** 用现有在线搜索按文件名回校验，适合没有现成直链的模型 */
  | { type: 'search'; source: 'hf' | 'ms'; query: string }
  /** 打进 zip 的本地文件，path 相对包根 */
  | { type: 'bundle'; path: string }
  /** 云端确实找不到：预检标出目标路径，由用户手动放置 */
  | { type: 'manual' }

export interface PackNode {
  /** custom_nodes 下的目录名（同时作为去重键） */
  key: string
  name?: string
  source:
    | { type: 'git'; url: string; ref?: string; commit?: string }
    /** 打进 zip 的节点目录，path 相对包根 */
    | { type: 'bundle'; path: string }
    /** 打进 zip 的节点压缩包，解压到 custom_nodes/<key> */
    | { type: 'zip'; path: string }
  /** true = 自动执行目录内 requirements.txt；数组 = 指定 pip 包 */
  requirements?: boolean | string[]
  installPy?: boolean
  optional?: boolean
}

export interface PackModel {
  filename: string
  /** models 下的子目录，允许嵌套（如 ultralytics/segm） */
  category: string
  /** 字节数；0/缺省表示未知 */
  size?: number
  sha256?: string
  sources: PackModelSource[]
}

export interface PackWorkflow {
  name: string
  format: 'api' | 'ui'
  /** payload 内相对路径 */
  file: string
  /** 目标相对 user/default/workflows；缺省 <packId>/<componentId>/ */
  target?: string
}

export interface PackAsset {
  /** payload 内相对路径（文件或目录） */
  path: string
  /** 相对 root 的目标路径 */
  target: string
  root?: 'comfy' | 'models'
}

export interface PackPip {
  /** 直接交给 pip 的 spec，如 "sam2 @ git+https://github.com/facebookresearch/sam2" */
  spec: string
  optional?: boolean
  platforms?: Array<'win32' | 'linux' | 'darwin'>
}

export interface PackComponent {
  id: string
  name: string
  description?: string
  defaultSelected?: boolean
  dependsOn?: string[]
  /** 组件当前不可导入的原因（例如依赖的节点来源未确认） */
  blockedReason?: string
  nodes?: PackNode[]
  models?: PackModel[]
  workflows?: PackWorkflow[]
  assets?: PackAsset[]
  pip?: PackPip[]
}

export interface PackRequirements {
  comfyui?: { min?: string; recommended?: string }
  python?: { min?: string; max?: string }
  diskFreeGB?: number
  vramGB?: number
}

export interface PackManifest {
  schema: PackSchema
  id: string
  name: string
  version: string
  createdAt: string
  author?: string
  description?: string
  requirements?: PackRequirements
  components?: PackComponent[]
  /** 扁平写法：等同于一个 id=default 的组件 */
  nodes?: PackNode[]
  models?: PackModel[]
  workflows?: PackWorkflow[]
  assets?: PackAsset[]
  pip?: PackPip[]
}

/** 校验结果：errors 为空即通过；warnings 不影响执行 */
export interface PackValidation {
  errors: string[]
  warnings: string[]
}

/** 展平后的组件：扁平写法统一包装成 default 组件 */
export function effectiveComponents(m: PackManifest): PackComponent[] {
  const list = [...(m.components || [])]
  const flat = {
    nodes: m.nodes,
    models: m.models,
    workflows: m.workflows,
    assets: m.assets,
    pip: m.pip
  }
  const hasFlat = Object.values(flat).some(v => Array.isArray(v) && v.length > 0)
  if (hasFlat) {
    list.unshift({ id: 'default', name: m.name, defaultSelected: true, ...flat })
  }
  return list
}

const SAFE_SEG = /^[^\0/\\:*?"<>|]+$/

/** 相对包路径：不允许绝对路径、盘符、反斜杠与 .. */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p.trim()) return false
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return false
  if (p.includes('\\') || p.includes('\0')) return false
  const segs = p.split('/')
  return segs.every(s => s !== '' && s !== '.' && s !== '..' && SAFE_SEG.test(s))
}

/** 目标路径允许子目录（如 ultralytics/segm），但禁止穿越 */
export function isSafeTargetPath(p: unknown): p is string {
  return isSafeRelPath(p)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isRepoId(v: unknown): v is string {
  return typeof v === 'string' && /^[\w.-]+\/[\w.-]+$/.test(v)
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v)
}

/** 校验单个模型来源；返回错误文案数组 */
function validateSource(src: unknown, where: string, errors: string[]): void {
  if (!src || typeof src !== 'object') {
    errors.push(`${where}: 来源必须是对象`)
    return
  }
  const s = src as Record<string, unknown>
  const type = s.type
  switch (type) {
    case 'hf':
    case 'ms':
      if (!isRepoId(s.repo)) errors.push(`${where}: ${type} 来源的 repo 必须是 owner/name`)
      if (!isNonEmptyString(s.file)) errors.push(`${where}: ${type} 来源缺少 file`)
      if (s.revision !== undefined && !isNonEmptyString(s.revision)) errors.push(`${where}: revision 非法`)
      break
    case 'url':
      if (!isHttpUrl(s.url)) errors.push(`${where}: url 来源必须是 http(s) 地址`)
      break
    case 'search':
      if (s.source !== 'hf' && s.source !== 'ms') errors.push(`${where}: search 来源的 source 必须是 hf/ms`)
      if (!isNonEmptyString(s.query)) errors.push(`${where}: search 来源缺少 query`)
      break
    case 'bundle':
      if (!isSafeRelPath(s.path)) errors.push(`${where}: bundle 路径不安全或缺失`)
      break
    case 'manual':
      break
    default:
      errors.push(`${where}: 未知来源类型 ${String(type)}`)
  }
}

/** 校验整个 manifest（结构、路径安全、必填字段、去重） */
export function validatePackManifest(input: unknown): PackValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!input || typeof input !== 'object') return { errors: ['manifest 必须是 JSON 对象'], warnings }
  const m = input as Record<string, unknown>

  if (m.schema !== PACK_SCHEMA) {
    errors.push(`不支持的 schema：${String(m.schema)}（需要 ${PACK_SCHEMA}）`)
  }
  if (!isNonEmptyString(m.id)) errors.push('缺少 id')
  if (!isNonEmptyString(m.name)) errors.push('缺少 name')
  if (!isNonEmptyString(m.version)) errors.push('缺少 version')
  if (!isNonEmptyString(m.createdAt)) warnings.push('缺少 createdAt')

  const manifest = m as unknown as PackManifest
  const comps = effectiveComponents(manifest)
  if (!comps.length) errors.push('没有可用组件（components 或 nodes/models/workflows 至少提供一项）')

  const compIds = new Set<string>()

  for (const c of comps) {
    const cid = c.id
    if (!isNonEmptyString(cid)) {
      errors.push('组件缺少 id')
      continue
    }
    if (compIds.has(cid)) errors.push(`组件 id 重复：${cid}`)
    compIds.add(cid)
    if (!isNonEmptyString(c.name)) warnings.push(`组件 ${cid} 缺少 name`)

    for (const n of c.nodes || []) {
      const where = `组件 ${cid} 节点 ${String(n?.key)}`
      if (!isNonEmptyString(n?.key) || !SAFE_SEG.test(n.key) || n.key === '.' || n.key === '..') {
        errors.push(`${where}: key 必须是安全的目录名`)
        continue
      }
      const src = n.source as Record<string, unknown> | undefined
      if (!src || typeof src !== 'object') {
        errors.push(`${where}: 缺少 source`)
        continue
      }
      if (src.type === 'git') {
        if (!isHttpUrl(src.url) && !(typeof src.url === 'string' && src.url.startsWith('git@'))) {
          errors.push(`${where}: git 地址非法`)
        }
        if (src.commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(String(src.commit))) {
          errors.push(`${where}: commit 非法`)
        }
      } else if (src.type === 'bundle' || src.type === 'zip') {
        if (!isSafeRelPath(src.path)) errors.push(`${where}: ${src.type} 路径不安全或缺失`)
      } else {
        errors.push(`${where}: 未知节点来源类型 ${String(src.type)}`)
      }
    }

    for (const md of c.models || []) {
      const where = `组件 ${cid} 模型 ${String(md?.filename)}`
      if (!isNonEmptyString(md?.filename) || !SAFE_SEG.test(md.filename)) {
        errors.push(`${where}: filename 必须是安全的文件名`)
        continue
      }
      if (!isSafeTargetPath(md.category)) {
        errors.push(`${where}: category 路径不安全`)
      }
      if (!Array.isArray(md.sources) || !md.sources.length) {
        errors.push(`${where}: 至少需要一个来源`)
        continue
      }
      md.sources.forEach((s, i) => validateSource(s, `${where} 来源#${i + 1}`, errors))
      if (md.size !== undefined && (typeof md.size !== 'number' || md.size < 0)) errors.push(`${where}: size 非法`)
      if (md.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(String(md.sha256))) errors.push(`${where}: sha256 非法`)
      if (md.sources.every(s => s && s.type === 'manual')) warnings.push(`${where}: 仅手动来源，需要用户自行放置`)
    }

    for (const w of c.workflows || []) {
      const where = `组件 ${cid} 工作流 ${String(w?.name)}`
      if (!isNonEmptyString(w?.name)) errors.push(`${where}: 缺少 name`)
      if (w?.format !== 'api' && w?.format !== 'ui') errors.push(`${where}: format 必须是 api/ui`)
      if (!isSafeRelPath(w?.file)) errors.push(`${where}: file 路径不安全或缺失`)
      if (w?.target !== undefined && !isSafeTargetPath(w.target)) errors.push(`${where}: target 路径不安全`)
    }

    for (const a of c.assets || []) {
      const where = `组件 ${cid} 资源 ${String(a?.path)}`
      if (!isSafeRelPath(a?.path)) errors.push(`${where}: path 路径不安全或缺失`)
      if (!isSafeTargetPath(a?.target)) errors.push(`${where}: target 路径不安全或缺失`)
      if (a?.root !== undefined && a.root !== 'comfy' && a.root !== 'models') errors.push(`${where}: root 必须是 comfy/models`)
    }

    for (const p of c.pip || []) {
      if (!isNonEmptyString(p?.spec)) errors.push(`组件 ${cid} pip: spec 缺失`)
      if (p?.platforms && !Array.isArray(p.platforms)) errors.push(`组件 ${cid} pip: platforms 必须是数组`)
    }
  }

  return { errors, warnings }
}

export function isPackManifestInput(input: unknown): input is PackManifest {
  return validatePackManifest(input).errors.length === 0
}

// ---- 预检与执行状态（主进程 → 渲染层） ----

export type PackItemKind = 'node' | 'model' | 'workflow' | 'asset'

export type PackItemStatus =
  /** 已就绪，无需处理 */
  | 'ok'
  /** 缺失，执行时会安装/下载 */
  | 'missing'
  /** 已存在但不一致（大小/版本/同名不同内容） */
  | 'mismatch'
  /** 只能手动放置 */
  | 'manual'
  /** 无法判断或来源未知 */
  | 'unknown'

export interface PackItemState {
  id: string
  kind: PackItemKind
  componentId: string
  name: string
  /** 目标绝对路径（给用户复制/排查） */
  target: string
  status: PackItemStatus
  message?: string
  size?: number
  /** 来源展示文案，如 "HF Comfy-Org/z_image_turbo" */
  sourceLabel?: string
}

export interface PackComponentSummary {
  id: string
  name: string
  description?: string
  defaultSelected: boolean
  nodeCount: number
  modelCount: number
  workflowCount: number
  /** 已知模型的下载字节合计（未知大小不计入） */
  downloadBytes: number
  /** 组件内缺失模型数量 */
  missingModels: number
  /** 是否有阻断项（如未知节点来源） */
  blocked: boolean
  blockReason?: string
}

export interface PackEnvState {
  comfyInstalled: boolean
  comfyVersion: string
  /** 低于 requirements.comfyui.min */
  versionOk: boolean
  venvOk: boolean
  pythonVersion: string
  modelsRoot: string
  diskFreeBytes: number
  error?: string
}

export interface PackInspectResult {
  /** 官方内置包没有文件路径 */
  zipPath: string
  packSize: number
  manifest: PackManifest
  components: PackComponentSummary[]
  env: PackEnvState
  items: PackItemState[]
  warnings: string[]
}

export interface PackApplyRequest {
  zipPath: string
  components: string[]
  /** manual / unknown 项是否继续执行其余条目 */
  continueOnManual: boolean
}

export type PackStage = 'prepare' | 'nodes' | 'assets' | 'pip' | 'models' | 'workflows' | 'done'

export type PackProgressEvent =
  | { kind: 'stage'; stage: PackStage; message: string; percent: number }
  | { kind: 'item'; item: PackItemState; percent?: number }
  | { kind: 'log'; message: string }

export interface PackApplyResult {
  ok: boolean
  cancelled: boolean
  installed: string[]
  skipped: string[]
  failed: Array<{ name: string; error: string }>
  manual: Array<{ name: string; target: string }>
  restartRequired: boolean
  error?: string
}

export interface PackRecord {
  id: string
  name: string
  version: string
  installedAt: string
  components: string[]
  zipPath: string
}

export type PackExportSource = 'builtin' | 'current'

export type PackModelExportStrategy = 'link' | 'bundle' | 'skip'

export interface PackExportRequest {
  source: PackExportSource
  /** source=builtin 时用于选择官方包；缺省 infinite-canvas */
  builtinId?: string
  components: string[]
  /** 逐模型覆盖导出策略；未指定的按默认（有链接→link，无链接→skip） */
  modelStrategies?: Record<string, PackModelExportStrategy>
  includeUiWorkflows?: boolean
  outPath: string
}

export interface PackExportResult {
  outPath: string
  size: number
  modelCount: number
  bundledCount: number
  /** 没有云端来源、被排除的模型 */
  missingLinks: string[]
}

export interface PackExportCandidate {
  id: string
  name: string
  version: string
  description?: string
  components: PackComponentSummary[]
  models: Array<{
    filename: string
    category: string
    size: number
    /** 是否有可写入 manifest 的云端来源 */
    hasLink: boolean
    sourceLabel: string
  }>
}
