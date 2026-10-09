import i18n from "@/i18n";
import { changeAppLocale, type AppLocale } from "@/i18n";
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

declare global {
    interface Window {
        comfyuiDeskBridge?: {
            onAppearance: (cb: (data: DeskAppearance) => void) => void;
            sendAppearance: (data: DeskAppearance) => void;
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
