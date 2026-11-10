#!/usr/bin/env node
/**
 * 生成内置整合包定义：resources/packs/infinite-canvas/
 *   - 从画面内置 API 工作流反推组件、节点、模型依赖
 *   - 模型来源按 catalog：显式直链 → 家族仓库模板 → 在线按名搜索 → 手动放置
 *   - 工作流复制到 payload/workflows/<component>/
 *   - 无 git 来源的小节点目录从本机 ComfyUI 复制到 payload/custom_nodes/
 *
 * 用法：node scripts/build-pack.mjs
 * 可选环境变量：COMFYUI_ROOT（指向 ComfyUI 根目录，默认从启动器设置/文档目录推断）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/pack-catalog.json'), 'utf-8'))
const API_DIR = path.join(root, 'canvas/web/src/assets/workflows')
const UI_DIR = path.join(root, 'canvas/web/public/workflows')
const OUT_DIR = path.join(root, 'resources/packs/infinite-canvas')
const PACK_VERSION = '1.0.0'

/** 文件名 → models 子目录 */
const MODEL_CATEGORY = {
  ckpt_name: 'checkpoints',
  unet_name: 'diffusion_models',
  vae_name: 'vae',
  clip_name: 'text_encoders',
  lora_name: 'loras',
  control_net_name: 'controlnet'
}

const COMPONENTS = [
  {
    id: 'image',
    name: '图像基础（T2I / I2I / 局部编辑）',
    description: 'Z-Image-Turbo、Qwen-Image-2.1、Flux2.Dev 与 Qwen 局部重绘',
    defaultSelected: true,
    api: ['t2i_z_image_turbo_api.json', 'i2i_flux2_dev_api.json', 'qwen_image_21_api.json', 'inpaint_qwen_image_api.json'],
    ui: [
      'z_image_turbo_workflow.json',
      'flux2_dev_i2i_workflow.json',
      'image_flux2.dev_mult_image_edit_workflow.json',
      'qwen_image_inpaint_workflow.json',
      'mask_edit_workflow.json'
    ]
  },
  {
    id: 'text',
    name: '文本生成 / 反推',
    description: 'Qwen3.5 4B 本地端侧文本生成与视觉反推',
    defaultSelected: true,
    api: ['text_qwen3_5_api.json'],
    ui: ['qwen3_5_text_workflow.json', 'llm_qwen3_5_text_gen_workflow.json']
  },
  {
    id: 'video-omni',
    name: '全能参考视频（6 规格）',
    description: 'MiniMax H3 全能参考：FP8/INT8/BF16 × 20步/4步PDMD/6步Pika/8步Turbo',
    defaultSelected: true,
    api: [
      'video_minimax_h3_omni_fp8_20step_api.json',
      'video_minimax_h3_omni_fp8_4step_pdmd_api.json',
      'video_minimax_h3_omni_int8_4step_pdmd_api.json',
      'video_minimax_h3_omni_int8_6step_pika_api.json',
      'video_minimax_h3_omni_bf16_20step_api.json',
      'video_minimax_h3_omni_bf16_8step_turbo_api.json'
    ],
    ui: [
      'minimax_h3_ref2v_4step_pdmd_workflow.json',
      'minimax_h3_ref2v_int8_convrot_4step_pdmd_workflow.json',
      'minimax_h3_ref2v_workflow.json',
      'minimax_h3_ref2va_workflow.json',
      'minimax_H3_i2v&t2v_workflow.json'
    ]
  },
  {
    id: 'video-frame',
    name: '首尾帧视频（6 规格）',
    description: 'MiniMax H3 首尾帧插值：FP8/INT8/BF16 × 20步/4步PDMD/6步Pika/8步Turbo',
    defaultSelected: true,
    api: [
      'video_minimax_h3_frame_fp8_20step_api.json',
      'video_minimax_h3_frame_fp8_4step_pdmd_api.json',
      'video_minimax_h3_frame_int8_4step_pdmd_api.json',
      'video_minimax_h3_frame_int8_6step_pika_api.json',
      'video_minimax_h3_frame_bf16_20step_api.json',
      'video_minimax_h3_frame_bf16_8step_turbo_api.json'
    ],
    ui: [
      'minimax_h3_fl2va_fp8_4step_pdmd_workflow.json',
      'minimax_h3_fl2va_int8_convrot_4step_pdmd_workflow.json',
      'minimax_h3_fl2va_int8_convrot_6step_pika_workflow.json',
      'minimax_h3_fl2va_workflow.json'
    ]
  },
  {
    id: 'audio',
    name: 'MiniMax Music 03',
    description: '双文本驱动的歌曲 / BGM / 器乐生成',
    defaultSelected: true,
    api: ['audio_minimax_music_3_api.json'],
    ui: ['audio_minimax_music_3_workflow.json']
  },
  {
    id: 'face-refine',
    name: 'H3 人脸精修',
    description: 'YOLO 时序追踪裁剪 + 音频锁 + 逐帧去噪 + 无缝缝合',
    defaultSelected: true,
    api: ['video_h3_face_refine_api.json'],
    ui: ['H3_Face_Refine_Auto_Select_workflow.json'],
    extraModels: [
      { filename: 'person_yolov8m-seg.pt', category: 'ultralytics/segm' },
      { filename: 'face_yolov8m.pt', category: 'ultralytics/bbox' }
    ]
  },
  {
    id: 'depth',
    name: 'ReShot 深度视频',
    description: '单目视频时序连续深度估计（ReShot / Video Depth Anything）',
    defaultSelected: true,
    api: ['video_depth_reshot_api.json'],
    ui: []
  }
]

