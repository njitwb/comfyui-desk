import { app, shell } from 'electron'
import { t } from './i18n'

const MODEL_URL_RE = /[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)([?#].*)?$/i

function isModelUrlStr(url: string): boolean {
  return /^https?:\/\//i.test(url) && MODEL_URL_RE.test(url)
}

export interface GuardDeps {
  log: (msg: string) => void
  onModel: (kind: 'popup' | 'nav', url: string) => void
}

/** 本机 ComfyUI 导航放行（兼容自定义端口 / localhost） */
function allowLocalNav(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(url)
}

/**
 * webview guest 的弹窗 / 导航防火墙：
 * 模型链接交给 onModel 回调，其他 http(s) 转系统浏览器，主帧只允许留在本机 ComfyUI。
 */
export function installGuestGuards(deps: GuardDeps): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (!/^https?:/i.test(url)) return { action: 'deny' }
      if (contents.getType() === 'webview') {
        if (isModelUrlStr(url)) {
          deps.log(t('m.misc.guard.popupTaken', { url }))
          deps.onModel('popup', url)
          return { action: 'deny' }
        }
        void shell.openExternal(url)
        return { action: 'deny' }
      }
      return { action: 'allow' }
    })

    if (contents.getType() === 'webview') {
      // 页面武装 beforeunload 后 reload 会被静默拦死，这里直接放行
      contents.on('will-prevent-unload', ev => {
        ev.preventDefault()
      })
      contents.on('will-navigate', (ev, url) => {
        if (allowLocalNav(url)) return
        ev.preventDefault()
        if (isModelUrlStr(url)) {
          deps.log(t('m.misc.guard.navDownloadBlocked', { url }))
          deps.onModel('nav', url)
        } else {
          void shell.openExternal(url)
        }
      })
    }
  })
}
