/**
 * ComfyUI 高级启动参数（参照官方 cli_args.py）：
 * 渲染层用于表单绑定与预览，主进程启动时展开为命令行。
 * 值约定：布尔用 boolean；互斥组用字符串（'' = 默认）；数值用 number。
 */

export type AdvArgs = Record<string, unknown>

/** 全部设置键（反向解析命令行时用于清理已删除的选项） */
export const ADV_KEYS = [
  'listen', 'enableCors', 'compressResponse', 'maxUploadSize',
  'autoLaunch',
  'cudaDevice', 'directml', 'cudaMalloc',
  'forceFp', 'unetPrecision', 'vaePrecision', 'textEncPrecision', 'fp16Intermediates',
  'previewMethod', 'previewSize',
  'cache', 'cacheLruN',
  'attention', 'disableXformers', 'upcastAttention',
  'vramMode', 'reserveVram', 'asyncOffload', 'dynamicVram', 'fastDisk', 'disableSmartMemory', 'disablePinnedMemory', 'mmap',
  'fast', 'deterministic', 'hashFunction',
  'enableManager', 'disableManagerUi', 'managerLegacyUi',
  'disableAllCustomNodes', 'disableApiNodes', 'disableMetadata', 'multiUser',
  'verbose', 'logStdout', 'dontPrintServer'
] as const

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(str(v))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 将高级选项展开为 main.py 的命令行参数（顺序与文档分组一致） */
export function buildAdvancedArgs(a: AdvArgs | null | undefined): string[] {
  if (!a) return []
  const out: string[] = []
  const flag = (key: string, name: string) => {
    if (a[key]) out.push(name)
  }
  const tri = (key: string, onFlag: string, offFlag: string) => {
    if (a[key] === 'on') out.push(onFlag)
    else if (a[key] === 'off') out.push(offFlag)
  }

  // ---- 网络与服务器 ----
  flag('listen', '--listen') // 监听所有接口（局域网可访问）
  flag('enableCors', '--enable-cors-header')
  const maxUpload = num(a.maxUploadSize)
  if (maxUpload && maxUpload !== 100) out.push('--max-upload-size', String(maxUpload))
  flag('compressResponse', '--enable-compress-response-body')

  // ---- 启动与浏览器 ----
  tri('autoLaunch', '--auto-launch', '--disable-auto-launch')

  // ---- 设备与 CUDA ----
  const cudaDevice = str(a.cudaDevice)
  if (cudaDevice) out.push('--cuda-device', cudaDevice)
  flag('directml', '--directml')
  tri('cudaMalloc', '--cuda-malloc', '--disable-cuda-malloc')

  // ---- 精度与推理（各组内互斥，由界面 select 保证） ----
  if (a.forceFp === 'fp32') out.push('--force-fp32')
  else if (a.forceFp === 'fp16') out.push('--force-fp16')
  const unet = str(a.unetPrecision)
  if (unet) out.push(`--${unet}-unet`)
  const vae = str(a.vaePrecision)
  if (vae) out.push(`--${vae}-vae`)
  const textEnc = str(a.textEncPrecision)
  if (textEnc) out.push(`--${textEnc}-text-enc`)
  flag('fp16Intermediates', '--fp16-intermediates')

  // ---- 预览 ----
  const previewMethod = str(a.previewMethod)
  if (previewMethod) out.push('--preview-method', previewMethod)
  const previewSize = num(a.previewSize)
  if (previewSize && previewSize !== 512) out.push('--preview-size', String(previewSize))

  // ---- 缓存（互斥） ----
  if (a.cache === 'none') out.push('--cache-none')
  else if (a.cache === 'classic') out.push('--cache-classic')
  else if (a.cache === 'lru') {
    const n = num(a.cacheLruN)
    out.push('--cache-lru', String(n ?? 3))
  }

  // ---- 注意力机制（互斥） ----
  const attention = str(a.attention)
  if (attention === 'sage') out.push('--use-sage-attention')
  else if (attention === 'flash') out.push('--use-flash-attention')
  else if (attention) out.push(`--use-${attention}-cross-attention`)
  flag('disableXformers', '--disable-xformers')
  tri('upcastAttention', '--force-upcast-attention', '--dont-upcast-attention')

  // ---- VRAM 与内存（模式互斥） ----
  const vramMode = str(a.vramMode)
  if (vramMode) out.push(`--${vramMode}`)
  const reserveVram = num(a.reserveVram)
  if (reserveVram) out.push('--reserve-vram', String(reserveVram))
  tri('asyncOffload', '--async-offload', '--disable-async-offload')
  tri('dynamicVram', '--enable-dynamic-vram', '--disable-dynamic-vram')
  flag('fastDisk', '--fast-disk')
  flag('disableSmartMemory', '--disable-smart-memory')
  flag('disablePinnedMemory', '--disable-pinned-memory')
  tri('mmap', '--mmap-torch-files', '--disable-mmap')

  // ---- 性能与调试 ----
  flag('fast', '--fast')
  flag('deterministic', '--deterministic')
  const hashFn = str(a.hashFunction)
  if (hashFn && hashFn !== 'sha256') out.push('--default-hashing-function', hashFn)

  // ---- ComfyUI Manager ----
  flag('enableManager', '--enable-manager')
  if (a.enableManager) {
    flag('disableManagerUi', '--disable-manager-ui')
    flag('managerLegacyUi', '--enable-manager-legacy-ui')
  }

  // ---- 自定义节点与 API 节点 ----
  flag('disableAllCustomNodes', '--disable-all-custom-nodes')
  flag('disableApiNodes', '--disable-api-nodes')
  flag('disableMetadata', '--disable-metadata')
  flag('multiUser', '--multi-user')

  // ---- 日志与其他 ----
  const verbose = str(a.verbose)
  if (verbose) out.push('--verbose', verbose)
  flag('logStdout', '--log-stdout')
  flag('dontPrintServer', '--dont-print-server')

  return out
}

