import { memo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { getDataTypeColor } from "./comfy-flow-connections";
import { COMFY_NODE_LAYOUT, type ComfyFlowNodeData } from "./comfy-flow-types";

const CATEGORY_HEADER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    output: {
        bg: "bg-emerald-500/15 dark:bg-emerald-950/40",
        text: "text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-500/30",
    },
    prompt: {
        bg: "bg-blue-500/15 dark:bg-blue-950/40",
        text: "text-blue-700 dark:text-blue-300",
        border: "border-blue-500/30",
    },
    seed: {
        bg: "bg-indigo-500/15 dark:bg-indigo-950/40",
        text: "text-indigo-700 dark:text-indigo-300",
        border: "border-indigo-500/30",
    },
    model: {
        bg: "bg-purple-500/15 dark:bg-purple-950/40",
        text: "text-purple-700 dark:text-purple-300",
        border: "border-purple-500/30",
    },
    reference: {
        bg: "bg-amber-500/15 dark:bg-amber-950/40",
        text: "text-amber-700 dark:text-amber-300",
        border: "border-amber-500/30",
    },
    size: {
        bg: "bg-cyan-500/15 dark:bg-cyan-950/40",
        text: "text-cyan-700 dark:text-cyan-300",
        border: "border-cyan-500/30",
    },
    general: {
        bg: "bg-stone-100 dark:bg-stone-800/60",
        text: "text-stone-700 dark:text-stone-300",
        border: "border-stone-200 dark:border-stone-700/60",
    },
};

interface ComfyFlowNodeProps {
    node: ComfyFlowNodeData;
    isSelected: boolean;
    onSelect: (nodeId: string) => void;
    onNodeDragStart?: (e: ReactMouseEvent, nodeId: string) => void;
}

