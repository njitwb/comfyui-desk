import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { registerIpc, broadcastRenderer } from './ipc'
import { IPC } from '../shared/api'
import { comfy } from './process'
import { installGuestGuards } from './guest-guard'
import { resolveAppearance, saveSettings } from './settings'
import { reconcileTheme } from './comfy-theme'
import { setMainLocale, t } from './i18n'
import type { Theme } from '../shared/appearance'

// guest 弹窗 / 导航防火墙：模型链接广播给工作台，外链转系统浏览器
installGuestGuards({
  log: msg => comfy.pushLog('sys', msg),
  onModel: (_kind, url) => broadcastRenderer(IPC.navModelDownload, { url })
})

const gotLock = app.requestSingleInstanceLock()
let currentTheme: Theme = 'dark'

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    // 主题与语言：首次启动按系统补齐并落盘，之后以用户选择为准
    const { theme: savedTheme, locale } = resolveAppearance()
    const theme = reconcileTheme(savedTheme)
    if (theme !== savedTheme) saveSettings({ theme })
    currentTheme = theme
    nativeTheme.themeSource = theme
    setMainLocale(locale)

    // 日志页只展示本次启动内容，历史在日志文件中存档
    comfy.pushLog('sys', t('app.logStartup', { version: app.getVersion() }))
    registerIpc()
    createWindow(currentTheme)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(currentTheme)
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

function createWindow(theme: Theme): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    title: t('app.title'),
    backgroundColor: theme === 'light' ? '#eef1f8' : '#080b13',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}
