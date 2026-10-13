# 本地补丁记录（vendored canvas-agent）

本目录是从上游 [infinite-canvas](https://github.com/ZhuYichuan/infinite-canvas) 的
`canvas-agent/` 拷贝而来的 vendored 源码。为避免"静默偏离上游"，所有本地改动都记录在此，
上游升级重新 vendor 时需按此清单重放。

上游版本：见 `package.json` 的 `version`。

## 1. `src/server/mcp.ts` —— `isServerAlive()` 探活路径修正

- **位置**：`isServerAlive()`（原第 34 行）
- **改动**：`fetch(\`${url}/api/session\`)` → `fetch(\`${url}/health\`)`
- **原因**：上游探测的 `/api/session` 路由在 HTTP 服务（`src/server/http.ts`）中并不存在，
  请求会被鉴权中间件拦下（非 200），导致 `isServerAlive()` 恒为 `false`。
  后果是每次 `canvas_open`（或 `CANVAS_AUTO_START=true`）都会重复 spawn 一个 HTTP 服务进程
  （必然 EADDRINUSE 立刻退出），并空等约 3s 才返回。
- **为何用 `/health`**：`/health` 与 `/config` 在 `setCors()` 中被显式豁免 Origin 与 token 校验
  （见 `src/server/http.ts`），是唯一"无需凭据即可探活"的路由，且返回 `protocolVersion`
  可用于版本一致性告警。
- **影响面**：仅影响 MCP 模式下的服务复用判定；HTTP/SSE 桥接行为不变。

## 2. `src/utils/browser.ts` + `src/canvas/schemas.ts` —— 内嵌场景禁止开系统浏览器

- **改动**：`openCanvasInBrowser()` 增加内嵌判断（读环境变量 `CANVAS_EMBEDDED`）；内嵌且未显式传
  `url` 时直接返回「画布已内嵌」的说明，不再调用 `openUrlInBrowser()`。同时调整 `canvas_open`
  的工具描述。
- **原因**：`openCanvasInBrowser()` 的默认地址是**官方线上站点** `https://canvas.imihoo.com`。
  在桌面管家里画布内嵌在应用界面中，实测出现过「在 Harness 里让 agent 操作画布，系统浏览器却
  弹出 canvas.imihoo.com/canvas/xxx?mode=new」。
- **影响面**：仅当宿主注入 `CANVAS_EMBEDDED=1`（由 `src/main/agent-process.ts` 注入，见
  `nodeEnv()` 与 `buildMcpConfig()`）时生效；独立使用（npx）行为不变，显式传 `url` 亦可覆盖。

## 未改动的部分

其余源码与上游一致。

## 与上游的架构差异（本仓库的后续改动，已超出"补丁"范围）

本仓库已将画布内 agent 收敛为**唯一的 DeepSeek Harness 后端**，与上游的 Codex 后端不同：

- 移除了 Codex 相关源码（`src/agent/codex*.ts`），以及 `/agent/codex/*`、`/agent/workbuddy/*` 路由；
  不再依赖 `@openai/codex` 及其平台二进制（原先约 300MB）。
- 新增 harness 后端：`src/agent/harness.ts`（dsh Typert Remote 客户端）、
  `harness-session.ts`（会话/轮询）、`harness-mapping.ts`（dsh 事件 → 画布协议 v6 事件），
  路由前缀 `/agent/harness/*`。
- `src/agent/codex*` 与 `skills/` 之间的耦合随之删除；原 `skills/store.ts`（站点工作空间下
  的 SKILL.md 管理）已无路由接入，作为死代码一并移除。