export const ComfyFlowNode = memo(function ComfyFlowNode({
    node,
    isSelected,
    onSelect,
    onNodeDragStart,
}: ComfyFlowNodeProps) {
    const headerStyle = CATEGORY_HEADER_COLORS[node.slotCategory || "general"] || CATEGORY_HEADER_COLORS.general;
    const cardRef = useRef<HTMLDivElement>(null);

    // 格式化字面量预览
    const previewLiterals = node.literalInputs.slice(0, 3);
    const rowCount = Math.max(node.inputPorts.length, node.outputPorts.length, 1);

    return (
        <div
            ref={cardRef}
            className={`absolute select-none rounded-xl border bg-white/95 text-xs shadow-md backdrop-blur-xs transition-shadow dark:bg-stone-900/95 ${
                isSelected
                    ? "ring-2 ring-blue-500 border-blue-500 shadow-lg shadow-blue-500/15 dark:ring-blue-400 dark:border-blue-400"
                    : "border-stone-200/90 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
            }`}
            style={{
                left: node.x,
                top: node.y,
                width: node.width,
                minHeight: node.height,
                cursor: "pointer",
            }}
            onClick={(e) => {
                e.stopPropagation();
                onSelect(node.id);
            }}
            onMouseDown={(e) => {
                if (e.button === 0 && onNodeDragStart) {
                    onNodeDragStart(e, node.id);
                }
            }}
        >
            {/* 节点顶栏 Header (高度严格对齐 COMFY_NODE_LAYOUT.HEADER_HEIGHT = 28px) */}
            <div
                className={`flex items-center justify-between gap-1.5 rounded-t-xl border-b px-2.5 ${headerStyle.bg} ${headerStyle.border}`}
                style={{ height: COMFY_NODE_LAYOUT.HEADER_HEIGHT }}
            >
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[10px] font-bold text-stone-500 dark:text-stone-400 shrink-0">
                        #{node.id}
                    </span>
                    <span className={`truncate font-semibold text-xs ${headerStyle.text}`} title={node.title}>
                        {node.title}
                    </span>
                </div>

                {node.slotCategory && node.slotCategory !== "general" && (
                    <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${headerStyle.bg} ${headerStyle.text} border ${headerStyle.border}`}
                    >
                        {node.slotCategory === "model" ? "MODEL" : node.slotCategory}
                    </span>
                )}
            </div>

            {/* 类名副标题 (高度严格对齐 COMFY_NODE_LAYOUT.SUBTITLE_HEIGHT = 20px, 底部边框 1px) */}
            <div
                className="flex items-center px-2.5 text-[10px] font-mono text-stone-400 dark:text-stone-500 truncate border-b border-stone-100 dark:border-stone-800/60"
                style={{ height: COMFY_NODE_LAYOUT.SUBTITLE_HEIGHT }}
            >
                <span className="truncate">{node.classType}</span>
            </div>

            {/* 端口与流向区域 (顶部 padding 严格对齐 COMFY_NODE_LAYOUT.BODY_PADDING_TOP = 8px) */}
            <div
                className="px-2 pb-2 relative"
                style={{ paddingTop: COMFY_NODE_LAYOUT.BODY_PADDING_TOP }}
            >
                {/* 端口逐行对齐 (高度每行 22px，端口圆点垂直居中偏移 11px) */}
                <div className="space-y-0">
                    {Array.from({ length: rowCount }).map((_, idx) => {
                        const inPort = node.inputPorts[idx];
                        const outPort = node.outputPorts[idx];
                        const inColor = inPort ? getDataTypeColor(inPort.type) : undefined;
                        const outColor = outPort ? getDataTypeColor(outPort.type) : undefined;

                        return (
                            <div
                                key={idx}
                                className="flex items-center justify-between relative group"
                                style={{ height: COMFY_NODE_LAYOUT.PIN_ROW_HEIGHT }}
                            >
                                {/* 左侧：输入端口 */}
                                <div className="flex items-center min-w-0 flex-1 relative h-full">
                                    {inPort && (
                                        <>
                                            <span
                                                className="absolute -left-2 top-1/2 -translate-y-1/2 -translate-x-1/2 size-2.5 rounded-full border border-white dark:border-stone-900 shadow-2xs shrink-0 transition-transform group-hover:scale-125 z-10"
                                                style={{ backgroundColor: inColor }}
                                                title={`输入: ${inPort.name} (${inPort.type || "ANY"})`}
                                            />
                                            <span
                                                className={`pl-1.5 truncate text-[11px] select-none ${
                                                    inPort.isConnected
                                                        ? "text-stone-800 dark:text-stone-200 font-medium"
                                                        : "text-stone-400 dark:text-stone-500"
                                                }`}
                                                title={`输入: ${inPort.name} (${inPort.type || "ANY"})`}
                                            >
                                                {inPort.name}
                                            </span>
                                        </>
                                    )}
                                </div>

                                {/* 右侧：输出端口 */}
                                <div className="flex items-center justify-end min-w-0 flex-1 relative h-full">
                                    {outPort && (
                                        <>
                                            <span
                                                className={`pr-1.5 truncate text-[11px] text-right select-none ${
                                                    outPort.isConnected
                                                        ? "text-stone-800 dark:text-stone-200 font-medium"
                                                        : "text-stone-400 dark:text-stone-500"
                                                }`}
                                                title={`输出: ${outPort.name} (${outPort.type || "ANY"})`}
                                            >
                                                {outPort.name}
                                            </span>
                                            <span
                                                className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-1/2 size-2.5 rounded-full border border-white dark:border-stone-900 shadow-2xs shrink-0 transition-transform group-hover:scale-125 z-10"
                                                style={{ backgroundColor: outColor }}
                                                title={`输出: ${outPort.name} (${outPort.type || "ANY"})`}
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 底部常量字面量摘要 (如果存在) */}
                {previewLiterals.length > 0 && (
                    <div className="mt-2 pt-1.5 border-t border-stone-100 dark:border-stone-800/60 space-y-0.5">
                        {previewLiterals.map((lit) => {
                            const valStr =
                                typeof lit.value === "string"
                                    ? lit.value.length > 20
                                        ? `${lit.value.slice(0, 20)}...`
                                        : lit.value
                                    : String(lit.value);
                            return (
                                <div
                                    key={lit.key}
                                    className="flex items-center justify-between text-[10px] text-stone-500 dark:text-stone-400 font-mono truncate"
                                >
                                    <span className="text-stone-400 dark:text-stone-500">{lit.key}:</span>
                                    <span className="truncate max-w-[120px] font-semibold text-stone-700 dark:text-stone-300">
                                        {valStr}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
});
