import {
    COMFY_NODE_LAYOUT,
    type ComfyFlowEdgeData,
    type ComfyFlowGraphLayout,
    type ComfyFlowNodeData,
    type ComfyNodePort,
    type ComfySlotCategory,
} from "./comfy-flow-types";

// 通用端口数据类型推导（优先根据入参/出参命名探测，符合 ComfyUI 标准词汇）
function inferDataType(classType: string, slotIndex: number, paramKey?: string): string {
    const key = (paramKey || "").toLowerCase();
    const type = (classType || "").toLowerCase();

    if (key.includes("image") || key.includes("frame") || type.includes("image")) return "IMAGE";
    if (key.includes("latent") || type.includes("latent")) return "LATENT";
    if (key.includes("model") || key.includes("unet") || type.includes("unet") || type.includes("diffusion")) return "MODEL";
    if (
        key.includes("clip") ||
        key.includes("conditioning") ||
        key === "positive" ||
        key === "negative" ||
        type.includes("clip")
    ) {
        return "CONDITIONING";
    }
    if (key.includes("vae") || type.includes("vae")) return "VAE";
    if (key.includes("mask") || type.includes("mask")) return "MASK";
    if (key.includes("audio") || type.includes("audio")) return "AUDIO";
    if (key.includes("video") || type.includes("video")) return "VIDEO";
    if (key.includes("seed") || key.includes("steps") || key.includes("width") || key.includes("height")) {
        return "INT";
    }

    if (type.includes("sampler")) return "LATENT";
    return "ANY";
}

// 槽位分类解析（严格遵循 _meta.title 标准协议与保存/输出节点语义）
function classifySlot(rawTitle?: string, classType?: string): { category: ComfySlotCategory; modelType?: string } {
    const type = (classType || "").toLowerCase();
    const isOutputClass = type.startsWith("save") || type.includes("combine") || type.startsWith("preview");

    if (!rawTitle) {
        return { category: isOutputClass ? "output" : "general" };
    }

    const title = rawTitle.trim();
    if (title.startsWith("select_models_")) {
        return { category: "model", modelType: title.slice("select_models_".length).toLowerCase() };
    }
    if (title.startsWith("select_")) {
        return { category: "model", modelType: title.slice("select_".length).toLowerCase() };
    }
    if (title === "prompt") return { category: "prompt" };
    if (title === "seed") return { category: "seed" };
    if (title === "width" || title === "height" || title === "duration") return { category: "size" };
    if (
        title.startsWith("ref_image_") ||
        title.startsWith("ref_video_") ||
        title.startsWith("ref_audio_") ||
        title === "first_frame" ||
        title === "last_frame" ||
        title === "ref_mask"
    ) {
        return { category: "reference" };
    }
    if (title.startsWith("output_") || isOutputClass) {
        return { category: "output" };
    }
    return { category: "general" };
}

