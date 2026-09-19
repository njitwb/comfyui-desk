import { ipcMain, dialog, shell, BrowserWindow, app, session, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/api'
import type { GpuInfo, InstallOptions, ProgressEvent } from '../shared/api'
import { loadSettings, saveSettings, paths, isInstalled, installedVersion, settingsPath, Settings, defaultRoot } from './settings'
import { setMainLocale, t } from './i18n'
import { detectGpu } from './gpu'
import { listPythons } from './python'
import { comfy } from './process'
import { syncThemeToComfy, watchComfyTheme } from './comfy-theme'
import { installComfyUI, updateComfyUI, listComfyVersions, listTorchIndexes, listTorchVariants, installTorch, checkComfyUpdate } from './installer'
import { scanModels, deleteModel, modelCategories } from './models'
import { initDownloads, listDownloads, startDownload, pauseDownload, resumeDownload, cancelDownload, inferCategory } from './downloads'
import { listNodes, installNode, updateNode, updateAllNodes, removeNode } from './nodes'
import { scanWorkflows, workflowDir, importWorkflow, queueWorkflow, deleteWorkflow } from './workflows'
import { terminal } from './terminal'
import { runDiagnostics, repairEnv } from './diagnostics'
import { run } from './util'
import { logDir } from './logger'

function send(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, ...args)
}

/** 主进程侧代理事件（如弹窗防火墙接管下载）→ 广播给渲染层统一提示 */
export function broadcastRenderer(channel: string, ...args: unknown[]): void {
  send(channel, ...args)
}

/** 文本流 → 统一日志：按行切分，去抖（去数字后连续重复只记一条，防下载进度刷屏） */
function makeStreamLogger(tag: string, passthrough?: (m: string) => void): (m: string) => void {
  let buf = ''
  let lastKey = ''
  return (m: string) => {
    passthrough?.(m)
    buf += m
    const parts = buf.split(/[\r\n]+/)
    buf = parts.pop() || ''
    for (const ln of parts) {
      const text = ln.trim()
      if (!text) continue
      const key = text.replace(/\d+(\.\d+)?/g, '')
      if (key === lastKey) continue
      lastKey = key
      comfy.pushLog('sys', t('m.ipc.streamLine', { tag, text }))
    }
  }
}

/** 安装/更新/修复等进度事件：透传渲染层并记入日志（100ms 合并，防止高频 IPC 刷屏卡界面） */
function progressLogger(tag: string): (ev: ProgressEvent) => void {
  const log = makeStreamLogger(tag)
  let pending: ProgressEvent | null = null
  let timer: NodeJS.Timeout | null = null
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const ev = pending
    pending = null
    send(IPC.installProgress, ev)
    log(`${ev.stage} · ${ev.message}\n`)
  }
  return (ev: ProgressEvent) => {
    pending = ev
    if (ev.percent >= 100) flush()
    else if (!timer) timer = setTimeout(flush, 100)
  }
}

/** torch / CUDA / 显卡探测缓存：状态切换与页面刷新会频繁拉取，避免反复启动 Python 与 PowerShell */
interface ProbeResult {
  at: number
  torchVersion: string
  cudaAvailable: boolean | null
  gpus: GpuInfo[]
}
let probe: ProbeResult | null = null
const PROBE_TTL = 30000

async function probeEnv(): Promise<ProbeResult> {
  if (probe && Date.now() - probe.at < PROBE_TTL) return probe
  const p = paths()
  let torchVersion = ''
  let cudaAvailable: boolean | null = null
  if (fs.existsSync(p.venvPython)) {
    const r = await run(p.venvPython, ['-c', 'import torch;print(torch.__version__);print(torch.cuda.is_available())'], { timeoutMs: 60000 })
    if (r.code === 0) {
      const lines = r.out.trim().split(/\r?\n/)
      torchVersion = lines[0] || ''
      cudaAvailable = lines[1] === 'True'
    }
  }
  probe = { at: Date.now(), torchVersion, cudaAvailable, gpus: await detectGpu() }
  return probe
}

