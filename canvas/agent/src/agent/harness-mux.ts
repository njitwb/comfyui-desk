import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import { logger } from "../utils/logger.js";

/**
 * dsh 的 `$events` 逻辑流客户端（仅用于工具调用审批）。
 *
 * 为什么必须走 WebSocket：答复审批用的是 HTTP 一元端点 `POST /api/$events/result`，但它必须带
 * `clientId`（每条 `$events` 流建立时下发）和 `eventId`（每个待决 waterfall 事件），
 * 这两个值只由 dsh 的 `/api/remote.mux` WebSocket 上的 `$events` 逻辑流给出。
 *
 * 协议（实测 + 源码确认，dsh 0.2.0-rc.2）：
 *   1) 连 `ws://127.0.0.1:<port>/api/remote.mux`，握手带会话 cookie（同 HTTP 那套）。
 *      dsh 的握手鉴权（isTrustedApiRequest）要求 Host 是 loopback，且**没有 Origin 头就放行**
 *      —— Node 客户端正好不发 Origin。
 *   2) 发 `{type:"open",streamId,endpoint:"$events",payload:{args:{}}}`
 *   3) 收 `{type:"item",streamId,value}`，value 依次是：
 *        {type:"ready",clientId,host}            → 记下 clientId
 *        {type:"waterfall",event,eventId,agentId,request} → 待决事件（审批走这里）
 *        {type:"emit",event,args}                → 通知，无需应答
 *        {type:"cancel",eventId}                 → 该事件已被别处答掉
 *   4) 答复：HTTP `POST /api/$events/result`，args `{clientId,eventId,outcome}`
 *
 * 关键语义（Host 侧是「广播给所有客户端、先答者胜」）：
 *   - 画布和 Harness 标签页各拿一份，**谁先点谁生效**，另一侧会收到 cancel 自动收起。
 *   - 我们**不接管**的事件必须立刻回 `outcome:{kind:"next"}`（表示「交给下一个应答者」），
 *     否则会一直占着这条投递。
 *   - 我们接管的审批（approval/request）**故意不回**，挂起等用户在画布上点。
 */

/** 一次待决审批（waterfall 帧 request 的 JSON 安全子集） */
export type HarnessApprovalRequest = {
    /** gateway 侧待决事件 id，答复时原样回传 */
    eventId: string;
    toolName: string;
    callId?: string;
    reason?: string;
    displayReason?: string;
};

/** 画布能给出的决定：accept→allowed-once，decline→rejected */
export type HarnessApprovalDecision = "accept" | "decline";

type MuxHooks = {
    /** 收到并接管了一次审批请求 */
    onApproval: (request: HarnessApprovalRequest) => void;
    /** 某次审批已了结（别处答掉 / 连接丢失），画布应收起卡片 */
    onSettled: (eventId: string) => void;
    /** 提交事件结果（走 HTTP 一元调用） */
    submit: (args: { clientId: string; eventId: string; outcome: Record<string, unknown> }) => Promise<void>;
};

/** 断线重连间隔（dsh 一般不会断，除非 dsh 重启） */
const RECONNECT_DELAY_MS = 3000;

export class HarnessApprovalMux {
    private socket: WebSocket | null = null;
    private clientId = "";
    private running = false;
    private retry: NodeJS.Timeout | null = null;
    /** 已接管、等待用户在画布上决定的审批 */
    private readonly pending = new Map<string, HarnessApprovalRequest>();

    constructor(private readonly url: string, private readonly cookie: string, private readonly hooks: MuxHooks) {}

    /** 是否已就绪（拿到 clientId 才能答复） */
    get ready() {
        return this.socket?.readyState === WebSocket.OPEN && Boolean(this.clientId);
    }

    start() {
        if (this.running) return;
        this.running = true;
        logger.info("Harness approval mux connecting", { url: this.url });
        this.connect();
    }

    /** 停用：先把挂起的审批交还给其他应答者，再断开 */
    async stop() {
        if (!this.running) return;
        this.running = false;
        if (this.retry) {
            clearTimeout(this.retry);
            this.retry = null;
        }
        await this.handBackPending();
        this.teardown();
        logger.info("Harness approval mux stopped");
    }

