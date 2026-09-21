import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/api'
import type { ComfyStatus, LogLine, ProgressEvent } from '../shared/api'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: import('../shared/api').LauncherApi = {
  // settings & system
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (s: unknown) => ipcRenderer.invoke(IPC.settingsSet, s),
  pickDir: () => ipcRenderer.invoke(IPC.pickDir),
  openPath: (p: string) => ipcRenderer.invoke(IPC.openPath, p),
  revealFile: (p: string) => ipcRenderer.invoke(IPC.revealFile, p),
  clipboardRead: () => ipcRenderer.invoke(IPC.clipboardRead),
  clipboardWrite: (text: string) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  setFullScreen: (flag: boolean) => ipcRenderer.invoke(IPC.winFullScreen, flag),
  detectGpu: () => ipcRenderer.invoke(IPC.gpuDetect),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  checkUpdate: () => ipcRenderer.invoke(IPC.appCheckUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC.appInstallUpdate),
  onUpdateProgress: (cb: (e: import('../shared/api').AppUpdateProgress) => void) => on(IPC.evUpdateProgress, cb),
  listPythons: () => ipcRenderer.invoke(IPC.pythonList),
  comfyVersions: () => ipcRenderer.invoke(IPC.comfyVersions),
  torchIndexes: () => ipcRenderer.invoke(IPC.torchIndexes),
  torchVariants: () => ipcRenderer.invoke(IPC.torchVariants),
  modelCategories: () => ipcRenderer.invoke('models:categories'),
  onThemeChanged: (cb: (theme: import('../shared/appearance').Theme) => void) => on(IPC.themeChanged, cb),

  // install / lifecycle
  install: (opts: unknown) => ipcRenderer.invoke(IPC.installRun, opts),
  onInstallProgress: (cb: (e: ProgressEvent) => void) => on(IPC.installProgress, cb),
  start: () => ipcRenderer.invoke(IPC.comfyStart),
  stop: () => ipcRenderer.invoke(IPC.comfyStop),
  restart: () => ipcRenderer.invoke(IPC.comfyRestart),
  getStatus: () => ipcRenderer.invoke(IPC.comfyStatus),
  getInfo: () => ipcRenderer.invoke(IPC.comfyInfo),
  updateComfy: (version: string) => ipcRenderer.invoke(IPC.comfyUpdate, version),
  checkComfyUpdate: () => ipcRenderer.invoke(IPC.comfyCheckUpdate),
  useExistingInstall: (dir: string) => ipcRenderer.invoke(IPC.comfyUseExisting, dir),
  switchTorch: (index: string) => ipcRenderer.invoke(IPC.torchSwitch, index),
  onStatus: (cb: (s: ComfyStatus) => void) => on(IPC.evStatus, cb),
  onLog: (cb: (l: LogLine) => void) => on(IPC.evLog, cb),
  recentLogs: () => ipcRenderer.invoke(IPC.logRecent),

  // models
  scanModels: () => ipcRenderer.invoke(IPC.modelsScan),
  deleteModel: (p: string) => ipcRenderer.invoke(IPC.modelsDelete, p),
  moveModel: (p: string, category: string) => ipcRenderer.invoke(IPC.modelsMove, p, category),
  searchOnlineModels: (source: import('../shared/api').ModelSource, query: string, useMirror: boolean) =>
    ipcRenderer.invoke(IPC.modelsOnlineSearch, source, query, useMirror),
  listOnlineModelFiles: (
    source: import('../shared/api').ModelSource,
    repoId: string,
    revision: string,
    useMirror: boolean
  ) => ipcRenderer.invoke(IPC.modelsOnlineFiles, source, repoId, revision, useMirror),
  // downloads
  listDownloads: () => ipcRenderer.invoke(IPC.downloadsList),
  startDownload: (o: import('../shared/api').DownloadStart) => ipcRenderer.invoke(IPC.downloadsStart, o),
  pauseDownload: (id: string) => ipcRenderer.invoke(IPC.downloadsPause, id),
  resumeDownload: (id: string) => ipcRenderer.invoke(IPC.downloadsResume, id),
  cancelDownload: (id: string) => ipcRenderer.invoke(IPC.downloadsCancel, id),
  pauseAllDownloads: () => ipcRenderer.invoke(IPC.downloadsPauseAll),
  resumeAllDownloads: () => ipcRenderer.invoke(IPC.downloadsResumeAll),
  cancelAllDownloads: () => ipcRenderer.invoke(IPC.downloadsCancelAll),
  onDownloads: (cb: (list: import('../shared/api').DownloadTask[]) => void) => on(IPC.downloadsEvent, cb),
  onDownloadTaken: (cb: (info: { filename: string }) => void) => on(IPC.downloadTaken, cb),
  onNavModelDownload: (cb: (info: { url: string }) => void) => on(IPC.navModelDownload, cb),
  logInfo: (msg: string) => ipcRenderer.invoke(IPC.logInfo, msg),

  // nodes
  listNodes: () => ipcRenderer.invoke(IPC.nodesList),
  installNode: (url: string) => ipcRenderer.invoke(IPC.nodesInstall, url),
  updateNode: (name: string) => ipcRenderer.invoke(IPC.nodesUpdate, name),
  updateAllNodes: () => ipcRenderer.invoke(IPC.nodesUpdateAll),
  removeNode: (name: string) => ipcRenderer.invoke(IPC.nodesRemove, name),
  onNodeEvent: (cb: (m: string) => void) => on(IPC.nodesEvent, cb),

  // workflows
  scanWorkflows: () => ipcRenderer.invoke(IPC.workflowsScan),
  workflowDir: () => ipcRenderer.invoke(IPC.workflowsDir),
  importWorkflow: () => ipcRenderer.invoke(IPC.workflowsImport),
  queueWorkflow: (p: string) => ipcRenderer.invoke(IPC.workflowsQueue, p),
  deleteWorkflow: (p: string) => ipcRenderer.invoke(IPC.workflowsDelete, p),

  // terminal
  termOpen: (cols: number, rows: number) => ipcRenderer.invoke(IPC.termOpen, cols, rows),
  termWrite: (id: number, data: string) => ipcRenderer.invoke(IPC.termWrite, id, data),
  termResize: (id: number, cols: number, rows: number) => ipcRenderer.invoke(IPC.termResize, id, cols, rows),
  termKill: (id: number) => ipcRenderer.invoke(IPC.termKill, id),
  onTermData: (cb: (e: { id: number; data: string }) => void) => on(IPC.termData, cb),
  onTermExit: (cb: (e: { id: number; code: number }) => void) => on(IPC.termExit, cb),

  // diagnostics
  runDiagnostics: () => ipcRenderer.invoke(IPC.diagRun),
  repair: (mode: string, pythonPath: string, torchIndex: string) =>
    ipcRenderer.invoke(IPC.diagRepair, mode, pythonPath, torchIndex)
}

contextBridge.exposeInMainWorld('api', api)
