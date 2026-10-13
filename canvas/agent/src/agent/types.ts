/** Agent 向网页广播事件的函数类型。 */
export type AgentEmit = (type: string, payload: unknown) => void;

/** 用户随当前 Agent 消息上传的附件。 */
export type AgentAttachment = { id?: string; name?: string; type?: string; size?: number; width?: number; height?: number; dataUrl?: string };

/** 用户消息在历史记录中展示所需的附件信息。 */
export type AgentAttachmentDisplay = { id: string; name: string; type?: string; size?: number; width?: number; height?: number; url: string };

/** 用户消息引用的画布素材。 */
export type AgentCanvasReference = { nodeId: string; label: string; title: string; kind: "image" | "video" | "audio" | "text"; previewUrl?: string; text?: string };

/** 用户消息调用的 Skill。 */
export type AgentSkillReference = { name: string; path: string; displayName?: string };

/** 独立于 Agent 原生线程历史保存的用户消息展示元数据。 */
export type AgentMessageMetadata = { attachments?: AgentAttachmentDisplay[]; canvasReferences?: AgentCanvasReference[]; skill?: AgentSkillReference };

/** 文件、命令和网络权限模式。 */
export type AgentPermissionMode = "request" | "automatic" | "full";
