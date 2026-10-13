import type { AgentEmit } from "./types.js";

/**
 * 把 DeepSeek Harness 的会话事件翻译成画布协议 v6 的事件。
 *
 * 这里刻意做成**无依赖的纯函数**：不碰网络、不读文件，便于单测覆盖，
 * 也把「协议翻译」这一最高风险的逻辑从进程/轮询里隔离出来。
 *
 * 画布侧的 item 词汇沿用历史形态（reasoning / plan / command_execution /
 * dynamic_tool_call …），因此：
 *   - assistant/message 里的 text → agent_message，reasoning → reasoning
 *   - tool/call、tool/result → dynamic_tool_call（画布的通用工具调用形态）
 *   - turn/start、turn/end → codex_state（画布用它驱动「运行中」状态）
 */

/** dsh 会话事件信封：全部事件共用 type/seq/time/data 四段式 */
export type HarnessEvent = {
    type: string;
    seq: number;
    time: number;
    data: Record<string, unknown>;
};

/** 与 AgentEmit 同形状，但要求 payload 是具名记录，便于断言 */
export type HarnessEmission = { type: string; payload: Record<string, unknown> };

/** 这些事件对画布没有展示价值，直接丢弃（避免日志被淹没） */
const IGNORED = new Set([
    "permission/preset",
    "request/header",
    "request/context",
    "model/selection",
    "agent-preset/selected",
    "step/start",
    "step/end",
    "sandbox/mode",
    "compaction/start",
    "llm/retry",
    "llm/retry-started",
]);

/** 从 ContentBlock 数组里挑出某一种块并拼接其文本 */
function blocksOfType(content: unknown, type: "text" | "reasoning"): string {
    if (!Array.isArray(content)) return "";
    return content
        .filter((block): block is { type: string; text: string } => Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === type && typeof (block as { text?: unknown }).text === "string")
        .map((block) => block.text)
        .join("");
}

/** 取消息对象的 content 字段 */
function contentOf(message: unknown): unknown {
    return message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
}

/** 拼出消息里的正文文本（读历史时用） */
export function messageText(message: unknown): string {
    return blocksOfType(contentOf(message), "text");
}

/**
 * 判断 turn/end 的 reason 是否代表失败，并取出可读的错误信息。
 *
 * 实测（dsh 0.2.0-rc.2）：reason 是结构化对象 `{ kind, error? }`，**不是字符串** ——
 * kind 取值来自 TurnEndReasonMap：completed / aborted / blocked / error / max-tokens。
 * 只有 error 与 blocked 属于异常；aborted 是用户主动取消，不该报错。
 * 曾按字符串判断导致真实失败被判为正常，这里按真实形状实现。
 */
export function turnEndFailure(reason: unknown): string | null {
    if (!reason || typeof reason !== "object") return null;
    const { kind, error } = reason as { kind?: unknown; error?: { message?: unknown } };
    if (kind !== "error" && kind !== "blocked") return null;
    const message = typeof error?.message === "string" ? error.message : "";
    return message || `本轮以 ${String(kind)} 结束`;
}

/**
 * 单个 dsh 事件 → 0..n 条画布事件。
 * @param event dsh 会话事件
 * @param threadId 画布侧线程 id（等于 dsh 的 sessionId）
 */
export function mapHarnessEvent(event: HarnessEvent, threadId: string): HarnessEmission[] {
    const { type, seq, data } = event;
    const turn = Number(data.turn) || 0;
    /**
     * 载荷键名必须与画布既有的事件一致：
     *   - 面板用 `data.type` 分发（曾误用 `event`，导致事件被静默丢弃、界面只有「思考中」没有输出）
     *   - 线程/轮的归属用 snake_case 的 thread_id / turn_id（见 session.ts 的 agentEventScope）
     */
    const scope = { thread_id: threadId, ...(turn ? { turn_id: String(turn) } : {}) };

    if (IGNORED.has(type)) return [];

    switch (type) {
        case "turn/start":
            // codex_state 用 camelCase，与 session.ts 的 agentState 形状保持一致
            return [{ type: "codex_state", payload: { ...scope, seq, busy: true, threadId, turnId: String(turn) } }];

        case "turn/end": {
            const out: HarnessEmission[] = [{ type: "codex_state", payload: { ...scope, seq, busy: false, threadId, turnId: "" } }];
            const failure = turnEndFailure(data.reason);
            if (failure) {
                out.push({ type: "agent_error", payload: { ...scope, seq, message: failure } });
            }
            return out;
        }

        case "assistant/message": {
            const message = data.message as { id?: unknown } | undefined;
            const id = String(message?.id || `turn-${turn}-${seq}`);
            const out: HarnessEmission[] = [];
            const reasoning = blocksOfType(contentOf(message), "reasoning");
            if (reasoning) {
                out.push({
                    type: "agent_event",
                    payload: { ...scope, agent: "harness", type: "item.completed", item: { id: `${id}:reasoning`, type: "reasoning", text: reasoning } }
                });
            }
            const text = blocksOfType(contentOf(message), "text");
            if (text) {
                out.push({
                    type: "agent_event",
                    payload: { ...scope, agent: "harness", type: "item.completed", item: { id, type: "agent_message", text } }
                });
            }
            return out;
        }

        case "tool/call": {
            const callId = String(data.callId || `${turn}-${seq}`);
            return [
                {
                    type: "agent_event",
                    payload: {
                        ...scope,
                        agent: "harness",
                        type: "item.started",
                        item: { id: callId, type: "dynamic_tool_call", name: String(data.name || ""), arguments: String(data.arguments || "") }
                    }
                }
            ];
        }

        case "tool/result": {
            const message = data.message as { toolCallId?: unknown } | undefined;
            const callId = String(message?.toolCallId || `${turn}-${seq}`);
            const error = data.error as { reason?: unknown } | undefined;
            const text = blocksOfType(contentOf(message), "text") || (typeof error?.reason === "string" ? error.reason : "");
            return [
                {
                    type: "agent_event",
                    payload: {
                        ...scope,
                        agent: "harness",
                        type: "item.completed",
                        item: { id: callId, type: "dynamic_tool_call", output: text, ...(message && (message as { isError?: unknown }).isError ? { isError: true } : {}) }
                    }
                }
            ];
        }

        default:
            return [];
    }
}

/** 把一批事件顺序翻译并广播出去 */
export function emitHarnessEvents(events: HarnessEvent[], threadId: string, emit: AgentEmit): void {
    for (const event of events) {
        for (const { type, payload } of mapHarnessEvent(event, threadId)) emit(type, payload);
    }
}
