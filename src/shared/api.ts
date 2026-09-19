// 渲染进程与主进程共享的类型与 IPC 常量

import type { Theme } from './appearance'

export interface GpuInfo {
  name: string
  driver: string
  vendor: 'nvidia' | 'amd' | 'intel' | 'unknown'
  /** 显存（MB），0 表示未知 */
  vram: number
}

export interface PythonInfo {
  version: string
  path: string
  bundled?: boolean
}

export type ComfyStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ComfyInfo {
  installed: boolean
  version: string
  installPath: string
  port: number
  status: ComfyStatus
  torchVersion: string
  cudaAvailable: boolean | null
  gpus: GpuInfo[]
}

export interface AppInfo {
  /** 启动器版本（package.json version） */
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  settingsFile: string
  /** 日志文件目录（launcher-YYYY-MM-DD.log，保留 7 天） */
  logDir: string
  /** ComfyUI 默认安装目录（未手动选择时使用） */
  defaultInstallPath: string
}

export interface LogLine {
  ts: number
  stream: 'stdout' | 'stderr' | 'sys'
  text: string
}

export interface ProgressEvent {
  stage: string
  message: string
  percent: number
}

export interface ModelItem {
  name: string
  relPath: string
  category: string
  size: number
  mtime: number
}

export interface ModelCategory {
  name: string
  count: number
  files: ModelItem[]
}

export type DownloadStatus = 'downloading' | 'paused' | 'completed' | 'error'

export interface DownloadTask {
  id: string
  url: string
  /** models 下的类别子目录，如 text_encoders */
  category: string
  filename: string
  /** 保存后的完整路径 */
  dest: string
  received: number
  /** 未知时为 0 */
  total: number
  /** 字节/秒 */
  speed: number
  status: DownloadStatus
  error?: string
  startedAt: number
}

export interface DownloadStart {
  url: string
  category?: string
  filename?: string
  useHfMirror?: boolean
}

export interface NodeItem {
  name: string
  path: string
  git: boolean
  remote: string
}

export interface WorkflowItem {
  /** 文件名（含 .json） */
  name: string
  /** 相对工作流目录的路径（子目录则用 / 分隔） */
  relPath: string
  /** 绝对路径 */
  path: string
  size: number
  mtime: number
  /** 工作流内节点数量（无法解析为 0） */
  nodeCount: number
  /** api=可提交 /prompt；ui=ComfyUI 界面格式（不可直接提交）；unknown=无法识别 */
  format: 'api' | 'ui' | 'unknown'
}

export interface DiagItem {
  id: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
}

export interface InstallOptions {
  pythonPath: string
  version: string
  torchIndex: string
}

export interface ComfyUpdateInfo {
  current: string
  latest: string
  hasUpdate: boolean
}

export interface TorchVariant {
  /** 源标识，如 cu130 / cpu */
  index: string
  /** 匹配当前 venv Python 的最新 torch 版本，如 2.14.0+cu130；解析失败或 venv 缺失时为空 */
  torch: string
}

