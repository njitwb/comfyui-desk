import { afterEach, expect, it, vi } from "vitest";

import { ComfyuiApiError, resetComfyuiDetectorChoiceCache, resolveModelChoice, submitJob } from "@/services/api/comfyui";

vi.mock("localforage", () => ({ default: { createInstance: () => ({ setItem: vi.fn(async () => undefined) }) } }));

type InputError = { type: string; message: string; details: string; extra_info: { input_name: string; input_config?: unknown; received_value?: unknown } };
const inputMissing = (name: string): InputError => ({
    type: "required_input_missing",
    message: "Required input is missing",
    details: name,
    extra_info: { input_name: name },
});
const faceRefineValidationErrors = {
    "2": {
        class_type: "H3FaceTrackCrop",
        dependent_outputs: ["23"],
        errors: [
            {
                type: "value_not_in_list",
                message: "Value not in list",
                details: "detector: 'segm/person_yolov8m-seg.pt' not in ['face_yolov8m.pt', 'bbox\\face_yolov8m.pt', 'segm\\person_yolov8m-seg.pt']",
                extra_info: { input_name: "detector", input_config: [["face_yolov8m.pt", "bbox\\face_yolov8m.pt", "segm\\person_yolov8m-seg.pt"], {}], received_value: "segm/person_yolov8m-seg.pt" },
            },
            {
                type: "value_not_in_list",
                message: "Value not in list",
                details: "fallback_detector: 'bbox/face_yolov8m.pt' not in ['none', 'face_yolov8m.pt', 'bbox\\face_yolov8m.pt', 'segm\\person_yolov8m-seg.pt']",
                extra_info: { input_name: "fallback_detector", input_config: [["none", "face_yolov8m.pt", "bbox\\face_yolov8m.pt", "segm\\person_yolov8m-seg.pt"], {}], received_value: "bbox/face_yolov8m.pt" },
            },
            inputMissing("images"),
        ],
    },
    "13": { class_type: "MiniMaxH3NativeAudioLock", dependent_outputs: ["23"], errors: [inputMissing("audio")] },
    "22": { class_type: "H3FaceStitch", dependent_outputs: ["23"], errors: [inputMissing("base_images")] },
    "116": { class_type: "GetImageSize", dependent_outputs: ["23"], errors: [inputMissing("image")] },
};

afterEach(() => vi.unstubAllGlobals());

for (const [name, nodeErrors] of Object.entries({
    "the captured face-refine validation response": faceRefineValidationErrors,
    "a single installed node with a missing input": { "2": { class_type: "H3FaceTrackCrop", errors: [inputMissing("images")] } },
})) {
    it(`reports validation details without claiming a plugin is missing for ${name}`, async () => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({
            error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "" },
            node_errors: nodeErrors,
        }, { status: 400 })));

        const error = await submitJob({ "1": { class_type: "H3FaceTrackCrop", inputs: {} } }, "http://192.168.31.188:8188").catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ComfyuiApiError);
        expect(error).toMatchObject({ status: 400 });
        expect((error as Error).message).toContain("POST http://192.168.31.188:8188/prompt");
        expect((error as Error).message).toContain("Required input is missing");
        expect((error as Error).message).toContain("images");
        expect((error as Error).message).toContain("节点 2（H3FaceTrackCrop）");
        expect((error as Error).message).toContain("缺少输入「images」");
        expect((error as Error).message).not.toContain("缺少核心依赖插件");
        expect((error as Error).message).not.toContain("git clone");
        expect(fetch).toHaveBeenCalledTimes(1);
    });
}

const detectorWorkflow = { "2": { class_type: "H3FaceTrackCrop", inputs: { detector: "segm/person_yolov8m-seg.pt", fallback_detector: "bbox/face_yolov8m.pt" } } };
const detectorErrors = { "2": { ...faceRefineValidationErrors["2"], errors: faceRefineValidationErrors["2"].errors.slice(0, 2) } };

