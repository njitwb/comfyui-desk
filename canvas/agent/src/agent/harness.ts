import fs from "node:fs";

import { logger } from "../utils/logger.js";
import type { HarnessEvent } from "./harness-mapping.js";

/**
 * 与 DeepSeek Harness（dsh）Web 进程通信的客户端。
 *
 * 设计要点（均为实测确认，dsh 0.2.0-rc.2）：
 *   1) 端点由主进程交接：dsh 启动时才把带一次性 token 的 URL 打到 stdout，token 只在主进程手上，
 *      主进程把它写进 DSH_ENDPOINT_FILE 指向的 JSON（{ url, token, port }），这里读取。
 *   2) 认证：GET <url> 返回 303 并下发会话 cookie（HttpOnly / SameSite=Strict），
 *      之后所有 /api 请求都要带该 cookie；Host 必须是 loopback，且不能带 Origin。
 *   3) 传输：一元调用 = POST /api/<namespace>/<method>，body
 *      { type:"client-request", rpcId, method, payload:{ args:{...} } }，
 *      响应 { type:"server-response", rpcId, result:{ ok:true, value } | { ok:false, error } }。
 *      流式：会话历史改用轮询 session/page（避免实现完整的 Typert Remote 多路复用）；
 *      但**转发的应用事件（工具调用审批）必须走 WebSocket** —— 见 harness-mux.ts，
 *      因为答复端点需要的 clientId/eventId 只由 `/api/remote.mux` 的 `$events` 流下发。
 *   4) args 的字段名必须与 dsh 端真实形参名一致（如 list 的形参叫 _request）。
 */

/** 主进程写的端点交接文件内容 */
type HarnessEndpoint = { url: string; token: string; port: number };

/** session/page 返回的一条历史记录 */
type HarnessHistoryRecord = { type: "event"; event: HarnessEvent };

export type HarnessPage = { records: HarnessHistoryRecord[]; hasMore: boolean };

/** session/list 的一行会话摘要 */
export type HarnessSessionSummary = {
    sessionId: string;
    updatedAt: number;
    running: boolean;
    blank: boolean;
    cwd?: string;
    /** asOfSeq 就是会话的事件 cursor，session/page 的 throughSeq 不能超过它 */
    projections?: { kind?: string; asOfSeq?: number; values?: { title?: string | null; tokenUsage?: Record<string, number> } };
};

export type HarnessModelOption = {
    id: string;
    name: string;
    description?: string;
    reasoning?: { efforts?: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string };
};

export type HarnessModelCatalog = {
    default?: { provider: string; model: string };
    routableProviders?: string[];
    groups?: Array<{ id: string; name: string; models?: HarnessModelOption[] }>;
};

/** dsh 侧已加载的技能（远程方法 skills/list） */
export type HarnessSkill = {
    name: string;
    description: string;
    whenToUse?: string;
    modelInvocable?: boolean;
    path?: string;
};

/** dsh 不可用（端点文件缺失 / 握手失败 / 进程已退出） */
export class HarnessUnavailableError extends Error {
    override name = "HarnessUnavailableError";
}

/** 读取端点交接文件；不存在或字段不全返回 null */
export function readHarnessEndpoint(): HarnessEndpoint | null {
    const file = process.env.DSH_ENDPOINT_FILE;
    if (!file) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<HarnessEndpoint>;
        return parsed.url && parsed.token ? { url: parsed.url, token: parsed.token, port: Number(parsed.port) || 0 } : null;
    } catch {
        return null;
    }
}

/**
 * 等 dsh 的端点交接文件出现。
 *
 * 主进程的启动顺序是「先拉起 dsh、再拉起画布伴生服务」，而 dsh 从 spawn 到把带 token 的
 * URL 打印出来（主进程据此写交接文件）约需 1 秒；画布服务就绪更快，界面会在这一秒内就来拉
 * 模型目录 / 会话列表 / 技能。早期实现直接抛错，表现为「面板刚打开就是一串
 * HarnessUnavailableError」。这里给 dsh 一点启动时间，超时才认为是真的没启动。
 */
async function waitForEndpoint(timeoutMs = 15000): Promise<HarnessEndpoint | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const endpoint = readHarnessEndpoint();
        if (endpoint) return endpoint;
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
}

/** 从 Set-Cookie 头里取出 name=value 部分（后续请求直接原样回带） */
function cookiePair(raw: string | null): string {
    if (!raw) return "";
    const first = raw.split(/,(?=[^;]+=)/)[0] || "";
    return first.split(";")[0].trim();
}

/** 已建立凭据的 Typert Remote 通道 */
export class HarnessRpc {
    private constructor(private readonly base: string, private readonly cookie: string) {}