export function parseWorkflowToGraph(workflow: Record<string, unknown>): ComfyFlowGraphLayout {
    if (!workflow || typeof workflow !== "object") {
        return {
            nodes: [],
            edges: [],
            bounds: { minX: 0, minY: 0, maxX: 600, maxY: 400, width: 600, height: 400, centerX: 300, centerY: 200 },
            stats: { totalNodes: 0, totalEdges: 0, detectedSlots: 0 },
        };
    }

    const rawEntries = Object.entries(workflow);
    const validNodesMap = new Map<string, { classType: string; inputs: Record<string, unknown>; title?: string }>();

    for (const [id, rawVal] of rawEntries) {
        if (!rawVal || typeof rawVal !== "object" || Array.isArray(rawVal)) continue;
        const rawNode = rawVal as {
            class_type?: string;
            inputs?: Record<string, unknown>;
            _meta?: { title?: unknown };
        };
        const classType = typeof rawNode.class_type === "string" ? rawNode.class_type : "Node";
        const inputs = rawNode.inputs && typeof rawNode.inputs === "object" ? rawNode.inputs : {};
        const title = typeof rawNode._meta?.title === "string" ? rawNode._meta.title.trim() : undefined;
        validNodesMap.set(id, { classType, inputs, title });
    }

    // 收集所有边和每个节点被使用的输出端口
    const edges: ComfyFlowEdgeData[] = [];
    const usedOutputSlots = new Map<string, Set<number>>();
    let detectedSlotsCount = 0;

    for (const [toId, nodeInfo] of validNodesMap.entries()) {
        const { inputs } = nodeInfo;
        for (const [paramKey, paramVal] of Object.entries(inputs)) {
            if (
                Array.isArray(paramVal) &&
                paramVal.length === 2 &&
                (typeof paramVal[0] === "string" || typeof paramVal[0] === "number") &&
                typeof paramVal[1] === "number"
            ) {
                const fromId = String(paramVal[0]);
                const fromSlot = paramVal[1];
                if (validNodesMap.has(fromId)) {
                    if (!usedOutputSlots.has(fromId)) {
                        usedOutputSlots.set(fromId, new Set());
                    }
                    usedOutputSlots.get(fromId)!.add(fromSlot);

                    const fromPortId = `${fromId}-out-${fromSlot}`;
                    const toPortId = `${toId}-in-${paramKey}`;
                    const dataType = inferDataType(
                        validNodesMap.get(fromId)?.classType || "",
                        fromSlot,
                        paramKey,
                    );

                    edges.push({
                        id: `${fromId}:${fromSlot}->${toId}:${paramKey}`,
                        fromNodeId: fromId,
                        fromSlot,
                        toNodeId: toId,
                        toInputKey: paramKey,
                        fromPortId,
                        toPortId,
                        dataType,
                    });
                }
            }
        }
    }

    // 构建邻接表用于计算 DAG 拓扑分层 (Kahn / Longest Path)
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();

    for (const id of validNodesMap.keys()) {
        inDegree.set(id, 0);
        outgoing.set(id, []);
        incoming.set(id, []);
    }

    for (const edge of edges) {
        inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
        outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
        incoming.get(edge.toNodeId)?.push(edge.fromNodeId);
    }

    // 计算分层 (Layer)
    const layers = new Map<string, number>();
    const queue: string[] = [];

    for (const [id, deg] of inDegree.entries()) {
        if (deg === 0) {
            layers.set(id, 0);
            queue.push(id);
        }
    }

    // BFS / Relaxation 计算最长路径分层
    let maxLayer = 0;
    while (queue.length > 0) {
        const u = queue.shift()!;
        const currentLayer = layers.get(u) || 0;
        const neighbors = outgoing.get(u) || [];
        for (const v of neighbors) {
            const nextLayer = Math.max(layers.get(v) || 0, currentLayer + 1);
            layers.set(v, nextLayer);
            if (nextLayer > maxLayer) maxLayer = nextLayer;
            const remaining = (inDegree.get(v) || 1) - 1;
            inDegree.set(v, remaining);
            if (remaining === 0) {
                queue.push(v);
            }
        }
    }

    // 对于残留环形或未访问到的节点做合理分层
    for (const id of validNodesMap.keys()) {
        if (!layers.has(id)) {
            layers.set(id, 0);
        }
    }

    // 构建完整节点结构
    const nodes: ComfyFlowNodeData[] = [];
    const layerBuckets = new Map<number, ComfyFlowNodeData[]>();

    for (const [id, nodeInfo] of validNodesMap.entries()) {
        const { classType, inputs, title } = nodeInfo;
        const { category, modelType } = classifySlot(title, classType);
        if (category !== "general") {
            detectedSlotsCount++;
        }

        let nodeLayer = layers.get(id) || 0;
        // 如果是最终输出节点，将其推至最右侧层级，使 SaveImage 等整齐排在最后
        if (category === "output" && (outgoing.get(id)?.length || 0) === 0) {
            nodeLayer = Math.max(nodeLayer, maxLayer + 1);
        }

        const connectedInputs: { key: string; fromNodeId: string; fromSlot: number }[] = [];
        const literalInputs: { key: string; value: unknown }[] = [];
        const inputPorts: ComfyNodePort[] = [];

        for (const [key, val] of Object.entries(inputs)) {
            if (
                Array.isArray(val) &&
                val.length === 2 &&
                (typeof val[0] === "string" || typeof val[0] === "number") &&
                typeof val[1] === "number" &&
                validNodesMap.has(String(val[0]))
            ) {
                connectedInputs.push({ key, fromNodeId: String(val[0]), fromSlot: val[1] });
                // 仅实际连线的输入才渲染为左侧端口圆点
                inputPorts.push({
                    id: `${id}-in-${key}`,
                    name: key,
                    type: inferDataType(classType, 0, key),
                    isConnected: true,
                });
            } else {
                // 常量标量参数放入字面量列表，避免左侧插槽拥挤
                literalInputs.push({ key, value: val });
            }
        }

        // 输出端口根据该节点被下游引用的 slotIndex 生成，至少保留 slot 0
        const outSlotsSet = usedOutputSlots.get(id) || new Set<number>();
        const maxOutSlot = outSlotsSet.size > 0 ? Math.max(...outSlotsSet) : 0;
        const outputPorts: ComfyNodePort[] = [];

        // 只有非最终 Save 节点才强制有输出端口
        if (category !== "output" || outSlotsSet.size > 0) {
            for (let s = 0; s <= maxOutSlot; s++) {
                const portName = s === 0 ? "output" : `out_${s}`;
                outputPorts.push({
                    id: `${id}-out-${s}`,
                    name: portName,
                    type: inferDataType(classType, s),
                    slotIndex: s,
                    isConnected: outSlotsSet.has(s),
                });
            }
        }

        // 计算节点自适应高度
        const portRowsCount = Math.max(inputPorts.length, outputPorts.length, 1);
        const previewLiteralCount = Math.min(literalInputs.length, 3);
        const baseHeight = COMFY_NODE_LAYOUT.HEADER_HEIGHT + COMFY_NODE_LAYOUT.SUBTITLE_HEIGHT + COMFY_NODE_LAYOUT.DIVIDER_HEIGHT + COMFY_NODE_LAYOUT.BODY_PADDING_TOP;
        const portHeight = portRowsCount * COMFY_NODE_LAYOUT.PIN_ROW_HEIGHT;
        const literalHeight = previewLiteralCount > 0 ? previewLiteralCount * 18 + 12 : 8;
        const calculatedHeight = Math.max(76, baseHeight + portHeight + literalHeight);

        const nodeData: ComfyFlowNodeData = {
            id,
            classType,
            title: title || classType,
            slotTitle: title,
            slotCategory: category,
            modelType,
            inputs,
            connectedInputs,
            literalInputs,
            inputPorts,
            outputPorts,
            x: 0,
            y: 0,
            width: COMFY_NODE_LAYOUT.WIDTH,
            height: calculatedHeight,
            layer: nodeLayer,
        };

        nodes.push(nodeData);

        if (!layerBuckets.has(nodeLayer)) {
            layerBuckets.set(nodeLayer, []);
        }
        layerBuckets.get(nodeLayer)!.push(nodeData);
    }

    // 重心法（Barycenter Heuristic）优化层内纵向排序，减少导线交叉
    const nodeYMap = new Map<string, number>();
    const sortedLayers = Array.from(layerBuckets.keys()).sort((a, b) => a - b);

    // 第一层（Root 层）先按 ID 排序
    if (sortedLayers.length > 0) {
        layerBuckets.get(sortedLayers[0])?.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    }

    // 后续各层按上游相连节点的平均 Y 坐标（重心）进行稳定排序
    for (let i = 1; i < sortedLayers.length; i++) {
        const layer = sortedLayers[i];
        const bucket = layerBuckets.get(layer) || [];

        bucket.sort((nodeA, nodeB) => {
            const upA = incoming.get(nodeA.id) || [];
            const upB = incoming.get(nodeB.id) || [];

            const avgYA =
                upA.length > 0
                    ? upA.reduce((sum, upId) => sum + (nodeYMap.get(upId) || 0), 0) / upA.length
                    : 0;
            const avgYB =
                upB.length > 0
                    ? upB.reduce((sum, upId) => sum + (nodeYMap.get(upId) || 0), 0) / upB.length
                    : 0;

            if (avgYA !== avgYB) return avgYA - avgYB;
            return nodeA.id.localeCompare(nodeB.id, undefined, { numeric: true });
        });
    }

    // 计算最高层的总高度，使各列纵向垂直居中
    let maxColumnHeight = 0;
    for (const layer of sortedLayers) {
        const bucket = layerBuckets.get(layer)!;
        const colHeight = bucket.reduce((sum, n) => sum + n.height + COMFY_NODE_LAYOUT.NODE_GAP_Y, 0) - COMFY_NODE_LAYOUT.NODE_GAP_Y;
        if (colHeight > maxColumnHeight) maxColumnHeight = colHeight;
    }

    let currentX = 60;
    let minX = currentX;
    let minY = 60;
    let maxX = currentX;
    let maxY = 60;

    for (const layer of sortedLayers) {
        const bucket = layerBuckets.get(layer)!;
        const colHeight = bucket.reduce((sum, n) => sum + n.height + COMFY_NODE_LAYOUT.NODE_GAP_Y, 0) - COMFY_NODE_LAYOUT.NODE_GAP_Y;
        let startY = 60 + Math.max(0, (maxColumnHeight - colHeight) / 2);

        for (const node of bucket) {
            node.x = currentX;
            node.y = startY;
            nodeYMap.set(node.id, node.y);

            // 精准计算端口圆点世界坐标（与 DOM 视觉对齐）
            const headerOffset =
                COMFY_NODE_LAYOUT.HEADER_HEIGHT +
                COMFY_NODE_LAYOUT.SUBTITLE_HEIGHT +
                COMFY_NODE_LAYOUT.DIVIDER_HEIGHT +
                COMFY_NODE_LAYOUT.BODY_PADDING_TOP;

            node.inputPorts.forEach((port, idx) => {
                port.x = node.x;
                port.y = node.y + headerOffset + idx * COMFY_NODE_LAYOUT.PIN_ROW_HEIGHT + COMFY_NODE_LAYOUT.PIN_CENTER_OFFSET;
            });

            node.outputPorts.forEach((port, idx) => {
                port.x = node.x + node.width;
                port.y = node.y + headerOffset + idx * COMFY_NODE_LAYOUT.PIN_ROW_HEIGHT + COMFY_NODE_LAYOUT.PIN_CENTER_OFFSET;
            });

            if (node.y + node.height > maxY) maxY = node.y + node.height;
            startY += node.height + COMFY_NODE_LAYOUT.NODE_GAP_Y;
        }

        if (currentX + COMFY_NODE_LAYOUT.WIDTH > maxX) maxX = currentX + COMFY_NODE_LAYOUT.WIDTH;
        currentX += COMFY_NODE_LAYOUT.WIDTH + COMFY_NODE_LAYOUT.LAYER_GAP_X;
    }

    // 精准推导所有节点的绝对外接包围盒及几何中心
    let boundsMinX = Infinity;
    let boundsMinY = Infinity;
    let boundsMaxX = -Infinity;
    let boundsMaxY = -Infinity;

    for (const node of nodes) {
        if (node.x < boundsMinX) boundsMinX = node.x;
        if (node.y < boundsMinY) boundsMinY = node.y;
        if (node.x + node.width > boundsMaxX) boundsMaxX = node.x + node.width;
        if (node.y + node.height > boundsMaxY) boundsMaxY = node.y + node.height;
    }

    if (nodes.length === 0) {
        boundsMinX = 0;
        boundsMinY = 0;
        boundsMaxX = 600;
        boundsMaxY = 400;
    }

    const boundsWidth = Math.max(boundsMaxX - boundsMinX, 400);
    const boundsHeight = Math.max(boundsMaxY - boundsMinY, 300);

    return {
        nodes,
        edges,
        bounds: {
            minX: boundsMinX,
            minY: boundsMinY,
            maxX: boundsMaxX,
            maxY: boundsMaxY,
            width: boundsWidth,
            height: boundsHeight,
            centerX: (boundsMinX + boundsMaxX) / 2,
            centerY: (boundsMinY + boundsMaxY) / 2,
        },
        stats: {
            totalNodes: nodes.length,
            totalEdges: edges.length,
            detectedSlots: detectedSlotsCount,
        },
    };
}
