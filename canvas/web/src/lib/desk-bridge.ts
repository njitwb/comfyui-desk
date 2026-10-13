import i18n from "@/i18n";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * 与桌面管家（comfyui-desk）的联动桥：主题 + 语言双向同步。
 * 桥本体由 webview 预加载脚本（resources/canvas-preload.cjs）暴露到 window.comfyuiDeskBridge：
 *   桌面管家 → 画布:  onAppearance（webview.send → ipcRenderer.on）
 *   画布 → 桌面管家:  sendAppearance（ipcRenderer.sendToHost → 宿主 ipc-message 事件）
 * 初始值由桌面在 URL ?theme=/?lang= 注入，index.html 首帧写入 localStorage。
 */

export interface DeskAppearance {
    theme: "light" | "dark";
    locale: "zh" | "en";
}

/** 桌面管家右侧 Harness（dsh）对话 dock 的开关状态 */
export interface DeskAgentDock {
    open: boolean;
}

declare global {
    interface Window {
        comfyuiDeskBridge?: {
            onAppearance: (cb: (data: DeskAppearance) => void) => void;
            sendAppearance: (data: DeskAppearance) => void;
            toggleAgentDock?: () => void;
            onAgentDock?: (cb: (data: DeskAgentDock) => void) => void;
        };
    }
}

/** 注册宿主下发回调（应用主题/语言；仅写入状态，不回调宿主，避免回声） */
export function bindDeskAppearance(): void {
    window.comfyuiDeskBridge?.onAppearance(({ theme, locale }) => {
        if (theme === "light" || theme === "dark") {
            useThemeStore.getState().setTheme(theme);
        }
        const next: AppLocale = locale === "en" ? "en-US" : "zh-CN";
        if (i18n.resolvedLanguage !== next) void changeAppLocale(next);
    });
}

/** 画布内主动切换主题/语言后通知桌面管家（只由用户操作触发，天然防环） */
export function notifyDeskAppearance(overrides?: { theme?: "light" | "dark"; locale?: AppLocale }): void {
    const theme = overrides?.theme ?? useThemeStore.getState().theme;
    const locale = (overrides?.locale ?? (i18n.resolvedLanguage as AppLocale)) === "en-US" ? "en" : "zh";
    window.comfyuiDeskBridge?.sendAppearance({ theme, locale });
}

/**
 * 画布内的 Agent 按钮请求开关对话面板。
 *
 * 运行在桌面管家里时，agent 界面由宿主右侧的 Harness（dsh）dock 承载，这里把开关交给宿主并返回 true，
 * 画布自身不再弹出内置面板；脱离宿主（纯浏览器）时返回 false，调用方回退到内置面板。
 */
export function requestAgentDockToggle(): boolean {
    const bridge = window.comfyuiDeskBridge;
    if (!bridge?.toggleAgentDock) return false;
    bridge.toggleAgentDock();
    return true;
}

/** 订阅宿主 dock 的开关状态，写入 agent store（供工具栏/顶栏的 Agent 按钮高亮） */
export function bindDeskAgentDock(): void {
    window.comfyuiDeskBridge?.onAgentDock?.(({ open }) => useAgentStore.getState().setAgentDockOpen(Boolean(open)));
}
