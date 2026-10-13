import path from 'node:path'
import { app } from 'electron'

/**
 * dsh 相关的路径常量。单独一个模块是为了打破循环依赖：
 * dsh-process.ts 需要 agent-process.ts 的 mcpEntry/mcpExecutable，
 * 而 agent-process.ts 又需要这个端点文件路径去给 canvas-agent 传环境变量。
 */

/** dsh 的数据目录（$DSH_HOME）：profiles / 凭据 / 会话都放这里，随应用数据一起沉淀 */
export function dshHome(): string {
  return path.join(app.getPath('userData'), 'dsh-home')
}

/**
 * dsh Web 端点信息（含一次性进程 token）的落地文件。
 *
 * 为什么需要它：dsh 启动时才把带 token 的 URL 打到 stdout，token 只在主进程手上；
 * 而 canvas-agent 要以「同一个 dsh 进程」的身份调它的 /api，就必须拿到 token 去换会话 cookie。
 * 两个进程各自独立，用这个文件做交接。
 */
export function dshEndpointFile(): string {
  return path.join(app.getPath('userData'), 'dsh-endpoint.json')
}
