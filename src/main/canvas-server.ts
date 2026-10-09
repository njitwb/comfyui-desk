import { app, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * 内嵌无限画布（infinite-canvas SPA）的静态托管：
 * 通过自定义特权协议 canvas:// 把 canvas/web/dist 构建产物提供给 `<webview>`，
 * 并对 React Router 的 history 路由做 index.html 回退。
 *
 * 资源根目录：dev 下为项目根，打包后位于 app.asar 内（fs 透明读取）。
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
}

/** 画布 SPA 静态根目录（dev=项目根，打包后=app.asar 内） */
export function canvasDistRoot(): string {
  return path.join(app.getAppPath(), 'canvas', 'web', 'dist')
}

/** 必须在 app ready 后调用 */
export function registerCanvasServer(): void {
  const root = canvasDistRoot()
  protocol.handle('canvas', async (request) => {
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    if (pathname === '/') pathname = '/index.html'

    // 路径穿越防护：归一化后必须落在 dist 根内
    const filePath = path.normalize(path.join(root, pathname))
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    const ext = path.extname(filePath).toLowerCase()
    try {
      const data = await fs.readFile(filePath)
      return new Response(data, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' } })
    } catch {
      // SPA history 回退：无扩展名的路由路径回 index.html；资源文件缺失返回 404（防 hashed asset 被回成 HTML）
      if (ext) return new Response('Not Found', { status: 404 })
      try {
        const index = await fs.readFile(path.join(root, 'index.html'))
        return new Response(index, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }
  })
}
