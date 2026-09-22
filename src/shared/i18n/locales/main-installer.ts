import type { MessageTable } from '../types'

/** 主进程：安装器（src/main/installer.ts），键前缀 m.installer. */
export default {
  'm.installer.stageSource': ['源码', 'Source'],
  'm.installer.stageTorch': ['Torch', 'Torch'],
  'm.installer.stageDeps': ['依赖', 'Dependencies'],
  'm.installer.stageManager': ['Manager', 'Manager'],
  'm.installer.stagePrepare': ['准备', 'Preparing'],
  'm.installer.stagePython': ['Python', 'Python'],
  'm.installer.stageUpdate': ['更新', 'Update'],
  'm.installer.stageDone': ['完成', 'Done'],
  'm.installer.segIdleTimeout': ['下载段空闲超时', 'Download segment idle timeout'],
  'm.installer.tooManyRedirects': ['重定向次数过多', 'Too many redirects'],
  'm.installer.httpDownloadFailed': ['下载失败 HTTP {code}: {url}', 'Download failed HTTP {code}: {url}'],
  'm.installer.repoExistsSwitch': [
    '仓库已存在，切换到目标版本...',
    'Repository already exists, switching to the target version...'
  ],
  'm.installer.switchVersionFailed': ['切换版本失败: {detail}', 'Failed to switch version: {detail}'],
  'm.installer.switchRemote': ['检测到源码地址变更，切换远程仓库...', 'Source changed, switching the remote repository...'],
  'm.installer.switchRemoteFailed': ['切换远程仓库失败: {detail}', 'Failed to switch the remote repository: {detail}'],
  'm.installer.cloneFrom': ['从 {source} 克隆 {version} ...', 'Cloning {version} from {source} ...'],
  'm.installer.cloneFallback': [
    'git 克隆失败，改用下载压缩包...',
    'git clone failed, downloading the archive instead...'
  ],
  'm.installer.downloadingZip': ['下载 ComfyUI 压缩包...', 'Downloading the ComfyUI archive...'],
  'm.installer.downloadingMb': ['下载中 {mb}MB', 'Downloading {mb}MB'],
  'm.installer.extracting': ['解压中...', 'Extracting...'],
  'm.installer.extractFailed': ['解压失败', 'Extraction failed'],
  'm.installer.badArchive': ['压缩包结构异常', 'Unexpected archive structure'],
  'm.installer.pkgCached': ['{pkg} 已有缓存，跳过下载', '{pkg} is already cached, skipping download'],
  'm.installer.multiThreadDownload': [
    '多线程下载 {pkg} ...',
    'Downloading {pkg} with multiple connections ...'
  ],
  'm.installer.pkgDownloading': [
    '下载 {pkg}  {done} / {total} MB',
    'Downloading {pkg}  {done} / {total} MB'
  ],
  'm.installer.installTorchToEnv': [
    '安装 PyTorch 到运行环境...',
    'Installing PyTorch into the runtime environment...'
  ],
  'm.installer.unknownTorchIndex': ['未知的 torch 源: {index}', 'Unknown torch index: {index}'],
  'm.installer.sourceLabelAliyun': ['阿里云镜像', 'Aliyun mirror'],
  'm.installer.sourceLabelOfficial': ['PyTorch 官方', 'PyTorch official'],
  'm.installer.retryWithSource': [
    '上一个源连接失败，改用{label}重试...',
    'The previous source failed, retrying with {label}...'
  ],
  'm.installer.installTorchFrom': [
    '安装 PyTorch ({index}, {label}) ...',
    'Installing PyTorch ({index}, {label}) ...'
  ],
  'm.installer.noMatchingWheel': [
    '目录页解析不到匹配版本，改用 pip 直接安装...',
    'No matching version found on the index page, installing directly with pip...'
  ],
  'm.installer.fastDownloadFailed': [
    '高速下载失败（{error}），改用 pip 重试...',
    'Fast download failed ({error}), retrying with pip...'
  ],
  'm.installer.torchInstallFailed': [
    'PyTorch 安装失败（已尝试官方源与阿里云镜像）',
    'PyTorch installation failed (tried the official source and the Aliyun mirror)'
  ],
  'm.installer.torchInstallFailedDetail': [
    'PyTorch 安装失败（已尝试官方源与阿里云镜像）：{detail}',
    'PyTorch installation failed (tried the official source and the Aliyun mirror): {detail}'
  ],
  'm.installer.installDeps': ['安装 ComfyUI 依赖...', 'Installing ComfyUI dependencies...'],
  'm.installer.retryOfficialPyPI': [
    '镜像缺少部分依赖包（同步延迟），改用官方 PyPI 重试...',
    'The mirror is missing some packages (sync delay), retrying with the official PyPI...'
  ],
  'm.installer.depsInstallFailed': ['依赖安装失败', 'Failed to install dependencies'],
  'm.installer.installManagerPip': [
    '安装/升级 ComfyUI-Manager(官方 pip 包)...',
    'Installing/upgrading ComfyUI-Manager (official pip package)...'
  ],
  'm.installer.pipManagerFailed': ['pip 安装 comfyui-manager 失败', 'pip install comfyui-manager failed'],
  'm.installer.oldManagerBackedUp': [
    '已将 custom_nodes 下旧版 Manager 备份为 ComfyUI-Manager.bak(可自行删除)',
    'The old Manager under custom_nodes was backed up to ComfyUI-Manager.bak (you can delete it yourself)'
  ],
  'm.installer.pipChannelFailed': [
    'pip 渠道失败({error}),改用源码安装...',
    'pip channel failed ({error}), installing from source instead...'
  ],
  'm.installer.managerInstallFailed': [
    'ComfyUI-Manager 安装失败(不影响 ComfyUI 本体):{error}',
    'Failed to install ComfyUI-Manager (ComfyUI itself is unaffected): {error}'
  ],
  'm.installer.updateManager': ['更新 ComfyUI-Manager ...', 'Updating ComfyUI-Manager ...'],
  'm.installer.managerUpdateFailed': ['Manager 更新失败', 'Failed to update Manager'],
  'm.installer.gitNotFound': ['未检测到 git', 'git not found'],
  'm.installer.installManagerSource': ['安装 ComfyUI-Manager(源码) ...', 'Installing ComfyUI-Manager (from source) ...'],
  'm.installer.cloneFailed': ['克隆失败: {detail}', 'Clone failed: {detail}'],
  'm.installer.installManagerDeps': ['安装 Manager 依赖...', 'Installing Manager dependencies...'],
  'm.installer.managerDepsFailed': ['Manager 依赖安装失败', 'Failed to install Manager dependencies'],
  'm.installer.pickInstallPath': ['请先选择安装路径', 'Please choose an installation path first'],
  'm.installer.checkEnv': ['检查安装环境...', 'Checking the installation environment...'],
  'm.installer.sourceReady': ['源码就绪', 'Source ready'],
  'm.installer.creatingVenv': ['创建虚拟环境...', 'Creating the virtual environment...'],
  'm.installer.venvReady': ['虚拟环境就绪', 'Virtual environment ready'],
  'm.installer.torchDone': ['PyTorch 安装完成', 'PyTorch installation complete'],
  'm.installer.installDone': ['ComfyUI 安装完成！', 'ComfyUI installation complete!'],
  'm.installer.pullLatest': ['拉取最新代码...', 'Pulling the latest code...'],
  'm.installer.updateFailed': ['更新失败: {detail}', 'Update failed: {detail}'],
  'm.installer.updateDeps': ['更新依赖...', 'Updating dependencies...'],
  'm.installer.updateDone': ['更新完成', 'Update complete']
} as const satisfies MessageTable