    /** 读取端点文件并完成 token → cookie 换取；任一步失败抛 HarnessUnavailableError */
    static async connect(): Promise<HarnessRpc> {
        const endpoint = await waitForEndpoint();
        if (!endpoint) throw new HarnessUnavailableError("未找到 Harness 端点交接文件（Harness 未启动或已关闭）");
        let res: Response;
        try {
            // 不跟随 303：Set-Cookie 就在这一跳的响应头上
            res = await fetch(endpoint.url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        } catch (error) {
            throw new HarnessUnavailableError(`连接 Harness 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie().join(",") : res.headers.get("set-cookie");
        const cookie = cookiePair(raw);
        if (!cookie) throw new HarnessUnavailableError("Harness 未下发会话 cookie（一次性 token 可能已失效，请重启 Harness）");
        return new HarnessRpc(new URL(endpoint.url).origin, cookie);
    }

    /** 暴露 base/cookie 给 mux：WebSocket 握手与一元调用靠同一套 cookie 认证 */
    credentials(): { base: string; cookie: string } {
        return { base: this.base, cookie: this.cookie };
    }

    /**
     * 提交一个已转发事件（waterfall）的结果。
     *
     * 端点 `/api/$events/result`，args 需带 clientId + eventId + outcome；
     * 这是 dsh 唯一的审批答复通道 —— clientId/eventId 只能从 mux 的 `$events` 流里拿到。
     */
    async submitRemoteEventResult(args: { clientId: string; eventId: string; outcome: Record<string, unknown> }): Promise<void> {
        await this.call("$events/result", args);
    }

    /** 一元 Remote 调用 */
    async call<T>(endpoint: string, args: Record<string, unknown> = {}): Promise<T> {
        const rpcId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        let res: Response;
        try {
            res = await fetch(`${this.base}/api/${endpoint}`, {
                method: "POST",
                headers: { "content-type": "application/json", cookie: this.cookie },
                body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload: { args } }),
                signal: AbortSignal.timeout(30000)
            });
        } catch (error) {
            throw new HarnessUnavailableError(`调用 Harness ${endpoint} 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        if (!res.ok) throw new HarnessUnavailableError(`调用 Harness ${endpoint} 失败：HTTP ${res.status}`);
        const body = (await res.json()) as {
            result?: { ok?: boolean; value?: unknown; error?: { message?: string } };
        };
        const result = body.result;
        if (!result?.ok) throw new Error(`Harness ${endpoint} 返回错误：${result?.error?.message || "未知错误"}`);
        return result.value as T;
    }

    // ---- 以下为 session 命名空间的具体方法，args 字段名与 dsh 形参名一致 ----

    /** 列出会话（形参名是 _request） */
    async listSessions(): Promise<{ items: HarnessSessionSummary[] }> {
        return await this.call("session/list", { _request: {} });
    }

    /** 建会话并返回其 id */
    async createSession(cwd: string): Promise<string> {
        const value = await this.call<{ sessionId: string }>("session/create", { request: { cwd } });
        return value.sessionId;
    }

    /**
     * 读一页会话历史（message-aligned，冷安全）。
     *
     * throughSeq 是**含端**日志截断（dsh 的 `Inclusive log cut`）：只返回 seq ≤ throughSeq 的事件。
     * 传一个足够大的值即「读到最新」；传 0 只会拿到 seq 0 那条（曾经踩过这个坑）。
     */
    async pageSession(sessionId: string, throughSeq = Number.MAX_SAFE_INTEGER, maxMessages = 200): Promise<HarnessPage> {
        return await this.call("session/page", {
            request: { address: { kind: "session", sessionId }, throughSeq, maxMessages }
        });
    }

    /** 向会话投递一条用户消息；返回入队回执 */
    async promptSession(sessionId: string, text: string, requestId: string): Promise<void> {
        await this.call("session/prompt", {
            request: {
                requestId,
                sessionId,
                mode: "queue",
                content: [{ type: "text", text }]
            }
        });
    }

    /** 取消会话当前正在跑的 turn（不清空待处理队列） */
    async cancelSession(sessionId: string): Promise<void> {
        await this.call("session/cancel", { request: { sessionId } });
    }

    /** 当前可用模型目录（无参） */
    async modelCatalog(): Promise<HarnessModelCatalog> {
        return await this.call("session/modelCatalog", {});
    }

    /** 列出该会话可见的技能（形参名 request） */
    async listSkills(sessionId: string): Promise<HarnessSkill[]> {
        const value = await this.call<{ skills?: HarnessSkill[] }>("skills/list", { request: { sessionId } });
        return value.skills || [];
    }

    /**
     * 归档会话。
     *
     * dsh 的 session 控制器**没有**删除方法（只有 cancel/create/fork/list/page/prompt/rename/
     * selectModel/search…），「删除会话」由 workspace 命名空间的归档实现。
     * 返回的是**完整的**归档集合（不是增量），可直接用来覆盖本地状态。
     */
    async archiveSession(sessionId: string): Promise<string[]> {
        const value = await this.call<{ archivedSessionIds: string[] }>("workspace/archiveSession", { request: { sessionId } });
        return value.archivedSessionIds || [];
    }

    /** 取消归档（恢复会话） */
    async unarchiveSession(sessionId: string): Promise<string[]> {
        const value = await this.call<{ archivedSessionIds: string[] }>("workspace/unarchiveSession", { request: { sessionId } });
        return value.archivedSessionIds || [];
    }
}

let cached: HarnessRpc | null = null;
/**
 * 进行中的连接。
 * 并发调用必须共享同一次连接：界面刚连上时会同时来拉模型/会话/技能，
 * 没有这个去重就会同时建多条通道（日志里曾出现 3 次重复的「Connected to DeepSeek Harness」）。
 */
let connecting: Promise<HarnessRpc> | null = null;

/** 取已缓存的通道；未建立或已失效时重连 */
export async function harnessRpc(): Promise<HarnessRpc> {
    if (cached) return cached;
    connecting ??= HarnessRpc.connect().then((rpc) => {
        cached = rpc;
        logger.info("Connected to DeepSeek Harness web process");
        return rpc;
    }).finally(() => {
        connecting = null;
    });
    return await connecting;
}

/** 让缓存的通道失效（harness 重启 / 调用失败时调用，下次自动重连） */
export function resetHarnessRpc(): void {
    cached = null;
}
