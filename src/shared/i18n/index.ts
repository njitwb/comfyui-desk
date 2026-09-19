/**
 * 文案总表：每个业务模块一个文件，最后在这里合并。
 * 键名 = `<模块前缀>.<语义>`；模块文件用 `as const satisfies MessageTable` 导出，
 * 键名拼错会被 tsc 拦下；`{name}` 占位由 translate 替换。
 */
import type { Locale, MessagePair } from './types'
import common from './locales/common'
import app from './locales/app'
import nav from './locales/nav'
import store from './locales/store'
import dashboard from './locales/dashboard'
import workbench from './locales/workbench'
import install from './locales/install'
import logs from './locales/logs'
import terminal from './locales/terminal'
import models from './locales/models'
import nodes from './locales/nodes'
import workflows from './locales/workflows'
import tools from './locales/tools'
import settings from './locales/settings'
import about from './locales/about'
import mainInstaller from './locales/main-installer'
import mainDownloads from './locales/main-downloads'
import mainProcess from './locales/main-process'
import mainIpc from './locales/main-ipc'
import mainDiagnostics from './locales/main-diagnostics'
import mainNodes from './locales/main-nodes'
import mainTerminal from './locales/main-terminal'
import mainMisc from './locales/main-misc'

export const MESSAGES = {
  ...common,
  ...app,
  ...nav,
  ...store,
  ...dashboard,
  ...workbench,
  ...install,
  ...logs,
  ...terminal,
  ...models,
  ...nodes,
  ...workflows,
  ...tools,
  ...settings,
  ...about,
  ...mainInstaller,
  ...mainDownloads,
  ...mainProcess,
  ...mainIpc,
  ...mainDiagnostics,
  ...mainNodes,
  ...mainTerminal,
  ...mainMisc
}

export type MessageKey = keyof typeof MESSAGES

export type { Locale, MessagePair, MessageTable } from './types'
export { LOCALES, LOCALE_LABELS } from './types'

/** 取一条文案；params 替换 `{k}` 占位。缺失键回显键名，便于定位漏配 */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const pair = MESSAGES[key] as MessagePair | undefined
  if (!pair) return String(key)
  let s = locale === 'en' ? pair[1] : pair[0]
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]))
  }
  return s
}
