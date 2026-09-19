/**
 * 注入到 ComfyUI 页面（webview guest）主世界的下载拦截补丁。
 * 会被 toString() 序列化后执行，必须完全自包含，不可引用任何模块级符号；
 * 通过 console-message 的 '__comfy_dm__' 前缀与宿主通信（ready / ctx__ / dbg__）。
 */

/** 缺失模型面板下载行点击时的抓取结果（同域 frame 共享） */
interface Hit { text: string; filename: string; category: string }

/** 面板内单行「文件名 → 类别」映射（全部下载时整窗 ctx 的逐行精确版） */
interface RowHit { filename: string; category: string }

export function comfyDmPatch(): void {
  const MARK = '__comfy_dm__'
  const READY = MARK + 'ready'
  const MODEL_EXT_RE = /[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)([?#].*)?$/i
  const SAVE_DIRS = [
    'checkpoints', 'clip', 'clip_vision', 'controlnet', 'diffusion_models',
    'embeddings', 'loras', 'style_models', 'text_encoders', 'unet',
    'upscale_models', 'vae', 'vae_approx', 'configs'
  ]
  let lastHit: Hit | null = null

  function basename(u: string): string {
    try {
      return decodeURIComponent(u.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '')
    } catch {
      return ''
    }
  }
  function isModelUrl(u: string): boolean {
    return /^https?:\/\//i.test(u) && MODEL_EXT_RE.test(u)
  }

  /** 从点击位置向上最多 8 层，找到含模型文件名的一行，提取文件名与保存目录 */
  function scrape(target: EventTarget | null): { hit: Hit; el: HTMLElement } | null {
    const start = (target as HTMLElement | null)?.closest?.('button, a') as HTMLElement | null
    let cur: HTMLElement | null = start
    for (let i = 0; i < 8 && cur; i++) {
      const raw = (cur.innerText || '').trim()
      if (raw && raw.length < 4000) {
        // 长文件名会被 CSS 软换行打断（.saf\netensors），抹掉换行再匹配
        const text = raw.replace(/\s*\n\s*/g, '')
        const m = text.match(/([\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft))/i)
        if (m) {
          const lines = raw.split('\n').map(l => l.trim())
          let category = SAVE_DIRS.find(d => lines.includes(d)) || ''
          if (!category) {
            // 结构性兜底：无布局 / hidden 窗口下 innerText 不带换行
            const els = cur.querySelectorAll('*')
            for (let k = 0; k < els.length; k++) {
              const t = (els[k].textContent || '').trim()
              if (SAVE_DIRS.includes(t)) { category = t; break }
            }
          }
          return { hit: { text, filename: m[1], category }, el: cur }
        }
      }
      cur = cur.parentElement
    }
    return null
  }

  /** 逐行提取「文件名 → 类别」映射：取只含唯一模型文件名的最小文本块 */
  function extractRows(container: HTMLElement): RowHit[] {
    const rows = new Map<string, string>()
    const els = container.querySelectorAll('*')
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement
      const raw = (el.innerText || '').trim()
      if (!raw || raw.length > 800) continue
      const text = raw.replace(/\s*\n\s*/g, '')
      const ms = text.match(/[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)/gi)
      if (!ms) continue
      if (new Set(ms.map((x: string) => x.toLowerCase())).size !== 1) continue
      const lines = raw.split('\n').map((l: string) => l.trim())
      let category = SAVE_DIRS.find(d => lines.includes(d)) || ''
      if (!category) {
        const subs = el.querySelectorAll('*')
        for (let k = 0; k < subs.length; k++) {
          const t = ((subs[k] as HTMLElement).textContent || '').trim()
          if (SAVE_DIRS.includes(t)) { category = t; break }
        }
      }
      const fname = ms[0]
      if (!rows.has(fname) || (!rows.get(fname) && category)) rows.set(fname, category)
    }
    return [...rows].map(([filename, category]) => ({ filename, category }))
  }

  /** 容器文本里出现的不同模型文件名数量（>1 说明抓到的是整个面板而非单行） */
  function modelNameCount(text: string): number {
    const ms = text.match(/[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)/gi)
    return ms ? new Set(ms.map((x: string) => x.toLowerCase())).size : 0
  }

  function report(url: string): void {
    const base = basename(url)
    let filename = base
    let category = ''
    // 抓取行不含当前文件名（如「全部下载」）→ 回退纯 URL 推导
    if (lastHit && lastHit.text.includes(base)) {
      filename = lastHit.filename || base
      category = lastHit.category
    }
    lastHit = null
    // guest 控制台 → 宿主 webview console-message 事件
    try { console.log(MARK + JSON.stringify({ url, filename, category })) } catch { /* noop */ }
  }

  /** 在指定 frame 上装监听（锚点模型下载接管 / 外链弹窗封堵 / 下载行上下文采集） */
  function installListeners(w: Window): void {
    try {
      w.document.addEventListener('click', (e) => {
        const t = e.target as HTMLElement | null
        const a = t?.closest?.('a[href]')
        const href = (a as HTMLAnchorElement | null)?.href
        if (!href) return
        if (isModelUrl(href)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          report(href)
        } else if (/^https?:\/\//i.test(href) && (a as HTMLAnchorElement).target === '_blank') {
          // 非模型外链：交给出口拦截（阻止弹窗 + 转外部浏览器）
          try { console.log(MARK + 'dbg__ ext-link ' + href) } catch { /* noop */ }
          e.preventDefault()
          w.open(href, '_blank')
        }
      }, true)
      // mousedown：上报下载行上下文（ctx__），供任何接管通道比对类别
      w.document.addEventListener('mousedown', (e) => {
        const got = scrape(e.target)
        if (got) {
          lastHit = got.hit
          // 抓到整个面板（全部下载）时逐行抽取，避免整窗单一类别张冠李戴
          const rows = modelNameCount(got.hit.text) > 1 ? extractRows(got.el) : undefined
          try { console.log(MARK + 'ctx__' + JSON.stringify({ text: got.hit.text, filename: got.hit.filename, category: got.hit.category, rows })) } catch { /* noop */ }
        }
      }, true)
    } catch { /* cross-origin guard */ }
  }

  /** 对 frame 打补丁（window.open 接管 + 监听 + 递归处理动态插入的 iframe） */
  function patchFrame(w: Window): void {
    try {
      const rec = w as unknown as { __comfyDmPatched?: boolean; open: Window['open'] }
      if (rec.__comfyDmPatched) return
      rec.__comfyDmPatched = true
      const origOpen = w.open.bind(w)
      rec.open = (u?: string | URL, t?: string, f?: string) => {
        const us = String(u ?? '')
        try { console.log(MARK + 'dbg__ window.open ' + us) } catch { /* noop */ }
        if (isModelUrl(us)) { report(us); return null }
        return origOpen(us, t, f)
      }
      installListeners(w)
      const ob = new MutationObserver((records) => {
        records.forEach((r) => {
          r.addedNodes.forEach((n) => {
            const patchNested = (f: Element) => {
              try {
                const cw = (f as HTMLIFrameElement).contentWindow
                if (cw) patchFrame(cw)
              } catch { /* noop */ }
            }
            try {
              const el: Element | null = n.nodeType === 1 ? (n as Element) : null
              if (!el) return
              if (el.tagName === 'IFRAME') patchNested(el)
              else el.querySelectorAll('iframe').forEach(patchNested)
            } catch { /* noop */ }
          })
        })
      })
      ob.observe(w.document.documentElement || w.document, { childList: true, subtree: true })
    } catch { /* cross-origin iframe：跳过 */ }
  }

  patchFrame(window)
  try { console.log(MARK + 'ready') } catch { /* noop */ }
}