it("uses exact server choices for each rejected detector path instead of flipping every path", async () => {
    const mixedChoices = structuredClone(detectorErrors);
    mixedChoices["2"].errors[1].extra_info!.input_config = [["bbox/face_yolov8m.pt"], {}];
    const submitted: typeof detectorWorkflow[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
        if (String(input).endsWith("/system_stats")) return Response.json({ system: { os: "posix" } });
        const workflow = JSON.parse(String(init?.body)).prompt as typeof detectorWorkflow;
        submitted.push(workflow);
        if (workflow["2"].inputs.detector === "segm\\person_yolov8m-seg.pt" && workflow["2"].inputs.fallback_detector === "bbox/face_yolov8m.pt") return Response.json({ prompt_id: "corrected-paths" });
        return Response.json({ node_errors: mixedChoices }, { status: 400 });
    }));
    await expect(submitJob(detectorWorkflow, "http://mixed-candidates:8188")).resolves.toBe("corrected-paths");
    expect(submitted).toHaveLength(2);
    expect(detectorWorkflow["2"].inputs.detector).toBe("segm/person_yolov8m-seg.pt");
});

it("surfaces the second validation response after path correction exposes missing video inputs", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
        if (String(input).endsWith("/system_stats")) return Response.json({ system: { os: "posix" } });
        posts += 1;
        return Response.json({ node_errors: posts === 1 ? detectorErrors : { "2": { class_type: "H3FaceTrackCrop", errors: [inputMissing("images")] } } }, { status: 400 });
    }));
    const error = await submitJob(detectorWorkflow, "http://second-validation:8188").catch((caught: unknown) => caught);
    expect(posts).toBe(2);
    expect((error as Error).message).toContain("images");
    expect((error as Error).message).not.toContain("value_not_in_list");
});

for (const status of [200, 401, 503]) {
    it(`does not repeat a task submission after an HTTP ${status} response containing detector-path text`, async () => {
        const posts = vi.fn(async () => Response.json({ node_errors: detectorErrors }, { status }));
        vi.stubGlobal("fetch", vi.fn(async (input) => String(input).endsWith("/system_stats")
            ? Response.json({ system: { os: "posix" } })
            : posts()));
        await expect(submitJob(detectorWorkflow, `http://status-${status}:8188`)).rejects.toBeInstanceOf(ComfyuiApiError);
        expect(posts).toHaveBeenCalledTimes(1);
    });
}

it("does not repeat submission after a network failure whose endpoint contains a path keyword", async () => {
    const posts = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", vi.fn(async (input) => String(input).endsWith("/system_stats")
        ? Response.json({ system: { os: "posix" } })
        : posts()));
    await expect(submitJob(detectorWorkflow, "http://bbox-host:8188")).rejects.toThrow("未能联通");
    expect(posts).toHaveBeenCalledTimes(1);
});

it("maps a rejected detector value onto the models the host actually lists", () => {
    expect(resolveModelChoice("segm/person_yolov8m-seg.pt", "detector", ["face_yolov8m.pt"])).toBe("face_yolov8m.pt");
    expect(resolveModelChoice("bbox/face_yolov8m.pt", "detector", ["face_yolov8m.pt"])).toBe("face_yolov8m.pt");
    expect(resolveModelChoice("bbox/face_yolov8m.pt", "detector", ["bbox\\face_yolov8m.pt"])).toBe("bbox\\face_yolov8m.pt");
    // fallback 优先保留“同一个模型文件换个目录”，真的没有才退化成 none（按插值处理）
    expect(resolveModelChoice("bbox/face_yolov8m.pt", "fallback_detector", ["none", "face_yolov8m.pt"])).toBe("face_yolov8m.pt");
    expect(resolveModelChoice("segm/person_yolov8m-seg.pt", "fallback_detector", ["none", "face_yolov8m.pt"])).toBe("none");
    expect(resolveModelChoice("segm/person_yolov8m-seg.pt", "fallback_detector", ["none", "segm\\person_yolov8m-seg.pt"])).toBe("segm\\person_yolov8m-seg.pt");
    // 已经可选、非模型文件、或宿主什么都没列时保持原值，交由服务器报错
    expect(resolveModelChoice("face_yolov8m.pt", "detector", ["face_yolov8m.pt"])).toBeUndefined();
    expect(resolveModelChoice("largest_face", "select", ["largest_face", "centre_most"])).toBeUndefined();
    expect(resolveModelChoice("segm/person_yolov8m-seg.pt", "detector", [])).toBeUndefined();
});

