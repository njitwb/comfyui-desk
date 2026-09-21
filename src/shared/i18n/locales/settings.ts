import type { MessageTable } from '../types'

/** 设置页（src/renderer/src/views/Settings.vue），键前缀 settings. */
export default {
  'settings.title': ['设置', 'Settings'],
  'settings.appearance.title': ['外观与语言', 'Appearance & language'],
  'settings.appearance.theme': ['主题', 'Theme'],
  'settings.appearance.theme.dark': ['深色', 'Dark'],
  'settings.appearance.theme.light': ['亮色', 'Light'],
  'settings.appearance.locale': ['界面语言', 'Interface language'],
  'settings.appearance.syncComfyTheme': ['与 ComfyUI 主题联动', 'Sync with ComfyUI theme'],
  'settings.autosaveNote': ['改动自动保存，高级选项将在下次启动 ComfyUI 时生效', 'Changes are saved automatically; advanced options take effect the next time ComfyUI starts'],

  /** 启动参数卡片 */
  'settings.launch.title': ['启动参数', 'Launch arguments'],
  'settings.launch.port': ['端口', 'Port'],
  'settings.launch.extraArgs': ['额外启动参数', 'Extra launch arguments'],
  'settings.launch.extraArgs.ph': ['如 --lowvram --preview-method auto', 'e.g. --lowvram --preview-method auto'],

  /** 高级选项 */
  'settings.adv.toggle': ['高级选项', 'Advanced options'],
  'settings.adv.sub': ['参照官方文档分组配置详细启动参数，保存后重启 ComfyUI 生效', 'Configure detailed launch arguments grouped per the official docs; restart ComfyUI after saving to apply'],
  'settings.adv.preview': ['生成参数', 'Generated arguments'],

  /** 高级选项通用取值标签 */
  'settings.adv.opt.default': ['默认', 'Default'],
  'settings.adv.opt.fp32': ['fp32', 'fp32'],
  'settings.adv.opt.fp16': ['fp16', 'fp16'],
  'settings.adv.opt.fp64': ['fp64', 'fp64'],
  'settings.adv.opt.bf16': ['bf16', 'bf16'],
  'settings.adv.opt.fp8e4m3fn': ['fp8 (e4m3fn)', 'fp8 (e4m3fn)'],
  'settings.adv.opt.fp8e5m2': ['fp8 (e5m2)', 'fp8 (e5m2)'],
  'settings.adv.opt.fp8e8m0fnu': ['fp8 (e8m0fnu)', 'fp8 (e8m0fnu)'],
  'settings.adv.tri.on': ['启用', 'Enable'],
  'settings.adv.tri.off': ['禁用', 'Disable'],
  'settings.adv.tri.default.torch': ['默认（torch 2.0+ 自动）', 'Default (automatic on torch 2.0+)'],
  'settings.adv.tri.default.nvidiaOn': ['默认（Nvidia 启用）', 'Default (enabled on Nvidia)'],
  'settings.adv.tri.default.nvidiaAuto': ['默认（Nvidia 自动）', 'Default (automatic on Nvidia)'],

  /** 高级选项分组标题 */
  'settings.adv.g.network': ['网络与服务器', 'Network & server'],
  'settings.adv.g.startup': ['启动与浏览器', 'Startup & browser'],
  'settings.adv.g.device': ['设备与 CUDA', 'Device & CUDA'],
  'settings.adv.g.precision': ['精度与推理（同组互斥）', 'Precision & inference (mutually exclusive in group)'],
  'settings.adv.g.preview': ['预览', 'Preview'],
  'settings.adv.g.cache': ['缓存（互斥）', 'Cache (mutually exclusive)'],
  'settings.adv.g.attention': ['注意力机制（互斥）', 'Attention (mutually exclusive)'],
  'settings.adv.g.vram': ['VRAM 与内存', 'VRAM & memory'],
  'settings.adv.g.perf': ['性能与调试', 'Performance & debugging'],
  'settings.adv.g.manager': ['ComfyUI Manager', 'ComfyUI Manager'],
  'settings.adv.g.customNodes': ['自定义节点与 API', 'Custom nodes & API'],
  'settings.adv.g.logs': ['日志与其他', 'Logging & misc'],

  /** 网络与服务器 */
  'settings.adv.listen.label': ['允许局域网访问（监听所有接口）', 'Allow LAN access (listen on all interfaces)'],
  'settings.adv.listen.hint': ['等效 --listen，局域网内其他设备可访问', 'Equivalent to --listen; other devices on the LAN can access it'],
  'settings.adv.enableCors': ['启用 CORS 跨域', 'Enable CORS'],
  'settings.adv.compressResponse': ['HTTP 响应压缩', 'Compress HTTP responses'],
  'settings.adv.maxUploadSize': ['最大上传大小 (MB)', 'Max upload size (MB)'],
  'settings.adv.maxUploadSize.ph': ['默认 100', 'Default 100'],

  /** 启动与浏览器 */
  'settings.adv.autoLaunch': ['启动后打开浏览器', 'Open browser after startup'],
  'settings.adv.autoLaunch.default': ['默认（自动打开）', 'Default (auto open)'],
  'settings.adv.autoLaunch.on': ['强制打开（--auto-launch）', 'Force open (--auto-launch)'],
  'settings.adv.autoLaunch.off': ['不打开（--disable-auto-launch）', 'Do not open (--disable-auto-launch)'],

  /** 设备与 CUDA */
  'settings.adv.cudaDevice': ['CUDA 设备 ID', 'CUDA device ID'],
  'settings.adv.cudaDevice.ph': ['如 0 ，多卡 0,1 ，all 为全部', 'e.g. 0, multi-GPU 0,1, all for every device'],
  'settings.adv.cudaMalloc': ['cudaMallocAsync', 'cudaMallocAsync'],
  'settings.adv.directml': ['使用 DirectML（AMD / 核显）', 'Use DirectML (AMD / integrated GPU)'],

  /** 精度与推理 */
  'settings.adv.forceFp': ['全局浮点精度', 'Global float precision'],
  'settings.adv.forceFp.fp32': ['强制 fp32', 'Force fp32'],
  'settings.adv.forceFp.fp16': ['强制 fp16', 'Force fp16'],
  'settings.adv.forceFp.hint': ['强制 fp16 会同时设置 fp16-unet', 'Forcing fp16 also sets fp16-unet'],
  'settings.adv.unetPrecision': ['UNET 精度', 'UNET precision'],
  'settings.adv.vaePrecision': ['VAE 精度', 'VAE precision'],
  'settings.adv.vaePrecision.fp16': ['fp16（可能黑图）', 'fp16 (may produce black images)'],
  'settings.adv.vaePrecision.cpu': ['在 CPU 上运行', 'Run on CPU'],
  'settings.adv.textEncPrecision': ['文本编码器精度', 'Text encoder precision'],
  'settings.adv.fp16Intermediates': ['中间张量 fp16（实验性）', 'fp16 intermediate tensors (experimental)'],

  /** 预览 */
  'settings.adv.previewMethod': ['采样预览方式', 'Sampling preview method'],
  'settings.adv.previewMethod.off': ['关闭（默认）', 'Off (default)'],
  'settings.adv.previewMethod.auto': ['auto', 'auto'],
  'settings.adv.previewMethod.latent2rgb': ['latent2rgb（快）', 'latent2rgb (fast)'],
  'settings.adv.previewMethod.taesd': ['taesd（清晰）', 'taesd (sharp)'],
  'settings.adv.previewSize': ['预览尺寸 (px)', 'Preview size (px)'],
  'settings.adv.previewSize.ph': ['默认 512', 'Default 512'],

  /** 缓存 */
  'settings.adv.cache': ['缓存模式', 'Cache mode'],
  'settings.adv.cache.ram': ['RAM 压力缓存（默认）', 'RAM pressure cache (default)'],
  'settings.adv.cache.none': ['禁用缓存（省内存）', 'Disable cache (saves memory)'],
  'settings.adv.cache.classic': ['旧版激进缓存', 'Legacy aggressive cache'],
  'settings.adv.cache.lru': ['LRU 缓存', 'LRU cache'],
  'settings.adv.cacheLruN': ['LRU 缓存条数', 'LRU cache entries'],
  'settings.adv.cacheLruN.ph': ['默认 3', 'Default 3'],

  /** 注意力机制 */
  'settings.adv.attention': ['交叉注意力', 'Cross attention'],
  'settings.adv.attention.default': ['默认（xformers）', 'Default (xformers)'],
  'settings.adv.attention.split': ['split', 'split'],
  'settings.adv.attention.quad': ['quad', 'quad'],
  'settings.adv.attention.pytorch': ['pytorch', 'pytorch'],
  'settings.adv.attention.sage': ['SageAttention', 'SageAttention'],
  'settings.adv.attention.flash': ['FlashAttention', 'FlashAttention'],
  'settings.adv.disableXformers': ['禁用 xformers', 'Disable xformers'],
  'settings.adv.upcastAttention': ['注意力上转换', 'Upcast attention'],
  'settings.adv.upcastAttention.on': ['强制上转换（可修黑图）', 'Force upcast (can fix black images)'],
  'settings.adv.upcastAttention.off': ['禁止上转换（调试用）', 'Disable upcast (for debugging)'],

  /** VRAM 与内存 */
  'settings.adv.vramMode': ['显存模式（互斥）', 'VRAM mode (mutually exclusive)'],
  'settings.adv.vramMode.auto': ['自动', 'Automatic'],
  'settings.adv.vramMode.gpuOnly': ['gpu-only（全部驻留 GPU）', 'gpu-only (everything stays on GPU)'],
  'settings.adv.vramMode.highvram': ['highvram（不卸载模型）', 'highvram (keep models loaded)'],
  'settings.adv.vramMode.lowvram': ['lowvram（低显存）', 'lowvram (low VRAM)'],
  'settings.adv.vramMode.novram': ['novram（极低显存）', 'novram (very low VRAM)'],
  'settings.adv.vramMode.cpu': ['cpu（纯 CPU，较慢）', 'cpu (CPU only, slower)'],
  'settings.adv.reserveVram': ['预留显存 (GB)', 'Reserved VRAM (GB)'],
  'settings.adv.reserveVram.ph': ['为系统等预留', 'Reserve for the system and more'],
  'settings.adv.asyncOffload': ['异步权重卸载', 'Async weight offload'],
  'settings.adv.dynamicVram': ['动态 VRAM', 'Dynamic VRAM'],
  'settings.adv.fastDisk': ['优先高速磁盘加载（NVMe）', 'Prefer fast disk loading (NVMe)'],
  'settings.adv.disableSmartMemory': ['禁用智能内存（积极卸载到 RAM）', 'Disable smart memory (aggressively offload to RAM)'],
  'settings.adv.disablePinnedMemory': ['禁用固定内存', 'Disable pinned memory'],
  'settings.adv.mmap': ['mmap 加载模型文件', 'Load model files with mmap'],

  /** 性能与调试 */
  'settings.adv.fast': ['启用全部 --fast 实验优化', 'Enable all --fast experimental optimizations'],
  'settings.adv.fast.hint': ['可能影响质量或稳定性', 'May affect quality or stability'],
  'settings.adv.deterministic': ['确定性算法（更慢）', 'Deterministic algorithms (slower)'],
  'settings.adv.hashFunction': ['文件哈希算法', 'File hash algorithm'],
  'settings.adv.hashFunction.sha256': ['sha256（默认）', 'sha256 (default)'],
  'settings.adv.hashFunction.md5': ['md5', 'md5'],
  'settings.adv.hashFunction.sha1': ['sha1', 'sha1'],
  'settings.adv.hashFunction.sha512': ['sha512', 'sha512'],

  /** ComfyUI Manager */
  'settings.adv.enableManager': ['启用 ComfyUI-Manager', 'Enable ComfyUI-Manager'],
  'settings.adv.disableManagerUi': ['仅禁用 Manager UI', 'Disable Manager UI only'],
  'settings.adv.managerLegacyUi': ['使用旧版 Manager UI', 'Use legacy Manager UI'],

  /** 自定义节点与 API */
  'settings.adv.disableAllCustomNodes': ['禁用所有自定义节点', 'Disable all custom nodes'],
  'settings.adv.disableAllCustomNodes.hint': ['排查节点冲突时使用', 'Use when troubleshooting node conflicts'],
  'settings.adv.disableApiNodes': ['禁用 API 节点', 'Disable API nodes'],
  'settings.adv.disableMetadata': ['不保存提示词元数据', 'Do not save prompt metadata'],
  'settings.adv.multiUser': ['多用户模式（按用户隔离）', 'Multi-user mode (isolated per user)'],

  /** 日志与其他 */
  'settings.adv.verbose': ['日志级别', 'Log level'],
  'settings.adv.verbose.info': ['INFO（默认）', 'INFO (default)'],
  'settings.adv.verbose.debug': ['DEBUG', 'DEBUG'],
  'settings.adv.verbose.warning': ['WARNING', 'WARNING'],
  'settings.adv.verbose.error': ['ERROR', 'ERROR'],
  'settings.adv.verbose.critical': ['CRITICAL', 'CRITICAL'],
  'settings.adv.logStdout': ['日志输出到 stdout', 'Log to stdout'],
  'settings.adv.dontPrintServer': ['不打印服务器输出', 'Do not print server output'],

  /** 源码与镜像卡片 */
  'settings.mirror.title': ['源码与镜像（国内适配）', 'Source & mirrors (China-friendly)'],
  'settings.mirror.repo': ['ComfyUI 源码仓库', 'ComfyUI source repository'],
  'settings.mirror.repo.github': ['GitHub（官方）', 'GitHub (official)'],
  'settings.mirror.repo.gitcode': ['GitCode（国内镜像）', 'GitCode (China mirror)'],
  'settings.mirror.repo.custom': ['自定义地址', 'Custom URL'],
  'settings.mirror.customRepo': ['自定义仓库地址', 'Custom repository URL'],
  'settings.mirror.gitProxy': ['GitHub 代理前缀（可选）', 'GitHub proxy prefix (optional)'],
  'settings.mirror.gitProxy.ph': ['如 https://ghfast.top/ 或留空', 'e.g. https://ghfast.top/ or leave empty'],
  'settings.mirror.gitProxy.hint': ['克隆第三方节点等 GitHub 地址时自动加上前缀', 'Prefixed automatically when cloning GitHub URLs such as third-party nodes'],
  'settings.mirror.pip': ['pip 安装源', 'pip index'],
  'settings.mirror.pip.pypi': ['PyPI 官方（pypi.org）', 'PyPI official (pypi.org)'],
  'settings.mirror.pip.tuna': ['清华大学 TUNA', 'Tsinghua TUNA'],
  'settings.mirror.pip.aliyun': ['阿里云', 'Alibaba Cloud'],
  'settings.mirror.pip.ustc': ['中科大 USTC', 'USTC'],
  'settings.mirror.torch': ['PyTorch 下载源（安装 / 切换 Torch 时使用）', 'PyTorch download source (used when installing or switching Torch)'],
  'settings.mirror.torch.official': ['PyTorch 官方（download.pytorch.org）', 'PyTorch official (download.pytorch.org)'],
  'settings.mirror.torch.aliyun': ['阿里云镜像（国内推荐）', 'Alibaba Cloud mirror (recommended in China)'],
  'settings.mirror.torch.hint': ['首选源下载失败时会自动切换到另一源重试', 'Automatically retries with the other source if the preferred one fails'],

  /** 模型与路径卡片 */
  'settings.paths.title': ['模型与路径', 'Models & paths'],
  'settings.paths.modelPath': ['模型下载路径（独立目录，留空则使用 ComfyUI 默认 models 目录）', 'Model download path (separate directory; leave empty to use the ComfyUI default models directory)'],
  'settings.paths.installPath': ['安装路径', 'Install path'],
  'settings.paths.hfMirror': ['模型搜索与下载启用 HF 国内镜像（hf-mirror.com），关闭则走 huggingface.co 官方站', 'Search and download models via the HF mirror (hf-mirror.com); turn off to use the official huggingface.co'],

  /** 环境卡片 */
  'settings.env.title': ['环境', 'Environment'],
  'settings.env.torchIndex': ['Torch 源偏好（安装 / 切换 Torch 时使用）', 'Torch index preference (used when installing or switching Torch)'],
  'settings.env.torchIndex.auto': ['自动推荐', 'Auto-recommended'],
  'settings.env.python': ['Python 解释器（重建 / 修复环境时使用，留空自动选择）', 'Python interpreter (used when rebuilding or repairing the environment; leave empty to auto-select)']
} as const satisfies MessageTable
