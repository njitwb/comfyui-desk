import fs from "node:fs";
import path from "node:path";

import { logger } from "../utils/logger.js";
import { emitHarnessEvents } from "./harness-mapping.js";
import { harnessRpc, resetHarnessRpc, type HarnessModelCatalog, type HarnessSessionSummary, type HarnessSkill } from "./harness.js";
import { HarnessApprovalMux, type HarnessApprovalDecision, type HarnessApprovalRequest } from "./harness-mux.js";
import type { AgentEmit } from "./types.js";

/**
 * 画布里的 harness 会话运行时。
 *
 * 与 dsh web 进程的关系：进程本身由桌面管家托管（唯一实例），这里只是它的一个客户端 ——
 * 所以画布面板与 Harness 标签看到的是同一份会话。
 *
 * 取事件的方式是**轮询 session/page**，不是订阅 dsh 的 WebSocket 流（那需要实现它内部的
 * Typert Remote 多路复用协议）。实测要点：
 *   - throughSeq 是含端日志截断，且不能超过会话 cursor；
 *   - cursor 从 session/list 的 projections.asOfSeq 取（本模块每轮先 list 再 page）。
 */

/** 画布面板认得的推理强度取值（dsh 的 off/low/high/max 与之取交集） */
const ALLOWED_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

/** 画布期望的单个模型描述 */
type CanvasModel = {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: string;
    supportedReasoningEfforts: Array<{ reasoningEffort: string; description?: string }>;
};

/** 会话运行时对外快照（与画布既有的运行状态同形状，便于面板复用渲染） */
export type HarnessState = { busy: boolean; threadId: string; turnId: string };

const POLL_INTERVAL_MS = 700;
/** 单轮轮询上限，避免模型挂死时无限轮询 */
const POLL_MAX_MS = 30 * 60 * 1000;

export class HarnessConversation {
    private sessionId = "";
    private busy = false;
    private turnId = "";
    /** 已消费到的事件序号（轮询增量水位） */
    private lastSeq = -1;
    private polling = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * 是否还在等本轮的第一个 turn/start。
     *
     * 必须靠它把「等本轮真正开始」和「本轮已结束」区分开：session/prompt 返回后 dsh 的
     * running 标志与 cursor 都还没动，若此时按 running=false 判定结束就会立刻停掉轮询，
     * 表面上是"发完就结束、没有回复"。（实测踩过：turn 还没开始就被判定结束。）
     */
    private awaitingTurnStart = false;
    private waitingSince = 0;

    private archived = new Set<string>();

    /**
     * 正在「监视审批」的网页。
     *
     * 只有存在监视者（画布面板已打开并连上）才连 mux 接管审批；否则一律留给
     * Harness 标签页，避免「没人在画布上操作、审批却被我们占住」。
     */
    private readonly approvalWatchers = new Set<string>();
    private mux: HarnessApprovalMux | null = null;
    /** mux 已接管、等待画布决定的审批（eventId → 请求），仅用于本地兜底去重 */
    private readonly muxApprovals = new Map<string, HarnessApprovalRequest>();

    constructor(
        private readonly emit: AgentEmit,
        private readonly cwd: string,
        /** 会话生命周期回调：由 http.ts 接到 CanvasSession 上（turn 结束必须把会话置回 ready） */
        private readonly hooks: { onTurnEnd?: (threadId: string) => void } = {}
    ) {
        this.loadArchived();
    }

    /** 归档集合落盘位置：与端点交接文件同目录（画布侧会自己改，dsh 侧不适合存这个） */
    private archiveFile(): string {
        const endpoint = process.env.DSH_ENDPOINT_FILE;
        return endpoint ? path.join(path.dirname(endpoint), "canvas-agent-archived.json") : "";
    }

    /** 读回归档集合：否则应用重启后「删掉的历史对话」会重新出现 */
    private loadArchived(): void {
        try {
            const file = this.archiveFile();
            if (!file || !fs.existsSync(file)) return;
            const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
            if (Array.isArray(parsed)) this.archived = new Set(parsed.filter((item): item is string => typeof item === "string"));
        } catch (error) {
            logger.warn("Harness archived set load failed", { error: error instanceof Error ? error.message : String(error) });
        }
    }

