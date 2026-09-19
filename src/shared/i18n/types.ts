/**
 * i18n 基础类型：主进程与渲染层共用，保持零框架依赖（渲染层再包一层响应式 ref）。
 */

/** 支持的语言 */
export type Locale = 'zh' | 'en'

/** 一条文案：[中文, English] */
export type MessagePair = readonly [string, string]

/** 一个模块的文案表（键 → [中文, English]） */
export type MessageTable = Record<string, MessagePair>

export const LOCALES: readonly Locale[] = ['zh', 'en']

/** 语言的中文/英文显示名（语言切换入口用，两语一致，故不放进文案表） */
export const LOCALE_LABELS: Record<Locale, string> = { zh: '中文', en: 'English' }