/** 渲染进程可调用的完整 API（由 preload 暴露到 window.api） */
export interface LauncherApi {
  // settings & system
  getSettings(): Promise<Record<string, unknown>>
  saveSettings(s: unknown): Promise<unknown>
  pickDir(): Promise<string | null>
  openPath(p: string): Promise<string>
  /** 打开资源管理器并定位（选中）该文件，不直接打开 */
  revealFile(p: string): Promise<void>
  openExternal(url: string): Promise<void>
  /** 切换启动器窗口原生全屏（工作台内嵌界面全屏时联动） */
  setFullScreen(flag: boolean): Promise<void>
  detectGpu(): Promise<GpuInfo[]>
  appInfo(): Promise<AppInfo>
  listPythons(): Promise<PythonInfo[]>
  comfyVersions(): Promise<string[]>
  torchIndexes(): Promise<string[]>
  torchVariants(): Promise<TorchVariant[]>
  modelCategories(): Promise<string[]>
  /** 与 ComfyUI 主题联动：ComfyUI 侧改了深浅色主题 → 启动器跟随切换 */
  onThemeChanged(cb: (theme: Theme) => void): () => void
  // install / lifecycle
  install(opts: InstallOptions): Promise<void>
  onInstallProgress(cb: (e: ProgressEvent) => void): () => void
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  getStatus(): Promise<ComfyStatus>
  getInfo(): Promise<ComfyInfo>
  updateComfy(version: string): Promise<void>
  useExistingInstall(dir: string): Promise<{ installPath: string; venvExists: boolean }>
  checkComfyUpdate(): Promise<ComfyUpdateInfo>
  switchTorch(index: string): Promise<void>
  onStatus(cb: (s: ComfyStatus) => void): () => void
  onLog(cb: (l: LogLine) => void): () => void
  recentLogs(): Promise<LogLine[]>
  // models
  scanModels(): Promise<ModelCategory[]>
  deleteModel(p: string): Promise<void>
  // downloads（下载管理：可暂停/继续/取消，实时进度）
  listDownloads(): Promise<DownloadTask[]>
  startDownload(o: DownloadStart): Promise<DownloadTask>
  pauseDownload(id: string): Promise<void>
  resumeDownload(id: string): Promise<void>
  cancelDownload(id: string): Promise<void>
  onDownloads(cb: (list: DownloadTask[]) => void): () => void
  /** 主进程侧接管了界面内下载（弹窗防火墙 / will-download）→ 提示并跳转模型管理 */
  onDownloadTaken(cb: (info: { filename: string }) => void): () => void
  /** webview guest 本页跳转型模型下载（location.href）→ 工作台按 DOM 上下文精确接管 */
  onNavModelDownload(cb: (info: { url: string }) => void): () => void
  /** 渲染层向启动器日志写一条诊断（sys 频道），用于排查界面拦截链路 */
  logInfo(msg: string): Promise<void>
  // nodes
  listNodes(): Promise<NodeItem[]>
  installNode(url: string): Promise<string>
  updateNode(name: string): Promise<void>
  updateAllNodes(): Promise<{ ok: string[]; failed: string[] }>
  removeNode(name: string): Promise<void>
  onNodeEvent(cb: (m: string) => void): () => void
  // workflows
  scanWorkflows(): Promise<WorkflowItem[]>
  workflowDir(): Promise<string>
  importWorkflow(): Promise<WorkflowItem | null>
  queueWorkflow(path: string): Promise<{ promptId: string; number: number }>
  deleteWorkflow(path: string): Promise<void>
  // terminal（交互式 PTY 会话；shell 自动选择 Git Bash / PowerShell）
  termOpen(cols: number, rows: number): Promise<{ id: number; shell: string }>
  termWrite(id: number, data: string): Promise<void>
  termResize(id: number, cols: number, rows: number): Promise<void>
  termKill(id: number): Promise<void>
  onTermData(cb: (e: { id: number; data: string }) => void): () => void
  onTermExit(cb: (e: { id: number; code: number }) => void): () => void
  // diagnostics
  runDiagnostics(): Promise<DiagItem[]>
  repair(mode: string, pythonPath: string, torchIndex: string): Promise<void>
}

export const IPC = {
  // settings & system
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  themeChanged: 'ev:themeChanged',
  pickDir: 'app:pickDir',
  openPath: 'app:openPath',
  revealFile: 'app:revealFile',
  openExternal: 'app:openExternal',
  winFullScreen: 'win:fullscreen',
  gpuDetect: 'sys:gpu',
  appInfo: 'app:info',
  pythonList: 'sys:pythonList',
  comfyVersions: 'sys:comfyVersions',
  torchIndexes: 'sys:torchIndexes',
  torchVariants: 'sys:torchVariants',
  // install / lifecycle
  installRun: 'comfy:install',
  installProgress: 'comfy:installProgress',
  comfyStart: 'comfy:start',
  comfyStop: 'comfy:stop',
  comfyRestart: 'comfy:restart',
  comfyUpdate: 'comfy:update',
  comfyCheckUpdate: 'comfy:checkUpdate',
  comfyUseExisting: 'comfy:useExisting',
  comfyStatus: 'comfy:status',
  comfyInfo: 'comfy:info',
  torchSwitch: 'comfy:torchSwitch',
  evStatus: 'ev:status',
  evLog: 'ev:log',
  logRecent: 'comfy:logRecent',
  // models
  modelsScan: 'models:scan',
  modelsDelete: 'models:delete',
  // downloads
  downloadsList: 'downloads:list',
  downloadsStart: 'downloads:start',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsCancel: 'downloads:cancel',
  downloadsEvent: 'ev:downloads',
  downloadTaken: 'ev:downloadTaken',
  navModelDownload: 'ev:navModelDownload',
  logInfo: 'app:logInfo',
  // nodes
  nodesList: 'nodes:list',
  nodesInstall: 'nodes:install',
  nodesUpdate: 'nodes:update',
  nodesUpdateAll: 'nodes:updateAll',
  nodesRemove: 'nodes:remove',
  nodesEvent: 'ev:nodes',
  // workflows
  workflowsScan: 'workflows:scan',
  workflowsDir: 'workflows:dir',
  workflowsImport: 'workflows:import',
  workflowsQueue: 'workflows:queue',
  workflowsDelete: 'workflows:delete',
  // terminal
  termOpen: 'term:open',
  termWrite: 'term:write',
  termResize: 'term:resize',
  termKill: 'term:kill',
  termData: 'ev:termData',
  termExit: 'ev:termExit',
  // diagnostics
  diagRun: 'diag:run',
  diagRepair: 'diag:repair'
} as const
