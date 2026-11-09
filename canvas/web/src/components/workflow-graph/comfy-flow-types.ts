export type ComfySlotCategory =
    | "prompt"
    | "seed"
    | "size"
    | "reference"
    | "model"
    | "output"
    | "general";

export const COMFY_NODE_LAYOUT = {
    WIDTH: 250,
    HEADER_HEIGHT: 28,
    SUBTITLE_HEIGHT: 20,
    DIVIDER_HEIGHT: 1,
    BODY_PADDING_TOP: 8,
    PIN_ROW_HEIGHT: 22,
    PIN_CENTER_OFFSET: 11,
    LAYER_GAP_X: 110,
    NODE_GAP_Y: 36,
};

export interface ComfyNodePort {
    id: string; // e.g. "9-input-images" or "9-output-0"
    name: string;
    type?: string; // e.g. "IMAGE", "MODEL", "LATENT", "CONDITIONING", "STRING", "INT"
    slotIndex?: number;
    isConnected?: boolean;
    x?: number; // relative to canvas
    y?: number;
}

export interface ComfyFlowNodeData {
    id: string; // node ID string in ComfyUI, e.g. "9", "69"
    classType: string;
    title: string;
    slotTitle?: string;
    slotCategory?: ComfySlotCategory;
    modelType?: string; // if select_models_*
    inputs: Record<string, unknown>; // raw inputs
    connectedInputs: { key: string; fromNodeId: string; fromSlot: number }[];
    literalInputs: { key: string; value: unknown }[];
    inputPorts: ComfyNodePort[];
    outputPorts: ComfyNodePort[];
    x: number;
    y: number;
    width: number;
    height: number;
    layer: number;
}

export interface ComfyFlowEdgeData {
    id: string;
    fromNodeId: string;
    fromSlot: number;
    toNodeId: string;
    toInputKey: string;
    fromPortId: string;
    toPortId: string;
    dataType?: string;
}

export interface ComfyFlowGraphLayout {
    nodes: ComfyFlowNodeData[];
    edges: ComfyFlowEdgeData[];
    bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
    };
    stats: {
        totalNodes: number;
        totalEdges: number;
        detectedSlots: number;
    };
}