    /**
     * 提交一个挂起审批的决定。
     * @returns 是否确实有这个挂起项（已被别处答掉时返回 false）
     */
    async decide(eventId: string, decision: HarnessApprovalDecision): Promise<boolean> {
        if (!this.pending.has(eventId)) return false;
        if (!this.clientId) throw new Error("审批通道尚未就绪，请稍后重试");
        const outcome = { kind: "result", value: decision === "accept" ? "allowed-once" : "rejected" };
        await this.hooks.submit({ clientId: this.clientId, eventId, outcome });
        this.settle(eventId);
        return true;
    }

    private connect() {
        if (!this.running) return;
        let socket: WebSocket;
        try {
            socket = new WebSocket(this.url, { headers: { cookie: this.cookie } });
        } catch (error) {
            logger.warn("Harness approval mux socket create failed", { error: error instanceof Error ? error.message : String(error) });
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;
        socket.on("open", () => {
            this.clientId = "";
            socket.send(JSON.stringify({ type: "open", streamId: randomUUID(), endpoint: "$events", payload: { args: {} } }));
        });
        socket.on("message", (data) => this.receive(String(data)));
        socket.on("error", (error) => {
            logger.warn("Harness approval mux socket error", { error: error instanceof Error ? error.message : String(error) });
        });
        socket.on("close", () => this.onLost());
    }

    private receive(text: string) {
        let frame: { type?: string; value?: Record<string, unknown> };
        try {
            frame = JSON.parse(text) as typeof frame;
        } catch {
            return;
        }
        if (frame.type === "end" || frame.type === "error") {
            // 逻辑流结束：clientId 失效，挂起项作废，重连拿一批新的
            this.onLost();
            return;
        }
        if (frame.type !== "item" || !frame.value || typeof frame.value !== "object") return;
        const value = frame.value;
        if (value.type === "ready") {
            this.clientId = String(value.clientId || "");
            logger.info("Harness approval mux ready", { clientId: this.clientId });
            return;
        }
        if (value.type === "cancel") {
            this.settle(String(value.eventId || ""));
            return;
        }
        if (value.type !== "waterfall") return;
        const eventId = String(value.eventId || "");
        // 只接管审批；其余 waterfall 事件立刻交还，避免占住投递
        if (value.event !== "approval/request" || !eventId) {
            void this.answerNext(eventId);
            return;
        }
        const request = (value.request || {}) as Record<string, unknown>;
        const approval: HarnessApprovalRequest = {
            eventId,
            toolName: String(request.toolName || ""),
            callId: typeof request.callId === "string" ? request.callId : undefined,
            reason: typeof request.reason === "string" ? request.reason : undefined,
            displayReason: typeof request.displayReason === "string" ? request.displayReason : undefined
        };
        this.pending.set(eventId, approval);
        this.hooks.onApproval(approval);
    }

    /** 交还一个事件（我们不处理） */
    private async answerNext(eventId: string) {
        if (!eventId || !this.clientId) return;
        try {
            await this.hooks.submit({ clientId: this.clientId, eventId, outcome: { kind: "next" } });
        } catch (error) {
            logger.debug("Harness approval mux handback failed", { eventId, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /** 连接丢失：clientId 随之失效，挂起项已无法答复，只能通知画布收起 */
    private onLost() {
        const had = this.pending.size > 0;
        for (const eventId of [...this.pending.keys()]) this.settle(eventId);
        this.clientId = "";
        this.teardown();
        if (had) logger.warn("Harness approval mux lost connection with pending approvals");
        this.scheduleReconnect();
    }

    private scheduleReconnect() {
        if (!this.running || this.retry) return;
        this.retry = setTimeout(() => {
            this.retry = null;
            this.connect();
        }, RECONNECT_DELAY_MS);
        this.retry.unref?.();
    }

    /** 停用前把挂起审批交还给其他应答者（clientId 仍有效时才行） */
    private async handBackPending() {
        for (const eventId of [...this.pending.keys()]) {
            await this.answerNext(eventId);
            this.settle(eventId);
        }
    }

    private settle(eventId: string) {
        if (!eventId || !this.pending.delete(eventId)) return;
        this.hooks.onSettled(eventId);
    }

    private teardown() {
        const socket = this.socket;
        this.socket = null;
        if (!socket) return;
        socket.removeAllListeners();
        try {
            socket.close();
        } catch {
            /* 已断开 */
        }
    }
}
