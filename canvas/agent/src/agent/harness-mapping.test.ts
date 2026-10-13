import assert from "node:assert/strict";
import { test } from "node:test";

import { emitHarnessEvents, mapHarnessEvent, turnEndFailure, type HarnessEvent } from "./harness-mapping.js";

const THREAD = "session-abc";

function ev(type: string, data: Record<string, unknown>, seq = 1): HarnessEvent {
    return { type, seq, time: 1700000000000, data };
}

test("turn/start 打开运行态", () => {
    const out = mapHarnessEvent(ev("turn/start", { turn: 3 }), THREAD);
    assert.deepEqual(out, [
        { type: "codex_state", payload: { thread_id: THREAD, turn_id: "3", seq: 1, busy: true, threadId: THREAD, turnId: "3" } }
    ]);
});

test("turn/end 关闭运行态", () => {
    const out = mapHarnessEvent(ev("turn/end", { turn: 3, reason: { kind: "completed" } }), THREAD);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "codex_state");
    assert.equal(out[0].payload.busy, false);
    assert.equal(out[0].payload.turnId, "");
});

test("turn/end 失败原因带出错误信息", () => {
    const out = mapHarnessEvent(ev("turn/end", { turn: 1, reason: { kind: "error", error: { message: "404: model not found", code: "PI_AI_ERROR" } } }), THREAD);
    assert.equal(out.length, 2);
    assert.equal(out[1].type, "agent_error");
    assert.equal(out[1].payload.message, "404: model not found");
});

test("turnEndFailure 只把 error/blocked 当异常", () => {
    // 回归护栏：reason 是对象而非字符串（曾按字符串判断，真实失败被误判为正常）
    assert.equal(turnEndFailure({ kind: "completed" }), null);
    assert.equal(turnEndFailure({ kind: "aborted" }), null);
    assert.equal(turnEndFailure({ kind: "max-tokens" }), null);
    assert.equal(turnEndFailure("error"), null);
    assert.equal(turnEndFailure(undefined), null);
    assert.equal(turnEndFailure({ kind: "error", error: { message: "炸了" } }), "炸了");
    assert.equal(turnEndFailure({ kind: "error" }), "本轮以 error 结束");
    assert.equal(turnEndFailure({ kind: "blocked" }), "本轮以 blocked 结束");
});

test("assistant/message 拆出 reasoning 与正文，忽略 tool-call 块", () => {
    const out = mapHarnessEvent(
        ev("assistant/message", {
            turn: 1,
            step: 1,
            message: {
                id: "msg-1",
                role: "assistant",
                content: [
                    { type: "reasoning", text: "先想一下" },
                    { type: "text", text: "答案在这里" },
                    { type: "tool-call", id: "call-1", name: "read_file", arguments: "{}" }
                ]
            }
        }),
        THREAD
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].payload.agent, "harness");
    assert.deepEqual((out[0].payload.item as Record<string, unknown>).type, "reasoning");
    assert.equal((out[0].payload.item as Record<string, unknown>).text, "先想一下");
    assert.deepEqual((out[1].payload.item as Record<string, unknown>).type, "agent_message");
    assert.equal((out[1].payload.item as Record<string, unknown>).text, "答案在这里");
});

test("assistant/message 无正文时不出事件", () => {
    const out = mapHarnessEvent(
        ev("assistant/message", { turn: 1, step: 1, message: { id: "m", role: "assistant", content: [{ type: "tool-call", id: "c", name: "x", arguments: "{}" }] } }),
        THREAD
    );
    assert.deepEqual(out, []);
});

test("tool/call 映射为 dynamic_tool_call 的 started", () => {
    const out = mapHarnessEvent(ev("tool/call", { turn: 1, step: 1, callId: "call-9", name: "canvas_get_state", arguments: '{"a":1}' }), THREAD);
    assert.equal(out.length, 1);
    assert.equal(out[0].payload.type, "item.started");
    assert.deepEqual(out[0].payload.item, {
        id: "call-9",
        type: "dynamic_tool_call",
        name: "canvas_get_state",
        arguments: '{"a":1}'
    });
});

test("tool/result 映射为 dynamic_tool_call 的 completed，并带出错误标记", () => {
    const out = mapHarnessEvent(
        ev("tool/result", {
            turn: 1,
            step: 1,
            message: { role: "tool", toolCallId: "call-9", content: [{ type: "text", text: "ok" }], isError: true },
            error: { name: "E", code: "X", reason: "失败了" }
        }),
        THREAD
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].payload.type, "item.completed");
    const item = out[0].payload.item as Record<string, unknown>;
    assert.equal(item.id, "call-9");
    assert.equal(item.output, "ok");
    assert.equal(item.isError, true);
});

test("tool/result 无文本时退化为 error.reason", () => {
    const out = mapHarnessEvent(
        ev("tool/result", { turn: 1, step: 1, message: { role: "tool", toolCallId: "c", content: [] }, error: { name: "E", code: "X", reason: "崩了" } }),
        THREAD
    );
    assert.equal((out[0].payload.item as Record<string, unknown>).output, "崩了");
});

test("已知但无展示价值的事件与未知事件都静默丢弃", () => {
    assert.deepEqual(mapHarnessEvent(ev("step/start", { turn: 1, step: 1 }), THREAD), []);
    assert.deepEqual(mapHarnessEvent(ev("permission/preset", { preset: "workspace-write" }), THREAD), []);
    assert.deepEqual(mapHarnessEvent(ev("some/future-event", { x: 1 }), THREAD), []);
});

test("emitHarnessEvents 按序广播 translate 结果", () => {
    const seen: Array<{ type: string; payload: unknown }> = [];
    emitHarnessEvents(
        [ev("turn/start", { turn: 1 }, 1), ev("assistant/message", { turn: 1, step: 1, message: { id: "m", content: [{ type: "text", text: "hi" }] } }, 2), ev("turn/end", { turn: 1, reason: { kind: "completed" } }, 3)],
        THREAD,
        (type, payload) => seen.push({ type, payload })
    );
    assert.deepEqual(
        seen.map((s) => s.type),
        ["codex_state", "agent_event", "codex_state"]
    );
});