/** 读启动器设置，推断本机 ComfyUI 根目录与模型目录 */
function resolveLocalRuntime() {
  if (process.env.COMFYUI_ROOT) {
    const comfy = process.env.COMFYUI_ROOT
    return { comfy, models: path.join(comfy, 'models'), customNodes: path.join(comfy, 'custom_nodes') }
  }
  const settingsCandidates = []
  if (os.platform() === 'win32') settingsCandidates.push(path.join(process.env.APPDATA || '', 'comfyui-desk', 'settings.json'))
  settingsCandidates.push(path.join(os.homedir(), '.config', 'comfyui-desk', 'settings.json'))
  let installPath = ''
  let modelPath = ''
  for (const f of settingsCandidates) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf-8'))
      installPath = s.installPath || ''
      modelPath = s.modelPath || ''
      if (installPath) break
    } catch {
      /* ignore */
    }
  }
  if (!installPath) installPath = path.join(os.homedir(), 'Documents', 'ComfyUI-Runtime')
  const comfy = path.join(installPath, 'ComfyUI')
  return {
    comfy,
    models: modelPath || path.join(comfy, 'models'),
    customNodes: path.join(comfy, 'custom_nodes')
  }
}

const runtime = resolveLocalRuntime()

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function exists(p) {
  return fs.existsSync(p)
}

function safeName(p) {
  return path.basename(p).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i, '')
}

/** 按 catalog 解析模型来源（与 src/main/pack-catalog.ts 保持一致） */
function resolveSources(filename, category) {
  const out = []
  const fallback = []
  const push = s => {
    if (!out.some(x => JSON.stringify(x) === JSON.stringify(s))) out.push(s)
  }
  const entry = catalog.models[filename]
  if (entry) {
    for (const s of entry.sources) {
      if (s.type === 'search' || s.type === 'manual') fallback.push(s)
      else push(s)
    }
  }
  for (const rule of catalog.familyRules) {
    let re
    try {
      re = new RegExp(rule.match)
    } catch {
      continue
    }
    if (!re.test(filename)) continue
    const file = rule.prefix ? `${rule.prefix}/${category}/${filename}` : `${category}/${filename}`
    push({ type: 'hf', repo: rule.repo, file, revision: 'main' })
    break
  }
  for (const s of fallback) {
    if (s.type === 'manual') continue
    if (s.type === 'search' && out.some(x => x.type === 'search')) continue
    push(s)
  }
  if (!out.some(s => s.type === 'search')) push({ type: 'search', source: 'hf', query: safeName(filename) })
  push({ type: 'manual' })
  return out
}

function hasCloud(sources) {
  return sources.some(s => s.type !== 'manual')
}

