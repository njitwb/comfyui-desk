import type { CanvasNodeData } from "@/types/canvas";

export interface AlignmentGuideLine {
    id: string;
    orientation: "horizontal" | "vertical";
    position: number;
    start: number;
    end: number;
}

export interface AlignmentSnapResult {
    snappedDx: number;
    snappedDy: number;
    guides: AlignmentGuideLine[];
}

export interface DraggedNodeInitial {
    id: string;
    x: number;
    y: number;
}

/**
 * Calculates smart snapping alignment against adjacent/neighboring nodes on the canvas.
 * Filters candidates to nearby spatial neighbors to avoid cluttered guide lines from distant nodes.
 */
export function calculateAlignmentSnap({
    initialNodes,
    rawDx,
    rawDy,
    allNodes,
    viewportScale,
    disabled = false,
    maxNeighborDistance = 800,
}: {
    initialNodes: DraggedNodeInitial[];
    rawDx: number;
    rawDy: number;
    allNodes: CanvasNodeData[];
    viewportScale: number;
    disabled?: boolean;
    maxNeighborDistance?: number;
}): AlignmentSnapResult {
    if (disabled || initialNodes.length === 0) {
        return { snappedDx: rawDx, snappedDy: rawDy, guides: [] };
    }

    const draggedIdSet = new Set(initialNodes.map((n) => n.id));
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

    // 1. Calculate the bounding box of the dragged selection at candidate position (rawDx, rawDy)
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const init of initialNodes) {
        const node = nodeMap.get(init.id);
        const width = node?.width || 200;
        const height = node?.height || 200;
        const curX = init.x + rawDx;
        const curY = init.y + rawDy;

        if (curX < minX) minX = curX;
        if (curX + width > maxX) maxX = curX + width;
        if (curY < minY) minY = curY;
        if (curY + height > maxY) maxY = curY + height;
    }

    const dragBox = {
        left: minX,
        right: maxX,
        top: minY,
        bottom: maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        width: maxX - minX,
        height: maxY - minY,
    };

    // 2. Filter candidate stationary nodes that are nearby / adjacent in spatial space
    const threshold = 7 / Math.max(0.1, viewportScale);
    const candidates = allNodes.filter((node) => {
        if (draggedIdSet.has(node.id)) return false;
        // Don't align to invisible or enclosed sub-items if dragged is group
        const targetCenterX = node.position.x + node.width / 2;
        const targetCenterY = node.position.y + node.height / 2;

        const distX = Math.abs(dragBox.centerX - targetCenterX);
        const distY = Math.abs(dragBox.centerY - targetCenterY);

        // Check if node is spatially adjacent: within maxNeighborDistance or overlapping on one axis
        const isHorizontallyAdjacent = distY <= maxNeighborDistance && distX <= maxNeighborDistance + dragBox.width / 2 + node.width / 2;
        const isVerticallyAdjacent = distX <= maxNeighborDistance && distY <= maxNeighborDistance + dragBox.height / 2 + node.height / 2;

        return isHorizontallyAdjacent || isVerticallyAdjacent;
    });

    if (candidates.length === 0) {
        return { snappedDx: rawDx, snappedDy: rawDy, guides: [] };
    }

    // 3. Find closest X snap (Vertical lines)
    let bestSnapDeltaX: number | null = null;
    let bestDistX = threshold + 0.001;
    let bestGuideX: AlignmentGuideLine | null = null;

    const dragXAnchors = [
        { type: "left", value: dragBox.left },
        { type: "center", value: dragBox.centerX },
        { type: "right", value: dragBox.right },
    ];

    for (const target of candidates) {
        const targetLeft = target.position.x;
        const targetRight = target.position.x + target.width;
        const targetCenterX = target.position.x + target.width / 2;
        const targetXAnchors = [targetLeft, targetCenterX, targetRight];

        for (const dragAnchor of dragXAnchors) {
            for (const targetVal of targetXAnchors) {
                const diff = targetVal - dragAnchor.value;
                const dist = Math.abs(diff);
                if (dist <= threshold && dist < bestDistX) {
                    bestDistX = dist;
                    bestSnapDeltaX = diff;
                    const guideYStart = Math.min(dragBox.top, target.position.y) - 16;
                    const guideYEnd = Math.max(dragBox.bottom, target.position.y + target.height) + 16;
                    bestGuideX = {
                        id: `guide-v-${target.id}-${targetVal}`,
                        orientation: "vertical",
                        position: targetVal,
                        start: guideYStart,
                        end: guideYEnd,
                    };
                }
            }
        }
    }

    // 4. Find closest Y snap (Horizontal lines)
    let bestSnapDeltaY: number | null = null;
    let bestDistY = threshold + 0.001;
    let bestGuideY: AlignmentGuideLine | null = null;

    const dragYAnchors = [
        { type: "top", value: dragBox.top },
        { type: "center", value: dragBox.centerY },
        { type: "bottom", value: dragBox.bottom },
    ];

    for (const target of candidates) {
        const targetTop = target.position.y;
        const targetBottom = target.position.y + target.height;
        const targetCenterY = target.position.y + target.height / 2;
        const targetYAnchors = [targetTop, targetCenterY, targetBottom];

        for (const dragAnchor of dragYAnchors) {
            for (const targetVal of targetYAnchors) {
                const diff = targetVal - dragAnchor.value;
                const dist = Math.abs(diff);
                if (dist <= threshold && dist < bestDistY) {
                    bestDistY = dist;
                    bestSnapDeltaY = diff;
                    const guideXStart = Math.min(dragBox.left, target.position.x) - 16;
                    const guideXEnd = Math.max(dragBox.right, target.position.x + target.width) + 16;
                    bestGuideY = {
                        id: `guide-h-${target.id}-${targetVal}`,
                        orientation: "horizontal",
                        position: targetVal,
                        start: guideXStart,
                        end: guideXEnd,
                    };
                }
            }
        }
    }

    const finalDx = bestSnapDeltaX !== null ? rawDx + bestSnapDeltaX : rawDx;
    const finalDy = bestSnapDeltaY !== null ? rawDy + bestSnapDeltaY : rawDy;
    const guides: AlignmentGuideLine[] = [];
    if (bestGuideX) guides.push(bestGuideX);
    if (bestGuideY) guides.push(bestGuideY);

    return {
        snappedDx: finalDx,
        snappedDy: finalDy,
        guides,
    };
}