/** buildAdvancedArgs 的逆函数：从命令行 token 还原高级选项，只输出识别到的键 */
export function parseAdvancedArgs(tokens: string[]): AdvArgs {
  const out: AdvArgs = {}
  const has = (t: string): boolean => tokens.includes(t)
  /** 取 flag 后的值；下一个 token 也是 flag 则视为布尔 */
  const val = (flag: string): string | null => {
    const i = tokens.indexOf(flag)
    return i >= 0 && i + 1 < tokens.length && !tokens[i + 1].startsWith('--') ? tokens[i + 1] : i >= 0 ? '' : null
  }
  const numVal = (flag: string): number | null => {
    const v = val(flag)
    if (!v) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // ---- 网络与服务器 ----
  if (has('--listen')) out.listen = true
  if (has('--enable-cors-header')) out.enableCors = true
  if (has('--enable-compress-response-body')) out.compressResponse = true
  const maxUpload = numVal('--max-upload-size')
  if (maxUpload !== null) out.maxUploadSize = maxUpload

  // ---- 启动与浏览器 ----
  if (has('--auto-launch')) out.autoLaunch = 'on'
  else if (has('--disable-auto-launch')) out.autoLaunch = 'off'

  // ---- 设备与 CUDA ----
  const cudaDevice = val('--cuda-device')
  if (cudaDevice) out.cudaDevice = cudaDevice
  if (has('--directml')) out.directml = true
  if (has('--cuda-malloc')) out.cudaMalloc = 'on'
  else if (has('--disable-cuda-malloc')) out.cudaMalloc = 'off'

  // ---- 精度与推理 ----
  if (has('--force-fp32')) out.forceFp = 'fp32'
  else if (has('--force-fp16')) out.forceFp = 'fp16'
  for (const p of ['fp32', 'fp64', 'bf16', 'fp16', 'fp8_e4m3fn', 'fp8_e5m2', 'fp8_e8m0fnu']) {
    if (has(`--${p}-unet`)) out.unetPrecision = p
  }
  for (const p of ['fp16', 'fp32', 'bf16', 'cpu']) {
    if (has(`--${p}-vae`)) out.vaePrecision = p
  }
  for (const p of ['fp8_e4m3fn', 'fp8_e5m2', 'fp16', 'fp32', 'bf16']) {
    if (has(`--${p}-text-enc`)) out.textEncPrecision = p
  }
  if (has('--fp16-intermediates')) out.fp16Intermediates = true

  // ---- 预览 ----
  const previewMethod = val('--preview-method')
  if (previewMethod) out.previewMethod = previewMethod
  const previewSize = numVal('--preview-size')
  if (previewSize !== null) out.previewSize = previewSize

  // ---- 缓存 ----
  if (has('--cache-none')) out.cache = 'none'
  else if (has('--cache-classic')) out.cache = 'classic'
  else if (has('--cache-lru')) {
    out.cache = 'lru'
    const n = numVal('--cache-lru')
    if (n !== null) out.cacheLruN = n
  }

  // ---- 注意力机制 ----
  if (has('--use-sage-attention')) out.attention = 'sage'
  else if (has('--use-flash-attention')) out.attention = 'flash'
  else {
    const m = tokens.find(t => /^--use-.+-cross-attention$/.test(t))?.match(/^--use-(.+)-cross-attention$/)
    if (m) out.attention = m[1]
  }
  if (has('--disable-xformers')) out.disableXformers = true
  if (has('--force-upcast-attention')) out.upcastAttention = 'on'
  else if (has('--dont-upcast-attention')) out.upcastAttention = 'off'

  // ---- VRAM 与内存 ----
  for (const m of ['gpu-only', 'highvram', 'lowvram', 'novram', 'cpu']) {
    if (has(`--${m}`)) {
      out.vramMode = m
      break
    }
  }
  const reserveVram = numVal('--reserve-vram')
  if (reserveVram !== null) out.reserveVram = reserveVram
  if (has('--async-offload')) out.asyncOffload = 'on'
  else if (has('--disable-async-offload')) out.asyncOffload = 'off'
  if (has('--enable-dynamic-vram')) out.dynamicVram = 'on'
  else if (has('--disable-dynamic-vram')) out.dynamicVram = 'off'
  if (has('--fast-disk')) out.fastDisk = true
  if (has('--disable-smart-memory')) out.disableSmartMemory = true
  if (has('--disable-pinned-memory')) out.disablePinnedMemory = true
  if (has('--mmap-torch-files')) out.mmap = 'on'
  else if (has('--disable-mmap')) out.mmap = 'off'

  // ---- 性能与调试 ----
  if (has('--fast')) out.fast = true
  if (has('--deterministic')) out.deterministic = true
  const hashFn = val('--default-hashing-function')
  if (hashFn) out.hashFunction = hashFn

  // ---- ComfyUI Manager ----
  if (has('--enable-manager')) out.enableManager = true
  if (has('--disable-manager-ui')) out.disableManagerUi = true
  if (has('--enable-manager-legacy-ui')) out.managerLegacyUi = true

  // ---- 自定义节点与 API ----
  if (has('--disable-all-custom-nodes')) out.disableAllCustomNodes = true
  if (has('--disable-api-nodes')) out.disableApiNodes = true
  if (has('--disable-metadata')) out.disableMetadata = true
  if (has('--multi-user')) out.multiUser = true

  // ---- 日志与其他 ----
  const verbose = val('--verbose')
  if (verbose) out.verbose = verbose
  if (has('--log-stdout')) out.logStdout = true
  if (has('--dont-print-server')) out.dontPrintServer = true

  return out
}
