/**
 * 品牌资源生成器：调用本机 ComfyUI 的 z-image-turbo 文生图 API 出图。
 *
 *   node scripts/gen-assets.mjs                 # 生成全部资源
 *   node scripts/gen-assets.mjs app-icon        # 只生成指定资源
 *   node scripts/gen-assets.mjs --rand          # 每个资源换随机种子
 *   node scripts/gen-assets.mjs --list          # 列出资源与尺寸
 *
 * 产物落在 src/renderer/src/assets/brand/，渲染进程直接 import；
 * 安装向导用的 .ico / .bmp 由这些 PNG 另行转换后放进 build/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.COMFY_API || 'http://127.0.0.1:8188'
const TEMPLATE = path.join(ROOT, 'image_z_image_turbo_api.json')
const OUT_DIR = path.join(ROOT, 'src/renderer/src/assets/brand')

/** 全资源共用的风格锚点：玻璃拟态 + 靛蓝→青渐变 + 深海军蓝底，保证 7 张图风格统一 */
const STYLE =
  'glassmorphism, frosted translucent glass, volumetric glow, deep navy near-black background, ' +
  'vivid indigo to cyan gradient light, soft rim light, cinematic bloom, ultra clean minimal 3d product render, ' +
  'high detail, sharp focus, no text, no letters, no words, no watermark, no logo, no signature'

const NEGATIVE =
  'text, typography, letters, words, numbers, caption, label, sign, poster title, gibberish text, watermark, ' +
  'signature, logo, ui screenshot, blurry, low quality, jpeg artifacts, cluttered, messy, ' +
  'human face, human body, hands, extra fingers, distorted geometry, oversaturated, garish'

/** 每个资源的出图参数（尺寸均为 16 的倍数，z-image-turbo 走 8 步推理） */
const ASSETS = [
  {
    name: 'app-icon',
    width: 1024,
    height: 1024,
    seed: 508274,
    usage: '应用图标 / 安装卸载程序图标 / 侧栏品牌标志',
    prompt:
      'Application icon: one bold rounded square tile of frosted glass that completely fills the entire frame edge ' +
      'to edge, filled with a smooth vivid indigo to cyan gradient, in the center a simple abstract mark of three ' +
      'glowing pale orbs joined by two thin bright light lines forming a small triangle, soft inner glow, subtle ' +
      'bright bevel highlight along the top edge, flat clean 2D icon artwork, no background around the tile, no ' +
      'margin, no outer border, no drop shadow outside the tile, perfectly centered and symmetrical, crisp edges, ' +
      'high contrast, ' +
      STYLE
  },
  {
    name: 'hero-dashboard',
    width: 1536,
    height: 512,
    seed: 331902,
    usage: '仪表盘顶部状态横幅背景',
    prompt:
      'Ultra wide dark technology banner background: an even indigo and cyan gradient light haze filling the whole ' +
      'frame, delicate glowing network lines and tiny bokeh particles spread evenly across the full width, several ' +
      'heavily blurred frosted glass panes floating far in the distance, uniform low contrast so overlaid text stays ' +
      'readable, calm dark space across the middle, no dominant single object, no large solid shape, ' +
      STYLE
  },
  {
    name: 'install-banner',
    width: 1152,
    height: 768,
    seed: 918207,
    usage: '「安装」页主插图',
    prompt:
      'Illustration of a friendly software installation: a large frosted glass cube assembling itself from floating ' +
      'glowing indigo and cyan blocks, a luminous progress arc wrapping around it, tiny glass gears and light ' +
      'particles orbiting slowly, dark navy scene, ' +
      STYLE
  },
  {
    name: 'uninstall-banner',
    width: 1152,
    height: 768,
    seed: 552093,
    usage: '「卸载」相关界面插图',
    prompt:
      'Illustration of a clean and safe removal process: a frosted glass cube gently dissolving into soft flowing ' +
      'indigo and teal light particles and mist, a soft glowing outline left behind, calm orderly reassuring mood, ' +
      'dark navy scene, ' +
      STYLE
  },
  {
    name: 'wizard-side-install',
    width: 512,
    height: 1024,
    seed: 902337,
    usage: 'NSIS 安装向导左侧竖图（164×314）',
    prompt:
      'Vertical abstract poster for an installer wizard: a neat vertical stack of seven translucent frosted glass ' +
      'tiles glowing with an indigo to cyan gradient, softly glowing edges, thin light rays rising above the stack, ' +
      'fine particle dust, the tiles sit in the lower two thirds of the frame, the upper third of the frame is almost ' +
      'completely dark and empty, ' +
      STYLE
  },
  {
    name: 'wizard-side-uninstall',
    width: 512,
    height: 1024,
    seed: 448261,
    usage: 'NSIS 卸载向导左侧竖图（164×314）',
    prompt:
      'Vertical abstract poster for an uninstaller wizard: a translucent frosted glass cube in the lower half of the ' +
      'frame breaking apart into soft indigo and teal light particles and thin mist drifting upward and fading away, ' +
      'a faint glowing outline of the cube left behind, a few small glass shards floating nearby, the upper third of ' +
      'the frame is almost completely dark and empty, ' +
      STYLE
  }
]

