import { spawn } from "node:child_process";

import { loadConfig } from "../config.js";
import { logger } from "./logger.js";

/** 在用户默认浏览器中打开指定链接。 */
export function openUrlInBrowser(targetUrl: string) {
    logger.info("Opening URL in system browser", { url: targetUrl });
    try {
        if (process.platform === "darwin") {
            spawn("open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
        } else if (process.platform === "win32") {
            spawn("cmd.exe", ["/c", "start", '""', targetUrl], { detached: true, stdio: "ignore" }).unref();
        } else {
            spawn("xdg-open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
        }
        return true;
    } catch (error) {
        logger.error("Failed to open browser", { error });
        return false;
    }
}

/**
 * 宿主是否为「画布内嵌」的桌面应用（由主进程注入 CANVAS_EMBEDDED=1）。
 * 内嵌时画布就在应用界面里，绝不能去开系统浏览器。
 */
function isEmbedded() {
    return process.env.CANVAS_EMBEDDED === "1" || process.env.CANVAS_EMBEDDED === "true";
}

/**
 * 打开 Infinite Canvas 画布并附带 Agent 连接凭据。
 *
 * 注意：默认地址是**官方线上站点**（canvas.imihoo.com）。在 ComfyUI 桌面管家里画布是内嵌的，
 * 一旦走这里就会把用户莫名其妙带到线上站点（曾实测：dsh 里说「操作画布」，浏览器弹出
 * https://canvas.imihoo.com/canvas/xxx?mode=new）。因此内嵌场景只回报可用状态，不开浏览器；
 * 独立使用（npx @zhuyichuan/canvas-agent）时行为不变，显式传 url 亦可覆盖。
 */
export function openCanvasInBrowser(options: { mode?: "new" | "recent" | "choose"; url?: string } = {}) {
    const config = loadConfig(true);
    const mode = options.mode || "new";
    if (isEmbedded() && !options.url) {
        return {
            ok: true,
            url: "",
            embedded: true,
            mode,
            message: "画布已内嵌在本应用的「无限画布」中，无需外部浏览器；请直接在本应用的画布上操作。",
        };
    }
    const base = options.url || process.env.CANVAS_WEB_URL || process.env.CANVAS_URL || "https://canvas.imihoo.com";
    const cleanBase = base.replace(/\/+$/, "");
    const targetUrl = `${cleanBase}/canvas?mode=${encodeURIComponent(mode)}#agentUrl=${encodeURIComponent(config.url)}&agentToken=${encodeURIComponent(config.token)}`;
    const opened = openUrlInBrowser(targetUrl);
    return {
        ok: opened,
        url: targetUrl,
        mode,
        message: opened ? `已在系统浏览器中打开 Infinite Canvas 画布（模式：${mode}）` : "打开浏览器失败，请手动访问链接",
    };
}
