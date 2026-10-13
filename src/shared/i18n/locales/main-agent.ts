import type { MessageTable } from '../types'

/** 主进程：无限画布伴生服务（src/main/agent-process.ts），键前缀 m.agent. */
export default {
  'm.agent.starting': ['[画布 Agent] 正在启动伴生服务（127.0.0.1:{port}）…', '[Canvas Agent] Starting the companion service at 127.0.0.1:{port} …'],
  'm.agent.reused': ['[画布 Agent] 已复用运行中的实例（127.0.0.1:{port}）', '[Canvas Agent] Reusing the running instance at 127.0.0.1:{port}'],
  'm.agent.ready': ['[画布 Agent] 已就绪：127.0.0.1:{port}（协议 v{version}）', '[Canvas Agent] Ready at 127.0.0.1:{port} (protocol v{version})'],
  'm.agent.stopping': ['[画布 Agent] 正在停止伴生服务 …', '[Canvas Agent] Stopping the companion service …'],
  'm.agent.portInUse': [
    '[画布 Agent] 端口 {port} 已被其他程序占用，未启动伴生服务；可在「设置」页更换端口',
    '[Canvas Agent] Port {port} is already used by another program; the companion service was not started. Change the port on the "Settings" page'
  ],
  'm.agent.timeout': ['[画布 Agent] 启动超时（127.0.0.1:{port}），请检查端口是否被占用', '[Canvas Agent] Start timed out at 127.0.0.1:{port}; check whether the port is in use'],
  'm.agent.error': ['[画布 Agent] 启动失败：{msg}', '[Canvas Agent] Failed to start: {msg}'],
  'm.agent.exited': ['[画布 Agent] 进程已退出，退出码 {code}', '[Canvas Agent] Process exited with code {code}'],
  'm.agent.entryMissing': [
    '[画布 Agent] 未找到伴生服务文件：{path}（请先执行 npm run build:agent）',
    '[Canvas Agent] Companion service files not found: {path} (run npm run build:agent first)'
  ],
  'm.agent.nodeTooOld': ['[画布 Agent] 内置 Node 版本过低（{version}），需要 18 及以上', '[Canvas Agent] Bundled Node version is too old ({version}); version 18 or newer is required'],
  'm.agent.logLine': ['[画布 Agent] {text}', '[Canvas Agent] {text}'],

  /** 主进程：DeepSeek Harness（src/main/dsh-process.ts），键前缀 m.dsh. */
  'm.dsh.starting': ['[Harness] 正在启动 DeepSeek Harness（127.0.0.1:{port}）…', '[Harness] Starting DeepSeek Harness at 127.0.0.1:{port} …'],
  'm.dsh.ready': ['[Harness] 已就绪：127.0.0.1:{port}', '[Harness] Ready at 127.0.0.1:{port}'],
  'm.dsh.stopping': ['[Harness] 正在停止 DeepSeek Harness …', '[Harness] Stopping DeepSeek Harness …'],
  'm.dsh.exited': ['[Harness] 进程已退出，退出码 {code}', '[Harness] Process exited with code {code}'],
  'm.dsh.portInUse': [
    '[Harness] 端口 {port} 已被其他程序占用，未启动 DeepSeek Harness；可在「设置」页更换端口',
    '[Harness] Port {port} is already used by another program; DeepSeek Harness was not started. Change the port on the "Settings" page'
  ],
  'm.dsh.timeout': ['[Harness] 启动超时（127.0.0.1:{port}），请检查端口是否被占用', '[Harness] Start timed out at 127.0.0.1:{port}; check whether the port is in use'],
  'm.dsh.error': ['[Harness] 启动失败：{msg}', '[Harness] Failed to start: {msg}'],
  'm.dsh.patchFailed': ['[Harness] 写入画布 MCP 配置失败：{msg}', '[Harness] Failed to write the canvas MCP config: {msg}'],
  'm.dsh.nodeMissing': [
    '[Harness] 缺少随包 Node 运行时：{path}（请先执行 npm run prepare:node）',
    '[Harness] Bundled Node runtime not found: {path} (run npm run prepare:node first)'
  ],
  'm.dsh.entryMissing': [
    '[Harness] 未找到 DeepSeek Harness 入口：{path}（请先执行 npm run build:dsh）',
    '[Harness] DeepSeek Harness entry not found: {path} (run npm run build:dsh first)'
  ],
  'm.dsh.endpointFailed': [
    '[Harness] 写入端点交接文件失败，画布内 agent 将无法连到 Harness：{msg}',
    '[Harness] Failed to write the endpoint handoff file; the in-canvas agent will not reach Harness: {msg}'
  ],
  'm.dsh.pnpmShimFailed': [
    '[Harness] 生成 pnpm 垫片失败，插件管理与插件市场可能不可用：{msg}',
    '[Harness] Failed to create the pnpm shim; plugin management and the plugin market may be unavailable: {msg}'
  ],
  'm.dsh.pluginInstalling': [
    '[Harness] 首次运行：正在安装 dsh 插件 {name}（插件市场与技能管理需要它）…',
    '[Harness] First run: installing dsh plugin {name} (required by the plugin market and skill management)…'
  ],
  'm.dsh.pluginInstalled': [
    '[Harness] 插件 {name} 安装完成，重启 Harness 后可在设置里看到',
    '[Harness] Plugin {name} installed; restart Harness to see it in settings'
  ],
  'm.dsh.pluginInstallFailed': [
    '[Harness] 插件 {name} 安装失败：{msg}',
    '[Harness] Failed to install plugin {name}: {msg}'
  ],
  'm.dsh.logLine': ['[Harness] {text}', '[Harness] {text}']
} as const satisfies MessageTable