/** 人脸精修工作流里的检测器组合：人脸检测器为主，人体分割模型做兜底。 */
const faceRefineWorkflow = {
    "2": { class_type: "H3FaceTrackCrop", inputs: { detector: "bbox/face_yolov8m.pt", fallback_detector: "segm/person_yolov8m-seg.pt" } },
};
const plainNameDetectorErrors = {
    "2": {
        class_type: "H3FaceTrackCrop",
        errors: [
            {
                type: "value_not_in_list",
                message: "Value not in list",
                details: "detector: 'bbox/face_yolov8m.pt' not in ['face_yolov8m.pt']",
                extra_info: { input_name: "detector", input_config: [["face_yolov8m.pt"], {}], received_value: "bbox/face_yolov8m.pt" },
            },
            {
                type: "value_not_in_list",
                message: "Value not in list",
                details: "fallback_detector: 'segm/person_yolov8m-seg.pt' not in ['none', 'face_yolov8m.pt']",
                extra_info: { input_name: "fallback_detector", input_config: [["none", "face_yolov8m.pt"], {}], received_value: "segm/person_yolov8m-seg.pt" },
            },
        ],
    },
};

it("resubmits the face-refine workflow with the host's plain detector names", async () => {
    resetComfyuiDetectorChoiceCache();
    const submitted: Record<string, { inputs: Record<string, unknown> }>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
        if (String(input).endsWith("/system_stats")) return Response.json({ system: { os: "posix" } });
        submitted.push(JSON.parse(String(init?.body)).prompt);
        const inputs = submitted[submitted.length - 1]["2"].inputs;
        if (inputs.detector === "face_yolov8m.pt" && inputs.fallback_detector === "none") return Response.json({ prompt_id: "plain-path" });
        return Response.json({ node_errors: plainNameDetectorErrors }, { status: 400 });
    }));

    await expect(submitJob(faceRefineWorkflow, "http://plain-names:8188")).resolves.toBe("plain-path");
    expect(submitted).toHaveLength(2);
    expect(submitted[0]["2"].inputs).toMatchObject({ detector: "bbox/face_yolov8m.pt", fallback_detector: "segm/person_yolov8m-seg.pt" });
    expect(submitted[1]["2"].inputs).toMatchObject({ detector: "face_yolov8m.pt", fallback_detector: "none" });
    // 缓存下来的替换关系不能污染调用方传进来的工作流
    expect(faceRefineWorkflow["2"].inputs.detector).toBe("bbox/face_yolov8m.pt");
});

it("reuses the resolved detector names so a later submission does not fail validation first", async () => {
    resetComfyuiDetectorChoiceCache();
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input, init) => {
        if (String(input).endsWith("/system_stats")) return Response.json({ system: { os: "posix" } });
        posts += 1;
        const inputs = JSON.parse(String(init?.body)).prompt["2"].inputs;
        return posts === 1 && inputs.detector === "bbox/face_yolov8m.pt"
            ? Response.json({ node_errors: plainNameDetectorErrors }, { status: 400 })
            : Response.json({ prompt_id: `job-${posts}` });
    }));

    await expect(submitJob(faceRefineWorkflow, "http://cached-names:8188")).resolves.toBe("job-2");
    await expect(submitJob(faceRefineWorkflow, "http://cached-names:8188")).resolves.toBe("job-3");
    expect(posts).toBe(3);
});

it("keeps an explicit outer node_type_not_found code when its message is only Unknown node", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { type: "node_type_not_found", message: "Unknown node", details: "H3FaceTrackCrop" } }, { status: 400 })));
    const error = await submitJob({ "1": { class_type: "H3FaceTrackCrop", inputs: {} } }, "http://unknown-class:8188").catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("缺少核心依赖插件「ComfyUI-MiniMaxH3-Myang」");
    expect((error as Error).message).toContain("node_type_not_found");
    expect((error as Error).message).toContain("Unknown node");
});
