/**
 * 桌面管家（comfyui-desk）内嵌注入的 ComfyUI 地址。
 * 管家以 `canvas://app/?comfyuiUrl=http://127.0.0.1:PORT` 打开本画布时，
 * 通过该查询参数把实际运行的 ComfyUI 端口注入进来；浏览器直开时无此参数，走默认配置。
 */

let cachedOverride: string | null | undefined;

export function comfyuiUrlOverride(): string | null {
    if (cachedOverride !== undefined) return cachedOverride;
    const raw = new URLSearchParams(window.location.search).get("comfyuiUrl");
    cachedOverride = raw && /^https?:\/\//i.test(raw.trim()) ? raw.trim() : null;
    return cachedOverride;
}