export function registerIpc(): void {
  // ---- settings & system ----
  ipcMain.handle(IPC.settingsGet, () => loadSettings())
  ipcMain.handle(IPC.settingsSet, (_e, s: Partial<Settings>) => {
    const saved = saveSettings(s)
    const themed = s.theme === 'dark' || s.theme === 'light'
    // 主题/语言变化立即生效：原生 UI 配色、主进程取词（日志/进度文案）随之切换
    if (themed) nativeTheme.themeSource = s.theme as 'dark' | 'light'
    if (s.locale === 'zh' || s.locale === 'en') setMainLocale(s.locale)
    // 主题联动：主题变化、或刚打开联动开关时，把启动器主题同步给 ComfyUI
    if ((themed || s.syncComfyTheme === true) && saved.syncComfyTheme && saved.theme) {
      void syncThemeToComfy(saved.theme)
    }
    return saved
  })
  // 反向联动：在 ComfyUI 界面里改主题 → 跟随切换启动器
  watchComfyTheme(theme => {
    if (!loadSettings().syncComfyTheme || loadSettings().theme === theme) return
    saveSettings({ theme })
    nativeTheme.themeSource = theme
    send(IPC.themeChanged, theme)
  })
  ipcMain.handle(IPC.pickDir, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p))
  ipcMain.handle(IPC.revealFile, (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle(IPC.logInfo, (_e, msg: string) => comfy.pushLog('sys', t('m.ipc.log.ui', { message: String(msg) })))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC.winFullScreen, (e, flag: boolean) => {
    BrowserWindow.fromWebContents(e.sender)?.setFullScreen(!!flag)
  })
  ipcMain.handle(IPC.gpuDetect, () => detectGpu())
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron || '',
    chrome: process.versions.chrome || '',
    node: process.versions.node || '',
    platform: `${process.platform} ${process.arch}`,
    userData: app.getPath('userData'),
    settingsFile: settingsPath(),
    logDir: logDir(),
    defaultInstallPath: defaultRoot()
  }))
  ipcMain.handle(IPC.pythonList, () => listPythons())
  ipcMain.handle(IPC.comfyVersions, () => listComfyVersions())
  ipcMain.handle(IPC.torchIndexes, () => listTorchIndexes())
  ipcMain.handle(IPC.torchVariants, () => listTorchVariants())
  ipcMain.handle('models:categories', () => modelCategories())

  // ---- install / lifecycle ----
  ipcMain.handle(IPC.installRun, async (_e, opts: InstallOptions) => {
    probe = null
    comfy.pushLog('sys', t('m.ipc.log.installStart', { version: opts.version, index: opts.torchIndex }))
    try {
      await installComfyUI(opts, progressLogger(t('m.ipc.tag.install')))
    } catch (e) {
      comfy.pushLog('sys', t('m.ipc.log.installFailed', { error: (e as Error).message }))
      throw e
    }
  })
  ipcMain.handle(IPC.comfyStart, () => comfy.start())
  ipcMain.handle(IPC.comfyStop, () => comfy.stop())
  ipcMain.handle(IPC.comfyRestart, () => comfy.restart())
  ipcMain.handle(IPC.comfyStatus, () => comfy.status)
  ipcMain.handle(IPC.logRecent, () => comfy.logs)
  ipcMain.handle(IPC.comfyUpdate, async (_e, version: string) => {
    probe = null
    comfy.pushLog('sys', t('m.ipc.log.updateStart', { version }))
    try {
      await updateComfyUI(version, progressLogger(t('m.ipc.tag.update')))
    } catch (e) {
      comfy.pushLog('sys', t('m.ipc.log.updateFailed', { error: (e as Error).message }))
      throw e
    }
  })
  ipcMain.handle(IPC.comfyCheckUpdate, () => checkComfyUpdate())
  // 选择已有 ComfyUI 安装：兼容选到根目录（含 ComfyUI 子目录）或 ComfyUI 目录本身
  ipcMain.handle(IPC.comfyUseExisting, (_e, dir: string) => {
    let root = dir
    if (fs.existsSync(path.join(dir, 'main.py'))) {
      root = path.dirname(dir)
    } else if (!fs.existsSync(path.join(dir, 'ComfyUI', 'main.py'))) {
      throw new Error(t('m.ipc.err.invalidComfyDir'))
    }
    saveSettings({ installPath: root })
    return { installPath: root, venvExists: fs.existsSync(paths().venvPython) }
  })
  ipcMain.handle(IPC.torchSwitch, async (_e, index: string) => {
    probe = null
    comfy.pushLog('sys', t('m.ipc.log.torchSwitchStart', { index }))
    try {
      await installTorch(index, progressLogger(t('m.ipc.tag.torch')), 5)
    } catch (e) {
      comfy.pushLog('sys', t('m.ipc.log.torchSwitchFailed', { error: (e as Error).message }))
      throw e
    }
    send(IPC.installProgress, { stage: t('m.ipc.stage.done'), message: t('m.ipc.torchSwitched'), percent: 100 })
  })
  ipcMain.handle(IPC.comfyInfo, async () => {
    const env = await probeEnv()
    return {
      installed: isInstalled(),
      version: installedVersion() || loadSettings().comfyVersion,
      installPath: paths().comfy,
      port: loadSettings().port,
      status: comfy.status,
      torchVersion: env.torchVersion,
      cudaAvailable: env.cudaAvailable,
      gpus: env.gpus
    }
  })

  // ---- models ----
  ipcMain.handle(IPC.modelsScan, () => scanModels())
  ipcMain.handle(IPC.modelsDelete, (_e, p: string) => {
    deleteModel(p)
    comfy.pushLog('sys', t('m.ipc.log.modelDeleted', { path: p }))
  })

  // ---- downloads（下载管理器）----
  initDownloads((list) => send(IPC.downloadsEvent, list))
  ipcMain.handle(IPC.downloadsList, () => listDownloads())
  ipcMain.handle(IPC.downloadsStart, (_e, o: import('../shared/api').DownloadStart) => startDownload(o))
  ipcMain.handle(IPC.downloadsPause, (_e, id: string) => pauseDownload(id))
  ipcMain.handle(IPC.downloadsResume, (_e, id: string) => resumeDownload(id))
  ipcMain.handle(IPC.downloadsCancel, (_e, id: string) => cancelDownload(id))

  // 兜底：webview 内若触发了浏览器式下载（锚点 download 等），接管进下载管理器
  session.defaultSession.on('will-download', (event, item) => {
    const name = item.getFilename()
    if (!/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i.test(name)) return
    event.preventDefault()
    const url = item.getURL()
    comfy.pushLog('sys', t('m.ipc.log.modelDownloadTaken', { name, url }))
    void startDownload({ url, filename: name, category: inferCategory(name, url), useHfMirror: true })
    send(IPC.downloadTaken, { filename: name })
  })

  // ---- nodes ----
  ipcMain.handle(IPC.nodesList, () => listNodes())
  ipcMain.handle(IPC.nodesInstall, async (_e, url: string) => {
    try {
      return await installNode(url, makeStreamLogger(t('m.ipc.tag.nodes'), m => send(IPC.nodesEvent, m)))
    } catch (e) {
      comfy.pushLog('sys', t('m.ipc.log.nodeInstallFailed', { error: (e as Error).message }))
      throw e
    }
  })
  ipcMain.handle(IPC.nodesUpdate, async (_e, name: string) => {
    try {
      await updateNode(name, makeStreamLogger(t('m.ipc.tag.nodes'), m => send(IPC.nodesEvent, m)))
    } catch (e) {
      comfy.pushLog('sys', t('m.ipc.log.nodeUpdateFailed', { name, error: (e as Error).message }))
      throw e
    }
  })
  ipcMain.handle(IPC.nodesUpdateAll, () => updateAllNodes(makeStreamLogger(t('m.ipc.tag.nodes'), m => send(IPC.nodesEvent, m))))
  ipcMain.handle(IPC.nodesRemove, (_e, name: string) => {
    removeNode(name)
    comfy.pushLog('sys', t('m.ipc.log.nodeDeleted', { name }))
  })

  // ---- workflows ----
  ipcMain.handle(IPC.workflowsScan, () => scanWorkflows())
  ipcMain.handle(IPC.workflowsDir, () => workflowDir())
  ipcMain.handle(IPC.workflowsImport, () => importWorkflow())
  ipcMain.handle(IPC.workflowsQueue, async (_e, p: string) => {
    const r = await queueWorkflow(p)
    comfy.pushLog('sys', t('m.ipc.log.workflowQueued', { path: p, number: r.number }))
    return r
  })
  ipcMain.handle(IPC.workflowsDelete, (_e, p: string) => {
    deleteWorkflow(p)
    comfy.pushLog('sys', t('m.ipc.log.workflowDeleted', { path: p }))
  })

  // ---- terminal ----
  ipcMain.handle(IPC.termOpen, (_e, cols: number, rows: number) => terminal.open(cols, rows))
  ipcMain.handle(IPC.termWrite, (_e, id: number, data: string) => terminal.write(id, data))
  ipcMain.handle(IPC.termResize, (_e, id: number, cols: number, rows: number) => terminal.resize(id, cols, rows))
  ipcMain.handle(IPC.termKill, (_e, id: number) => terminal.kill(id))
  terminal.on('data', (id: number, data: string) => send(IPC.termData, { id, data }))
  terminal.on('exit', (id: number, code: number) => send(IPC.termExit, { id, code }))

  // ---- diagnostics ----
  ipcMain.handle(IPC.diagRun, () => runDiagnostics())
  ipcMain.handle(IPC.diagRepair, async (_e, mode: 'pip' | 'torch' | 'deps' | 'rebuild', pythonPath: string, torchIndex: string) => {
    probe = null
    comfy.pushLog('sys', t('m.ipc.log.repairStart', { mode }))
    try {
      await repairEnv(mode, pythonPath, torchIndex, progressLogger(t('m.ipc.tag.repair')))
    } catch (e) {
      comfy.pushLog('sys', t('m.ipc.log.repairFailed', { error: (e as Error).message }))
      throw e
    }
  })

  // ---- comfy process events ----
  comfy.on('log', line => send(IPC.evLog, line))
  comfy.on('status', s => send(IPC.evStatus, s))

  app.on('before-quit', () => {
    terminal.disposeAll()
    void comfy.dispose()
  })
}