const args = process.argv.slice(2)
const wantList = args.includes('--list')
const useRandomSeed = args.includes('--rand')
const only = args.filter(a => !a.startsWith('--'))

if (wantList) {
  for (const a of ASSETS) console.log(`${a.name.padEnd(22)} ${a.width}x${a.height}  ${a.usage}`)
  process.exit(0)
}

const selected = only.length ? ASSETS.filter(a => only.includes(a.name)) : ASSETS
if (!selected.length) {
  console.error(`没有匹配的资源，可选：${ASSETS.map(a => a.name).join(', ')}`)
  process.exit(1)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function api(route, init) {
  const res = await fetch(API + route, init)
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status} ${await res.text()}`)
  return res
}

/** 用模板图搭出本次出图的实际工作流：替换提示词 / 尺寸 / 种子，并接上真正的负面提示词 */
function buildGraph(asset) {
  const graph = JSON.parse(fs.readFileSync(TEMPLATE, 'utf-8'))
  graph['57:27'].inputs.text = asset.prompt
  graph['57:13'].inputs.width = asset.width
  graph['57:13'].inputs.height = asset.height
  graph['57:3'].inputs.seed = asset.seed
  graph['9'].inputs.filename_prefix = `brand/${asset.name}`
  // 模板里负面条件走的是 ConditioningZeroOut（等于没有负面提示词），这里换成真实的负面编码
  graph['57:99'] = {
    inputs: { text: NEGATIVE, clip: ['57:30', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: '负面提示词' }
  }
  graph['57:3'].inputs.negative = ['57:99', 0]
  delete graph['57:33']
  return graph
}

async function generate(asset) {
  const graph = buildGraph(asset)
  const { prompt_id: promptId } = await (
    await api('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: 'comfyui-desk-assets' })
    })
  ).json()
  if (!promptId) throw new Error('提交失败：未返回 prompt_id')

  for (let i = 0; i < 600; i++) {
    await sleep(1000)
    const history = await (await api(`/history/${promptId}`)).json()
    const entry = history[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error(`出图失败：${JSON.stringify(entry.status).slice(0, 400)}`)
    }
    const images = entry.outputs?.['9']?.images
    if (!images?.length) continue

    const saved = []
    for (const img of images) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type })
      const buf = Buffer.from(await (await api(`/view?${q}`)).arrayBuffer())
      const dest = path.join(OUT_DIR, `${asset.name}.png`)
      fs.mkdirSync(OUT_DIR, { recursive: true })
      fs.writeFileSync(dest, buf)
      saved.push(dest)
    }
    return saved
  }
  throw new Error('等待出图超时（10 分钟）')
}

const stats = await (await api('/system_stats')).json()
console.log(`ComfyUI ${stats.system?.comfyui_version} @ ${stats.devices?.[0]?.name || 'cpu'}\n`)

for (const asset of selected) {
  if (useRandomSeed) asset.seed = Math.floor(Math.random() * 2 ** 31)
  process.stdout.write(`→ ${asset.name} (${asset.width}x${asset.height} seed ${asset.seed}) ... `)
  const started = Date.now()
  try {
    setImmediate(() => process.stdout.write(''))
    const files = await generate(asset)
    console.log(`完成 ${((Date.now() - started) / 1000).toFixed(1)}s → ${path.relative(ROOT, files[0])}`)
  } catch (e) {
    console.log(`失败：${e.message}`)
    process.exitCode = 1
  }
}