function findLocalModel(filename) {
  const stack = [runtime.models]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && e.name === filename) {
        try {
          return fs.statSync(p).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  return 0
}

/** 分析一个 API 工作流 */
function analyzeApi(file) {
  const data = readJson(path.join(API_DIR, file))
  const nodes = new Set()
  const models = new Map()
  for (const n of Object.values(data)) {
    if (!n || typeof n !== 'object') continue
    if (typeof n.class_type === 'string') nodes.add(n.class_type)
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (typeof v === 'string' && MODEL_CATEGORY[k]) models.set(v, MODEL_CATEGORY[k])
    }
  }
  return { nodes, models }
}

function copyFileIfExists(src, dest) {
  if (!exists(src)) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return true
}

/** 递归复制目录（跳过 __pycache__ 与隐藏缓存） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '__pycache__' || e.name === '.git' || (e.name.startsWith('.') && e.name !== '.gitignore')) continue
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

function main() {
  const coreNodes = new Set(catalog.coreNodes)
  const unknownNodes = new Set(Object.keys(catalog.unknownNodes))
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT_DIR, 'payload/workflows'), { recursive: true })

  const components = []
  const coverage = { unknown: new Set(), manualModels: new Set(), noLink: new Set(), blocked: [] }
  let totalDownload = 0
  const workflowNames = []
  const copied = new Set()

  for (const def of COMPONENTS) {
    const nodeKeys = new Map()
    const modelMap = new Map()
    const workflows = []

    // API 工作流已内置在画布前端产物里，不再重复打进整合包：
    // 这里只借它反推节点与模型依赖；只有 UI 格式工作流随包分发（用于导入 ComfyUI 调试）。
    for (const f of def.api) {
      if (!exists(path.join(API_DIR, f))) {
        console.warn(`[warn] 缺少 API 工作流：${f}`)
        continue
      }
      const { nodes, models } = analyzeApi(f)
      for (const ct of nodes) {
        if (coreNodes.has(ct)) continue
        if (unknownNodes.has(ct)) continue
        const key = catalog.nodeOwners[ct]
        if (!key) {
          coverage.unknown.add(ct)
          console.error(`[error] 未归属节点：${ct}（${f}）`)
          continue
        }
        nodeKeys.set(key, true)
      }
      for (const [filename, category] of models) {
        if (!modelMap.has(`${category}/${filename}`)) modelMap.set(`${category}/${filename}`, { filename, category })
      }
      workflowNames.push(f)
    }

    for (const f of def.ui || []) {
      const src = path.join(UI_DIR, f)
      if (!exists(src)) {
        console.warn(`[warn] 缺少 UI 工作流：${f}`)
        continue
      }
      workflows.push({ name: f.replace(/_workflow\.json$/i, '').replace(/_/g, ' '), format: 'ui', file: `payload/workflows/${def.id}/${f}` })
      if (!copied.has(`${def.id}/${f}`)) {
        copied.add(`${def.id}/${f}`)
        copyFileIfExists(src, path.join(OUT_DIR, 'payload/workflows', def.id, f))
      }
    }

    for (const m of def.extraModels || []) {
      const key = `${m.category}/${m.filename}`
      if (!modelMap.has(key)) modelMap.set(key, { filename: m.filename, category: m.category })
    }

    // 节点条目
    let blockedReason
    const nodes = []
    for (const key of nodeKeys.keys()) {
      const pack = catalog.nodePacks[key]
      if (pack?.url) {
        nodes.push({
          key,
          name: key,
          source: { type: 'git', url: pack.url, ...(pack.commit ? { commit: pack.commit } : {}) },
          requirements: true,
          installPy: true,
          ...(pack.optional ? { optional: true } : {})
        })
        continue
      }
      const bundled = catalog.bundledNodes[key]
      if (bundled) {
        const local = path.join(runtime.customNodes, bundled.localDir)
        if (exists(local)) {
          const rel = `payload/custom_nodes/${bundled.localDir}`
          copyDir(local, path.join(OUT_DIR, rel))
          nodes.push({ key, name: key, source: { type: 'bundle', path: rel }, requirements: true })
        } else {
          blockedReason = blockedReason || `缺少无 git 来源节点 ${key} 的本地目录（${local}）`
        }
        continue
      }
      const unk = catalog.unknownNodes[key]
      if (unk) {
        blockedReason = blockedReason || unk.reason
        continue
      }
      blockedReason = blockedReason || `节点 ${key} 没有可用来源`
    }

    // 模型条目
    const models = []
    for (const { filename, category } of modelMap.values()) {
      const sources = resolveSources(filename, category)
      if (!hasCloud(sources)) coverage.noLink.add(filename)
      if (sources.every(s => s.type === 'manual')) coverage.manualModels.add(filename)
      const size = findLocalModel(filename)
      models.push({ filename, category, ...(size ? { size } : {}), sources })
      totalDownload += size
    }

    components.push({
      id: def.id,
      name: def.name,
      description: def.description,
      defaultSelected: blockedReason ? false : def.defaultSelected !== false,
      ...(blockedReason ? { blockedReason } : {}),
      ...(nodes.length ? { nodes } : {}),
      ...(models.length ? { models } : {}),
      ...(workflows.length ? { workflows } : {})
    })
    if (blockedReason) coverage.blocked.push(`${def.id}: ${blockedReason}`)
  }

  const manifest = {
    schema: 'comfyui-desk/pack@1',
    id: 'infinite-canvas',
    name: '无限画布 · 全能力整合包',
    version: PACK_VERSION,
    createdAt: new Date().toISOString(),
    author: 'ComfyUI Desk',
    description:
      '无限画布内置 8 大能力矩阵的一键还原包：工作流、自定义节点、Python 依赖与模型清单。大模型走云端下载，只有无法下载的小文件才随包分发。',
    requirements: {
      comfyui: { min: '0.44.2', recommended: '0.44.2' },
      python: { min: '3.11', max: '3.13' },
      diskFreeGB: 260,
      vramGB: 8
    },
    components
  }

  fs.writeFileSync(path.join(OUT_DIR, 'comfyui-pack.json'), JSON.stringify(manifest, null, 2) + '\n')

  const readme = [
    '# 无限画布 · 全能力整合包',
    '',
    '导入方式：ComfyUI Desk → 「整合包」页 → 选择本 zip。',
    '',
    '## 组件',
    ...components.map(c => `- ${c.id}: ${c.name}${c.blockedReason ? `（暂不可用：${c.blockedReason}）` : ''}`),
    '',
    '## 模型',
    '模型默认从 HuggingFace / 魔搭按清单下载，不随包分发。',
    '',
    '## 说明',
    'comfyui-pack.json 是本包唯一描述文件，payload/ 仅放工作流与无法从云端获取的小文件。'
  ].join('\n')
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme + '\n')

  const sizeOnDisk = dirSize(OUT_DIR)
  console.log('\n=== 整合包生成完成 ===')
  console.log(`输出：${path.relative(root, OUT_DIR)}  (${(sizeOnDisk / 1048576).toFixed(2)} MB)`)
  const uiCount = components.reduce((n, c) => n + (c.workflows || []).filter(w => w.format === 'ui').length, 0)
  console.log(`工作流：分析 API ${workflowNames.length} 个（不打包），随包 UI ${uiCount} 个`)
  console.log(`模型：${new Set(components.flatMap(c => c.models || []).map(m => m.filename)).size} 个，本机已有字节合计 ${(totalDownload / 1073741824).toFixed(1)} GB`)
  console.log(`无云端来源：${coverage.noLink.size ? [...coverage.noLink].join(', ') : '无'}`)
  console.log(`仅手动来源：${coverage.manualModels.size ? [...coverage.manualModels].join(', ') : '无'}`)
  console.log(`未归属节点：${coverage.unknown.size ? [...coverage.unknown].join(', ') : '无'}`)
  console.log(`阻断组件：${coverage.blocked.length ? coverage.blocked.join(' | ') : '无'}`)
  if (coverage.unknown.size) {
    console.error('[error] 存在未归属的可执行节点，请补充 catalog.nodeOwners 或 unknownNodes')
    process.exit(1)
  }
}

function dirSize(dir) {
  let total = 0
  for (const rel of fs.readdirSync(dir, { recursive: true })) {
    try {
      total += fs.statSync(path.join(dir, rel)).size
    } catch {
      /* ignore */
    }
  }
  return total
}

main()
