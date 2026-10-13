import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { HarnessConversation } from "../agent/harness-session.js";
import { messageText } from "../agent/harness-mapping.js";
import { messageMetadataStore } from "../agent/message-metadata.js";
import { AGENT_PROTOCOL_VERSION, CanvasSession } from "../canvas/session.js";
import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { checkVersions } from "../version-check.js";

/** 启动仅监听本机的 Canvas Agent HTTP 服务。 */
export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const initialWorkspace = ensureSiteWorkspace(config);
    const session = new CanvasSession(initialWorkspace.activeThreadId || "");
    /** 将 Agent 事件广播到所属线程或全部网页。 */
    const emit = (type: string, payload: unknown) => {
        const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
        const scope = session.agentBusy ? session.agentEventScope : { threadId: "", turnId: "", sourceClientId: "" };
        const threadId = String(value.threadId || value.thread_id || scope.threadId || ensureSiteWorkspace(config).activeThreadId || "");
        const turnId = String(value.turnId || value.turn_id || scope.turnId || "");
        const sourceClientId = String(value.sourceClientId || scope.sourceClientId || "");
        const data = {
            ...value,
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(turnId ? { turnId, turn_id: turnId } : {}),
            ...(sourceClientId ? { sourceClientId } : {}),
        };
        session.trackAgentEvent(type, data);
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    /** 保存并广播当前站点工作空间的活跃线程。 */
    const setActiveThread = (activeThreadId: string, payload: Record<string, unknown> = {}, preserveConversation = false) => {
        const workspace = updateSiteWorkspace(config, { activeThreadId: activeThreadId || undefined });
        if (!preserveConversation) session.activateConversation(activeThreadId, String(payload.sourceClientId || "") || undefined);
        if (!session.agentBusy && session.agentThreadId !== activeThreadId) session.setAgentState({ threadId: activeThreadId, turnId: "" });
        session.emitThread("workspace_changed", activeThreadId, { ...payload, activeThreadId, conversation: session.conversationStateSnapshot });
        return workspace;
    };
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        if (!logger.enabled) return next();
        const startedAt = Date.now();
        const url = requestUrl(req, config);
        res.on("finish", () => {
            if (req.method === "OPTIONS" || (res.statusCode < 400 && ["/health", "/canvas/state", "/canvas/activate"].includes(url.pathname))) return;
            logger.debug(`HTTP ${req.method} ${url.pathname}`, { status: res.statusCode, durationMs: Date.now() - startedAt });
        });
        next();
    });
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => {
        session.openEvents(requestUrl(req, config), res, ensureSiteWorkspace(config).activeThreadId || "");
    });
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/activate", (req, res) => {
        session.activateClient(String(req.query.clientId || ""));
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        const ok = session.resolveResult(String(req.query.clientId || ""), req.body);
        res.status(ok ? 200 : 409).json({ ok });
    });
    app.get("/agent/attachments/:attachmentId", route(async (req, res) => {
        const attachment = session.getTurnAttachment(String(req.query.clientId || ""), routeParam(req.params.attachmentId));
        const data = attachment.dataUrl.split(",", 2)[1];
        if (!data) throw new Error("图片附件内容无效");
        res.setHeader("Cache-Control", "no-store");
        res.type(attachment.type).send(Buffer.from(data, "base64"));
    }));
    app.get("/agent/message-assets/:messageKey/:assetFile", route(async (req, res) => {
        const asset = await messageMetadataStore.readAsset(routeParam(req.params.messageKey), routeParam(req.params.assetFile));
        if (!asset) return void res.status(404).json({ ok: false, error: "message asset not found" });
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.type(asset.contentType).send(asset.data);
    }));
    app.post("/agent/local-file/reveal", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath)) return res.status(400).json({ ok: false, error: "文件路径必须是绝对路径" });
        const file = await stat(filePath);
        await revealLocalFile(filePath, file.isDirectory());
        res.json({ ok: true });
    }));
    app.post("/agent/local-image", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(filePath)) return res.status(400).json({ ok: false, error: "图片路径无效" });
        const file = await stat(filePath);
        if (!file.isFile()) return res.status(400).json({ ok: false, error: "图片文件无效" });
        res.setHeader("Cache-Control", "no-store");
        res.type(path.extname(filePath)).send(await readFile(filePath));
    }));
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));

    // ---- harness（DeepSeek Harness）后端 ----
    // 与「Harness」标签共用同一个 dsh 进程（进程由桌面管家托管），所以两边看到的是同一份会话。
    // 事件由 harness-mapping 翻成画布已有的 agent_event 词汇，前端渲染逻辑无需重写。
    const harness = new HarnessConversation(emit, ensureSiteWorkspace(config).workspacePath, {
        // 本轮结束把会话收回可发送状态。
        // 不能用 completeConversationPreparation：它要求 MCP 清单已完成且 infinite-canvas 为 ready，
        // 会把 harness 判成 preparing 甚至 failed，界面就一直停在运行中；
        // completeConversationMcpInventory 又只在 status === "preparing" 时才做事，此刻是 running，同样无效。
        // activateConversation 直接把状态置 ready，且 conversationId 仍是同一个 threadId（等于幂等）。
        onTurnEnd: (threadId) => {
            session.activateConversation(threadId);
        }
    });

    // 网页断开时注销它的审批监视登记（否则 mux 会一直替一个已关闭的面板接管审批）
    session.onClientGone = (clientId) => harness.watchApprovals(clientId, false);

    /** 画布线程列表形状 */
    const harnessThreads = async () =>
        (await harness.listThreads()).map((item) => ({
            id: item.sessionId,
            preview: String(item.projections?.values?.title || ""),
            name: item.projections?.values?.title || null,
            cwd: item.cwd || "",
            status: item.running ? "running" : "idle",
            updatedAt: item.updatedAt
        }));

    app.get("/agent/harness/state", (_req, res) => res.json({ ok: true, state: harness.snapshot }));
    app.get("/agent/harness/models", route(async (_req, res) => res.json({ ok: true, data: await harness.listModels() })));
    /**
     * 列出 dsh 侧已加载的技能（只读）。
     *
     * dsh 没有技能的增删改远程方法 —— 技能是磁盘上的 SKILL.md 文件（项目级在
     * <projectRoot>/.dsh/skills 或 .agents/skills，用户级在 $DSH_HOME/skills 等），
     * 由 dsh 的 skill 提供者扫描。这里只做展示，配合画布在提示词里插入 $skill-name 调用。
     */
    app.get("/agent/harness/skills", route(async (_req, res) => {
        const workspace = ensureSiteWorkspace(config).workspacePath;
        const skills = await harness.listSkills();
        res.json({
            ok: true,
            data: skills.map((skill) => ({
                name: skill.name,
                description: skill.description,
                shortDescription: skill.whenToUse || null,
                path: skill.path || "",
                scope: skill.path && path.resolve(skill.path).startsWith(workspace) ? "repo" : "user",
                enabled: true,
                managed: false
            })),
            errors: []
        });
    }));
    app.get("/agent/harness/threads", route(async (_req, res) => res.json({ ok: true, data: await harnessThreads() })));
    app.post("/agent/harness/threads/reset", route(async (req, res) => {
        harness.dispose();
        const sessionId = await harness.ensureSession();
        session.completeConversationPreparation(sessionId);
        setActiveThread(sessionId, { sourceClientId: String(req.body?.clientId || "") });
        res.json({ ok: true, threadId: sessionId, conversation: session.conversationStateSnapshot });
    }));
    app.post("/agent/harness/turn", route(async (req, res) => {
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起任务的网页已断开，请重新连接后再试" });
        const messageId = String(req.body?.messageId || Date.now());
        const messageText = String(req.body?.messageText || prompt);
        session.bindClient(clientId);
        const sessionId = await harness.ensureSession();
        session.markConversationRunning(sessionId);
        // 先把用户这条广播进聊天流，画布据此对齐乐观回显
        session.emitThread("chat_message", sessionId, {
            sourceClientId: clientId,
            message: {
                id: `${sessionId}:pending:synthetic:user`,
                itemId: "synthetic:user",
                clientMessageId: messageId,
                threadId: sessionId,
                turnId: "",
                role: "user",
                text: messageText
            }
        });
        await harness.send(prompt, messageId);
        res.json({ ok: true, threadId: sessionId, conversation: session.conversationStateSnapshot });
    }));
    app.post("/agent/harness/interrupt", route(async (_req, res) => {
        await harness.interrupt();
        res.json({ ok: true });
    }));
    /**
     * 画布内提交审批决定。
     *
     * 决定会经审批 mux（dsh 的 `$events` 流）回传到 dsh 的 `POST /api/$events/result`；
     * 与「Harness」标签页是「先答者胜」——谁先点谁生效，另一侧自动收起。
     */
    app.post("/agent/harness/approval", route(async (req, res) => {
        const requestId = String(req.body?.requestId || "");
        const raw = String(req.body?.decision || "");
        if (!requestId) return res.status(400).json({ ok: false, error: "缺少 requestId" });
        // dsh 只有 allowed-once / rejected；接受（一次性或本会话）都落到 allowed-once
        await harness.decideApproval(requestId, raw === "decline" ? "decline" : "accept");
        res.json({ ok: true });
    }));
    /** 画布面板打开/关闭时登记：只有有监视者时才由画布接管审批 */
    app.post("/agent/harness/approvals/watch", route(async (req, res) => {
        harness.watchApprovals(String(req.body?.clientId || ""), Boolean(req.body?.enabled));
        res.json({ ok: true });
    }));

    /** dsh 事件 → 画布聊天条目（历史渲染用） */
    const harnessMessages = (threadId: string, events: Array<{ type: string; data: Record<string, unknown> }>) =>
        events.flatMap(({ type, data }, index) => {
            if (type !== "user/message" && type !== "assistant/message") return [];
            // 形状差异（见 dsh 的 SessionEventMap）：user/message 的 data 就是 UserMessage 本身，
            // assistant/message 才是 { turn, step, message }。早先统一读 data.message，
            // 结果所有用户消息都被丢弃，历史里只剩助手输出 —— 表现为「用户输入显示在输出下面」。
            const message = (type === "user/message" ? data : data.message) as { id?: unknown; source?: { kind?: unknown } } | undefined;
            // user/message 里夹带一份运行期上下文快照，只展示真正由用户输入的那条
            if (type === "user/message" && message?.source?.kind !== "user") return [];
            const text = messageText(message);
            if (!text) return [];
            const id = String(message?.id || `${threadId}:${index}`);
            return [{ id, itemId: id, threadId, turnId: String(data.turn ?? ""), role: type === "user/message" ? "user" : "assistant", text }];
        });

    app.get("/agent/harness/threads/:threadId", route(async (req, res) => {
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, thread: { id: threadId }, messages: harnessMessages(threadId, await harness.readSession(threadId)), conversation: session.conversationStateSnapshot });
    }));
    app.post("/agent/harness/threads/:threadId/resume", route(async (req, res) => {
        const threadId = routeParam(req.params.threadId);
        harness.attach(threadId);
        session.completeConversationPreparation(threadId);
        setActiveThread(threadId, { sourceClientId: String(req.body?.clientId || "") });
        res.json({ ok: true, thread: { id: threadId }, messages: harnessMessages(threadId, await harness.readSession(threadId)), conversation: session.conversationStateSnapshot });
    }));
    app.post("/agent/harness/threads/:threadId/delete", route(async (req, res) => {
        // dsh 的 session 控制器没有删除方法，「删除」= workspace 归档
        await harness.archive(routeParam(req.params.threadId));
        res.json({ ok: true });
    }));

    /**
     * harness 后端启动引导（异步，不阻塞路由注册）。
     * 必须把画布的 workspace.activeThreadId / conversation.threadId 换成 dsh 会话 id：
     * 这两个值会被持久化，重启后若仍是上一次留下的线程 id，面板就会用它过滤事件
     * （isCurrentThreadEvent 要求 threadId 非空且相等）并去 dsh 查不存在的会话 ——
     * 表现就是「打开面板报错、发消息后一直卡在思考且没有输出」。
     */
    void (async () => {
        try {
            const sessionId = await harness.bootstrap();
            setActiveThread(sessionId, {});
            session.activateConversation(sessionId);
            logger.info("Harness backend bootstrapped", { sessionId });
        } catch (error) {
            logger.warn("Harness backend bootstrap failed", { error: error instanceof Error ? error.message : String(error) });
        }
    })();

    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
        logger.error("HTTP request failed", { method: _req.method, path: _req.path, error });
        res.status(500).json({ ok: false, error: error.message });
    });

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        checkVersions();
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Canvas MCP: npx -y @zhuyichuan/canvas-agent mcp");
        if (logger.enabled) console.log(`Debug log: ${logger.filePath}`);
        logger.info("Canvas Agent started", { url: config.url, workspace: ensureSiteWorkspace(config).workspacePath, debugLog: logger.filePath });
    });
}

/** 将异步 Express 路由异常交给统一错误处理中间件。 */
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

/** 从 Express 路由参数中读取单个字符串。 */
function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

/** 使用当前操作系统的文件管理器定位本地文件。 */
function revealLocalFile(filePath: string, isDirectory: boolean) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const args = process.platform === "darwin"
        ? ["-R", filePath]
        : process.platform === "win32"
            ? [isDirectory ? filePath : `/select,${filePath}`]
            : [isDirectory ? filePath : path.dirname(filePath)];
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
        child.once("error", reject);
    });
}

/** 结合服务配置解析当前请求 URL。 */
function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

/** 设置跨域响应头并记录通过 token 授权的来源。 */
function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

/** 校验请求查询参数或请求头中的连接 token。 */
function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}