    private saveArchived(): void {
        try {
            const file = this.archiveFile();
            if (file) fs.writeFileSync(file, JSON.stringify([...this.archived]), "utf8");
        } catch (error) {
            logger.warn("Harness archived set save failed", { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * 启动引导：把画布会话绑到 dsh 侧最近的会话（没有就新建）。
     *
     * 必须做这一步：画布的 activeThreadId 会被持久化，重启后若沿用旧的线程 id，
     * 面板就会用它来过滤事件（isCurrentThreadEvent 要求 threadId 非空且相等）并去 dsh 查一个
     * 不存在的会话 —— 表现就是「一开面板就报错、发消息后一直卡在思考且没有输出」。
     */
    async bootstrap(): Promise<string> {
        const rpc = await harnessRpc();
        const { items } = await rpc.listSessions();
        const latest = items.filter((item) => !this.archived.has(item.sessionId)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        this.attach(latest ? latest.sessionId : await rpc.createSession(this.cwd));
        return this.sessionId;
    }

    get snapshot(): HarnessState {
        return { busy: this.busy, threadId: this.sessionId, turnId: this.turnId };
    }

    get currentSessionId(): string {
        return this.sessionId;
    }

    /** 换绑到指定会话（画布切线程 / 启动恢复时用），并重置轮询水位 */
    attach(sessionId: string): void {
        this.sessionId = sessionId;
        this.lastSeq = -1;
        this.busy = false;
        this.turnId = "";
        this.awaitingTurnStart = false;
    }

    private setState(patch: Partial<HarnessState>): void {
        const next = { ...this.snapshot, ...patch };
        if (next.busy === this.busy && next.threadId === this.sessionId && next.turnId === this.turnId) return;
        this.busy = next.busy;
        this.turnId = next.turnId;
        this.emit("harness_state", { busy: this.busy, threadId: this.sessionId, turnId: this.turnId });
    }

    /** 确保有一个可用会话；没有就建一个 */
    async ensureSession(): Promise<string> {
        if (this.sessionId) return this.sessionId;
        const rpc = await harnessRpc();
        this.sessionId = await rpc.createSession(this.cwd);
        logger.info("Harness session created", { sessionId: this.sessionId });
        return this.sessionId;
    }

    /**
     * 已归档的会话 id（落盘持久化，见 loadArchived/saveArchived）。
     *
     * dsh 的 session/list **不会**排除归档会话（SessionSummary 里也没有归档标志），
     * 所以「删除」后必须由我们自己过滤，否则线程列表里点了删除还在。
     * 集合来源是 archive/unarchive 返回的**完整**归档集。
     */
    /** 列出 dsh 侧的会话（画布的线程列表，已滤掉归档的） */
    async listThreads(): Promise<HarnessSessionSummary[]> {
        const rpc = await harnessRpc();
        const { items } = await rpc.listSessions();
        return items.filter((item) => !this.archived.has(item.sessionId));
    }

    /** 归档（画布的「删除」）；若删的是当前会话则一并解绑 */
    async archive(sessionId: string): Promise<void> {
        const rpc = await harnessRpc();
        this.archived = new Set(await rpc.archiveSession(sessionId));
        this.saveArchived();
        if (this.sessionId === sessionId) this.dispose();
    }

    /** 拉模型目录并转成画布形状（只保留画布认得的推理强度） */
    async listModels(): Promise<CanvasModel[]> {
        const rpc = await harnessRpc();
        const catalog: HarnessModelCatalog = await rpc.modelCatalog();
        const preferred = catalog.default?.model || "";
        const out: CanvasModel[] = [];
        for (const group of catalog.groups || []) {
            for (const model of group.models || []) {
                const efforts = (model.reasoning?.efforts || [])
                    .filter((effort) => ALLOWED_EFFORTS.has(effort.id))
                    .map((effort) => ({ reasoningEffort: effort.id, ...(effort.description ? { description: effort.description } : {}) }));
                // 画布会丢弃没有任何可选推理强度的模型，这里同样跳过避免出现空选项
                if (!efforts.length) continue;
                const preferredEffort = model.reasoning?.defaultEffort || "";
                out.push({
                    id: model.id,
                    model: model.id,
                    displayName: model.name || model.id,
                    defaultReasoningEffort: ALLOWED_EFFORTS.has(preferredEffort) ? preferredEffort : efforts[0].reasoningEffort,
                    supportedReasoningEfforts: efforts,
                    ...(model.id === preferred ? { isDefault: true } : {})
                } as CanvasModel);
            }
        }
        return out;
    }

    /** 列出该会话可见的技能（dsh 的 skills/list，只读） */
    async listSkills(): Promise<HarnessSkill[]> {
        const sessionId = await this.ensureSession();
        const rpc = await harnessRpc();
        return await rpc.listSkills(sessionId);
    }

    /** 读一个会话的完整历史（画布切到某个已有线程时用） */
    async readSession(sessionId: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
        const rpc = await harnessRpc();
        const { items } = await rpc.listSessions();
        const summary = items.find((item) => item.sessionId === sessionId);
        // 会话不存在（例如画布保留了上一次运行留下的旧线程 id）：返回空历史，
        // 而不是拿一个不存在的 id 去 page（dsh 会报错，界面就显示成加载失败）
        if (!summary) return [];
        const page = await rpc.pageSession(sessionId, summary.projections?.asOfSeq ?? 0);
        return page.records.map((record) => ({ type: record.event.type, data: record.event.data }));
    }

    /** 发一条用户消息，并开始轮询取回事件 */
    async send(text: string, requestId: string): Promise<string> {
        const sessionId = await this.ensureSession();
        const rpc = await harnessRpc();
        // 发送前先把已有事件消费干净，避免把历史当成本轮新事件重放
        await this.drain(sessionId);
        this.awaitingTurnStart = true;
        this.waitingSince = Date.now();
        this.setState({ busy: true, turnId: "" });
        await rpc.promptSession(sessionId, text, requestId);
        this.startPolling();
        return sessionId;
    }

    /** 取消当前 turn（不清空待处理队列），并把画布从「思考中」立即拉回 */
    async interrupt(): Promise<void> {
        if (!this.sessionId) return;
        const sessionId = this.sessionId;
        // 先停轮询并清忙态：即使 dsh 侧取消失败或不再回事件，界面也不能卡在思考中
        this.finishTurn();
        try {
            const rpc = await harnessRpc();
            await rpc.cancelSession(sessionId);
        } catch (error) {
            this.emit("agent_error", { message: `取消失败：${error instanceof Error ? error.message : String(error)}` });
        }
    }

    /** 结束本轮：停轮询 + 清忙态 + 把会话状态机收回 ready（所有退出路径都必须走这里） */
    private finishTurn(): void {
        const threadId = this.sessionId;
        this.stopPolling();
        this.awaitingTurnStart = false;
        this.setState({ busy: false, turnId: "" });
        // 只发 harness_state 不够：画布的 conversation.status 是我们 markConversationRunning 置成
        // running 的，必须显式收回 ready，否则面板会一直停在「运行中」且输入框不可用。
        if (threadId) this.hooks.onTurnEnd?.(threadId);
    }

    /** 停止轮询（进程退出 / 切换后端时调用） */
    dispose(): void {
        this.stopPolling();
        this.sessionId = "";
        this.lastSeq = -1;
        this.busy = false;
        this.turnId = "";
        this.awaitingTurnStart = false;
    }

    /**
     * 登记/注销一个「审批监视者」（画布面板打开 → true，关闭/断线 → false）。
     * 只有至少一个监视者时才连 mux 接管审批。
     */
    watchApprovals(clientId: string, enabled: boolean): void {
        if (!clientId) return;
        if (enabled) this.approvalWatchers.add(clientId);
        else this.approvalWatchers.delete(clientId);
        void this.syncApprovalMux();
    }

    /** 提交一次画布内的审批决定 */
    async decideApproval(eventId: string, decision: HarnessApprovalDecision): Promise<void> {
        const handled = this.mux ? await this.mux.decide(eventId, decision) : false;
        if (!handled) throw new Error("该审批已失效（可能已在「Harness」标签页处理）");
    }

    /** 按监视者有无，建立或停用审批 mux */
    private async syncApprovalMux(): Promise<void> {
        if (this.approvalWatchers.size > 0) {
            if (this.mux) return;
            try {
                const { base, cookie } = (await harnessRpc()).credentials();
                const mux = new HarnessApprovalMux(`${base.replace(/^http/, "ws")}/api/remote.mux`, cookie, {
                    onApproval: (request) => this.onApprovalRequest(request),
                    onSettled: (eventId) => this.onApprovalSettled(eventId),
                    submit: async (args) => {
                        await (await harnessRpc()).submitRemoteEventResult(args);
                    }
                });
                this.mux = mux;
                mux.start();
            } catch (error) {
                this.mux = null;
                logger.warn("Harness approval mux unavailable", { error: error instanceof Error ? error.message : String(error) });
            }
            return;
        }
        const mux = this.mux;
        this.mux = null;
        if (mux) await mux.stop();
    }

    /** 审批请求：广播到画布（复用既有的 codex_approval 事件词汇与审批卡） */
    private onApprovalRequest(request: HarnessApprovalRequest): void {
        this.muxApprovals.set(request.eventId, request);
        this.emit("codex_approval", {
            thread_id: this.sessionId,
            requestId: request.eventId,
            method: request.toolName,
            reason: request.reason || request.displayReason || ""
        });
    }

    /** 审批了结（别处答掉 / 通道断开）：通知画布收起卡片 */
    private onApprovalSettled(eventId: string): void {
        if (!this.muxApprovals.delete(eventId)) return;
        this.emit("codex_approval_resolved", { thread_id: this.sessionId, requestId: eventId, decision: "cancel" });
    }

    private startPolling(): void {
        if (this.polling) return;
        this.polling = true;
        const deadline = Date.now() + POLL_MAX_MS;
        const tick = async () => {
            if (!this.polling) return;
            try {
                const finished = await this.pollOnce();
                if (finished) {
                    this.finishTurn();
                    return;
                }
            } catch (error) {
                // dsh 可能被重启：让缓存的通道失效，并在下一轮重连
                resetHarnessRpc();
                logger.warn("Harness poll failed", { error: error instanceof Error ? error.message : String(error) });
                this.emit("agent_log", { text: `Harness 轮询失败：${error instanceof Error ? error.message : String(error)}` });
            }
            if (!this.polling) return;
            if (Date.now() > deadline) {
                logger.warn("Harness poll timed out", { sessionId: this.sessionId });
                this.emit("agent_error", { message: "Harness 本轮轮询超时，已标记为结束" });
                this.finishTurn();
                return;
            }
            this.pollTimer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        };
        void tick();
    }

    private stopPolling(): void {
        this.polling = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** 读一次增量事件；返回 true 表示本轮已结束 */
    private async pollOnce(): Promise<boolean> {
        const rpc = await harnessRpc();
        const { items } = await rpc.listSessions();
        const summary = items.find((item) => item.sessionId === this.sessionId);
        if (!summary) return false;
        const cursor = summary.projections?.asOfSeq ?? 0;
        const page = await rpc.pageSession(this.sessionId, cursor);
        let finished = false;
        for (const record of page.records) {
            if (record.event.seq <= this.lastSeq) continue;
            this.lastSeq = record.event.seq;
            if (record.event.type === "turn/start") {
                this.awaitingTurnStart = false;
                this.setState({ busy: true, turnId: String(record.event.data.turn ?? "") });
            }
            if (record.event.type === "turn/end") finished = true;
            emitHarnessEvents([record.event], this.sessionId, this.emit);
        }
        if (finished) {
            this.awaitingTurnStart = false;
            this.setState({ busy: false, turnId: "" });
            return true;
        }
        // 等本轮开始超时：turn/start 迟迟不来，说明提示词没能进入执行（例如被策略挡下）
        if (this.awaitingTurnStart) {
            if (Date.now() - this.waitingSince > 60000) {
                this.awaitingTurnStart = false;
                this.emit("agent_error", { message: "Harness 未能在 60 秒内开始本轮执行" });
                this.setState({ busy: false, turnId: "" });
                return true;
            }
            return false;
        }
        // 已见过 turn/start：dsh 侧不再运行即认为本轮结束。
        // 不再要求 cursor 必须前进 —— 若某轮没产生事件，cursor 不动会让我们永远等下去，
        // 表现就是界面一直卡在「思考中」。
        return !summary.running;
    }

    /** 把已有事件消费到当前水位（不广播），返回当前 cursor；用于发消息前对齐 */
    private async drain(sessionId: string): Promise<number> {
        try {
            const rpc = await harnessRpc();
            const { items } = await rpc.listSessions();
            const cursor = items.find((item) => item.sessionId === sessionId)?.projections?.asOfSeq ?? 0;
            if (cursor > this.lastSeq) {
                const page = await rpc.pageSession(sessionId, cursor);
                for (const record of page.records) if (record.event.seq > this.lastSeq) this.lastSeq = record.event.seq;
            }
            return cursor;
        } catch (error) {
            logger.warn("Harness drain failed", { sessionId, error: error instanceof Error ? error.message : String(error) });
            return this.lastSeq;
        }
    }
}
