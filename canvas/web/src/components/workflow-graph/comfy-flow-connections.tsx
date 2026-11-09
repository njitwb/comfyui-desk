import { memo, useMemo } from "react";
import type { ComfyFlowEdgeData, ComfyFlowNodeData } from "./comfy-flow-types";

const DATA_TYPE_COLORS: Record<string, string> = {
    MODEL: "#a855f7", // purple
    CLIP: "#eab308", // yellow
    CONDITIONING: "#f59e0b", // amber
    IMAGE: "#0ea5e9", // sky blue
    LATENT: "#ec4899", // pink
    VAE: "#ef4444", // red
    MASK: "#14b8a6", // teal
    VIDEO: "#8b5cf6", // violet
    AUDIO: "#f97316", // orange
    INT: "#64748b", // slate
    FLOAT: "#64748b",
    STRING: "#06b6d4", // cyan
    ANY: "#78716c", // stone
};

export function getDataTypeColor(type?: string): string {
    if (!type) return DATA_TYPE_COLORS.ANY;
    const upper = type.toUpperCase();
    return DATA_TYPE_COLORS[upper] || DATA_TYPE_COLORS.ANY;
}

interface ComfyFlowConnectionsProps {
    edges: ComfyFlowEdgeData[];
    nodesMap: Map<string, ComfyFlowNodeData>;
    selectedNodeId?: string | null;
    hoveredEdgeId?: string | null;
    onEdgeHover?: (edgeId: string | null) => void;
}

export const ComfyFlowConnections = memo(function ComfyFlowConnections({
    edges,
    nodesMap,
    selectedNodeId,
    hoveredEdgeId,
    onEdgeHover,
}: ComfyFlowConnectionsProps) {
    const hasSelection = Boolean(selectedNodeId);

    // 计算当前选中节点的传递闭包（直接相连的边以及全链路血缘连线）
    const { directEdgeIds, lineageEdgeIds } = useMemo(() => {
        if (!selectedNodeId) {
            return { directEdgeIds: new Set<string>(), lineageEdgeIds: new Set<string>() };
        }

        const direct = new Set<string>();
        const lineage = new Set<string>();

        // 1-hop 直接连线
        for (const e of edges) {
            if (e.fromNodeId === selectedNodeId || e.toNodeId === selectedNodeId) {
                direct.add(e.id);
            }
        }

        // 递归上游溯源 (Ancestors)
        const upstreamNodes = new Set<string>([selectedNodeId]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const e of edges) {
                if (upstreamNodes.has(e.toNodeId) && !upstreamNodes.has(e.fromNodeId)) {
                    upstreamNodes.add(e.fromNodeId);
                    lineage.add(e.id);
                    changed = true;
                }
            }
        }

        // 递归下游追踪 (Descendants)
        const downstreamNodes = new Set<string>([selectedNodeId]);
        changed = true;
        while (changed) {
            changed = false;
            for (const e of edges) {
                if (downstreamNodes.has(e.fromNodeId) && !downstreamNodes.has(e.toNodeId)) {
                    downstreamNodes.add(e.toNodeId);
                    lineage.add(e.id);
                    changed = true;
                }
            }
        }

        return { directEdgeIds: direct, lineageEdgeIds: lineage };
    }, [edges, selectedNodeId]);

    const renderedPaths = useMemo(() => {
        return edges.map((edge) => {
            const fromNode = nodesMap.get(edge.fromNodeId);
            const toNode = nodesMap.get(edge.toNodeId);
            if (!fromNode || !toNode) return null;

            const fromPort = fromNode.outputPorts.find((p) => p.slotIndex === edge.fromSlot);
            const toPort = toNode.inputPorts.find((p) => p.name === edge.toInputKey);

            const startX = fromPort?.x ?? fromNode.x + fromNode.width;
            const startY = fromPort?.y ?? fromNode.y + 40;
            const endX = toPort?.x ?? toNode.x;
            const endY = toPort?.y ?? toNode.y + 40;

            const dx = Math.abs(endX - startX);
            const curvature = Math.max(dx * 0.45, 40);
            const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;

            const isDirect = directEdgeIds.has(edge.id);
            const isLineage = lineageEdgeIds.has(edge.id);
            const isHovered = hoveredEdgeId === edge.id;

            const strokeColor = getDataTypeColor(edge.dataType);
            const strokeWidth = isHovered ? 3.5 : isDirect ? 3.5 : isLineage ? 2.5 : 1.8;
            const strokeOpacity = hasSelection
                ? isDirect
                    ? 1.0
                    : isLineage
                    ? 0.85
                    : 0.12
                : isHovered
                ? 1.0
                : 0.72;

            return (
                <g key={edge.id}>
                    {/* 扩大鼠标交互热区的透明粗线 */}
                    <path
                        d={pathD}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        style={{ cursor: "pointer", pointerEvents: "stroke" }}
                        onMouseEnter={() => onEdgeHover?.(edge.id)}
                        onMouseLeave={() => onEdgeHover?.(null)}
                    >
                        <title>{`${edge.fromNodeId} (${fromNode.title}) [${edge.fromSlot}] → ${edge.toNodeId} (${toNode.title}) [${edge.toInputKey}]`}</title>
                    </path>

                    {/* 可见连线 */}
                    <path
                        d={pathD}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeOpacity={strokeOpacity}
                        style={{
                            pointerEvents: "none",
                            transition: "stroke-opacity 0.2s ease, stroke-width 0.2s ease",
                            filter: isDirect || isHovered ? `drop-shadow(0 0 6px ${strokeColor}aa)` : undefined,
                        }}
                    />
                </g>
            );
        });
    }, [edges, nodesMap, directEdgeIds, lineageEdgeIds, hoveredEdgeId, hasSelection, onEdgeHover]);

    return <g className="comfy-flow-connections">{renderedPaths}</g>;
});
