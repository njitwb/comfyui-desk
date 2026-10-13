// 内嵌画布（infinite-canvas SPA）webview 的预加载桥。
// 纯前端 SPA 无法直接访问 Electron API，通过本桥与桌面管家双向同步主题/语言：
//   桌面管家 → 画布:  webview.send('cd:appearance', ...)  → onAppearance 回调
//   画布 → 桌面管家:  sendAppearance(...)  → ipcRenderer.sendToHost → 宿主 webview 的 ipc-message 事件
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('comfyuiDeskBridge', {
  // 桌面管家下发主题/语言（theme: 'light'|'dark'，locale: 'zh'|'en'）
  onAppearance(cb) {
    ipcRenderer.on('cd:appearance', (_e, data) => {
      try {
        cb(data)
      } catch {
        /* 画布侧回调异常不影响桥本身 */
      }
    })
  },
  // 画布内切换主题/语言后通知桌面管家
  sendAppearance(data) {
    ipcRenderer.sendToHost('cd:appearance', data)
  },
  // 画布内点 Agent 按钮 → 请桌面管家开关右侧的 Harness（dsh）对话 dock
  toggleAgentDock() {
    ipcRenderer.sendToHost('cd:agent-dock', { action: 'toggle' })
  },
  // 桌面管家下发 dock 开关状态（高亮画布内的 Agent 按钮）
  onAgentDock(cb) {
    ipcRenderer.on('cd:agent-dock', (_e, data) => {
      try {
        cb(data)
      } catch {
        /* 画布侧回调异常不影响桥本身 */
      }
    })
  }
})
