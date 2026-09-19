<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api'
import { store, refreshSettings, refreshInfo, loadTorchIndexes, torchLabel } from '../store'
import { buildAdvancedArgs, parseAdvancedArgs, ADV_KEYS } from '../../../shared/advArgs'
import { t, locale, setLocale, type Locale } from '../i18n'
import { theme, setTheme } from '../theme'
import { LOCALE_LABELS, LOCALES, type MessageKey } from '../../../shared/i18n'
import { THEMES, type Theme } from '../../../shared/appearance'

const s = ref<Record<string, unknown>>({})
const adv = ref<Record<string, unknown>>({})
const showAdv = ref(false)
const error = ref('')
/** 自动保存：合并抖动的定时器 + 上次写盘内容（跳过无变化的写入） */
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSaved = ''

const pipMirrors: { v: string; label: MessageKey }[] = [
  { v: 'default', label: 'settings.mirror.pip.pypi' },
  { v: 'tuna', label: 'settings.mirror.pip.tuna' },
  { v: 'aliyun', label: 'settings.mirror.pip.aliyun' },
  { v: 'ustc', label: 'settings.mirror.pip.ustc' }
]

/** 高级启动参数控件描述（分组参照官方 startup-flags） */
interface AdvOption {
  key: string
  label: MessageKey
  type: 'bool' | 'select' | 'number' | 'text'
  options?: { v: string; label: MessageKey }[]
  placeholder?: MessageKey
  hint?: MessageKey
  showIf?: (a: Record<string, unknown>) => boolean
}
interface AdvGroup {
  title: MessageKey
  opts: AdvOption[]
}

const tri = (d: MessageKey): { v: string; label: MessageKey }[] => [
  { v: '', label: d },
  { v: 'on', label: 'settings.adv.tri.on' },
  { v: 'off', label: 'settings.adv.tri.off' }
]

const advGroups: AdvGroup[] = [
  {
    title: 'settings.adv.g.network',
    opts: [
      { key: 'listen', label: 'settings.adv.listen.label', type: 'bool', hint: 'settings.adv.listen.hint' },
      { key: 'enableCors', label: 'settings.adv.enableCors', type: 'bool' },
      { key: 'compressResponse', label: 'settings.adv.compressResponse', type: 'bool' },
      { key: 'maxUploadSize', label: 'settings.adv.maxUploadSize', type: 'number', placeholder: 'settings.adv.maxUploadSize.ph' }
    ]
  },
  {
    title: 'settings.adv.g.startup',
    opts: [
      {
        key: 'autoLaunch',
        label: 'settings.adv.autoLaunch',
        type: 'select',
        options: [
          { v: '', label: 'settings.adv.autoLaunch.default' },
          { v: 'on', label: 'settings.adv.autoLaunch.on' },
          { v: 'off', label: 'settings.adv.autoLaunch.off' }
        ]
      }
    ]
  },
  {
    title: 'settings.adv.g.device',
    opts: [
      { key: 'cudaDevice', label: 'settings.adv.cudaDevice', type: 'text', placeholder: 'settings.adv.cudaDevice.ph' },
      { key: 'cudaMalloc', label: 'settings.adv.cudaMalloc', type: 'select', options: tri('settings.adv.tri.default.torch') },
      { key: 'directml', label: 'settings.adv.directml', type: 'bool' }
    ]
  },
  {
    title: 'settings.adv.g.precision',
    opts: [
      {
        key: 'forceFp', label: 'settings.adv.forceFp', type: 'select',
        options: [
          { v: '', label: 'settings.adv.opt.default' },
          { v: 'fp32', label: 'settings.adv.forceFp.fp32' },
          { v: 'fp16', label: 'settings.adv.forceFp.fp16' }
        ],
        hint: 'settings.adv.forceFp.hint'
      },
      {
        key: 'unetPrecision', label: 'settings.adv.unetPrecision', type: 'select',
        options: [
          { v: '', label: 'settings.adv.opt.default' },
          { v: 'fp32', label: 'settings.adv.opt.fp32' },
          { v: 'fp64', label: 'settings.adv.opt.fp64' },
          { v: 'bf16', label: 'settings.adv.opt.bf16' },
          { v: 'fp16', label: 'settings.adv.opt.fp16' },
          { v: 'fp8_e4m3fn', label: 'settings.adv.opt.fp8e4m3fn' },
          { v: 'fp8_e5m2', label: 'settings.adv.opt.fp8e5m2' },
          { v: 'fp8_e8m0fnu', label: 'settings.adv.opt.fp8e8m0fnu' }
        ]
      },
      {
        key: 'vaePrecision', label: 'settings.adv.vaePrecision', type: 'select',
        options: [
          { v: '', label: 'settings.adv.opt.default' },
          { v: 'fp16', label: 'settings.adv.vaePrecision.fp16' },
          { v: 'fp32', label: 'settings.adv.opt.fp32' },
          { v: 'bf16', label: 'settings.adv.opt.bf16' },
          { v: 'cpu', label: 'settings.adv.vaePrecision.cpu' }
        ]
      },
      {
        key: 'textEncPrecision', label: 'settings.adv.textEncPrecision', type: 'select',
        options: [
          { v: '', label: 'settings.adv.opt.default' },
          { v: 'fp8_e4m3fn', label: 'settings.adv.opt.fp8e4m3fn' },
          { v: 'fp8_e5m2', label: 'settings.adv.opt.fp8e5m2' },
          { v: 'fp16', label: 'settings.adv.opt.fp16' },
          { v: 'fp32', label: 'settings.adv.opt.fp32' },
          { v: 'bf16', label: 'settings.adv.opt.bf16' }
        ]
      },
      { key: 'fp16Intermediates', label: 'settings.adv.fp16Intermediates', type: 'bool' }
    ]
  },
  {
    title: 'settings.adv.g.preview',
    opts: [
      {
        key: 'previewMethod', label: 'settings.adv.previewMethod', type: 'select',
        options: [
          { v: '', label: 'settings.adv.previewMethod.off' },
          { v: 'auto', label: 'settings.adv.previewMethod.auto' },
          { v: 'latent2rgb', label: 'settings.adv.previewMethod.latent2rgb' },
          { v: 'taesd', label: 'settings.adv.previewMethod.taesd' }
        ]
      },
      { key: 'previewSize', label: 'settings.adv.previewSize', type: 'number', placeholder: 'settings.adv.previewSize.ph' }
    ]
  },
  {
    title: 'settings.adv.g.cache',
    opts: [
      {
        key: 'cache', label: 'settings.adv.cache', type: 'select',
        options: [
          { v: '', label: 'settings.adv.cache.ram' },
          { v: 'none', label: 'settings.adv.cache.none' },
          { v: 'classic', label: 'settings.adv.cache.classic' },
          { v: 'lru', label: 'settings.adv.cache.lru' }
        ]
      },
      {
        key: 'cacheLruN', label: 'settings.adv.cacheLruN', type: 'number', placeholder: 'settings.adv.cacheLruN.ph',
        showIf: a => a.cache === 'lru'
      }
    ]
  },
  {
    title: 'settings.adv.g.attention',
    opts: [
      {
        key: 'attention', label: 'settings.adv.attention', type: 'select',
        options: [
          { v: '', label: 'settings.adv.attention.default' },
          { v: 'split', label: 'settings.adv.attention.split' },
          { v: 'quad', label: 'settings.adv.attention.quad' },
          { v: 'pytorch', label: 'settings.adv.attention.pytorch' },
          { v: 'sage', label: 'settings.adv.attention.sage' },
          { v: 'flash', label: 'settings.adv.attention.flash' }
        ]
      },
      { key: 'disableXformers', label: 'settings.adv.disableXformers', type: 'bool' },
      {
        key: 'upcastAttention', label: 'settings.adv.upcastAttention', type: 'select',
        options: [
          { v: '', label: 'settings.adv.opt.default' },
          { v: 'on', label: 'settings.adv.upcastAttention.on' },
          { v: 'off', label: 'settings.adv.upcastAttention.off' }
        ]
      }
    ]
  },
  {
    title: 'settings.adv.g.vram',
    opts: [
      {
        key: 'vramMode', label: 'settings.adv.vramMode', type: 'select',
        options: [
          { v: '', label: 'settings.adv.vramMode.auto' },
          { v: 'gpu-only', label: 'settings.adv.vramMode.gpuOnly' },
          { v: 'highvram', label: 'settings.adv.vramMode.highvram' },
          { v: 'lowvram', label: 'settings.adv.vramMode.lowvram' },
          { v: 'novram', label: 'settings.adv.vramMode.novram' },
          { v: 'cpu', label: 'settings.adv.vramMode.cpu' }
        ]
      },
      { key: 'reserveVram', label: 'settings.adv.reserveVram', type: 'number', placeholder: 'settings.adv.reserveVram.ph' },
      { key: 'asyncOffload', label: 'settings.adv.asyncOffload', type: 'select', options: tri('settings.adv.tri.default.nvidiaOn') },
      { key: 'dynamicVram', label: 'settings.adv.dynamicVram', type: 'select', options: tri('settings.adv.tri.default.nvidiaAuto') },
      { key: 'fastDisk', label: 'settings.adv.fastDisk', type: 'bool' },
      { key: 'disableSmartMemory', label: 'settings.adv.disableSmartMemory', type: 'bool' },
      { key: 'disablePinnedMemory', label: 'settings.adv.disablePinnedMemory', type: 'bool' },
      { key: 'mmap', label: 'settings.adv.mmap', type: 'select', options: tri('settings.adv.opt.default') }
    ]
  },
  {
    title: 'settings.adv.g.perf',
    opts: [
      { key: 'fast', label: 'settings.adv.fast', type: 'bool', hint: 'settings.adv.fast.hint' },
      { key: 'deterministic', label: 'settings.adv.deterministic', type: 'bool' },
      {
        key: 'hashFunction', label: 'settings.adv.hashFunction', type: 'select',
        options: [
          { v: '', label: 'settings.adv.hashFunction.sha256' },
          { v: 'md5', label: 'settings.adv.hashFunction.md5' },
          { v: 'sha1', label: 'settings.adv.hashFunction.sha1' },
          { v: 'sha512', label: 'settings.adv.hashFunction.sha512' }
        ]
      }
    ]
  },
  {
    title: 'settings.adv.g.manager',
    opts: [
      { key: 'enableManager', label: 'settings.adv.enableManager', type: 'bool' },
      { key: 'disableManagerUi', label: 'settings.adv.disableManagerUi', type: 'bool', showIf: a => !!a.enableManager },
      { key: 'managerLegacyUi', label: 'settings.adv.managerLegacyUi', type: 'bool', showIf: a => !!a.enableManager }
    ]
  },
  {
    title: 'settings.adv.g.customNodes',
    opts: [
      { key: 'disableAllCustomNodes', label: 'settings.adv.disableAllCustomNodes', type: 'bool', hint: 'settings.adv.disableAllCustomNodes.hint' },
      { key: 'disableApiNodes', label: 'settings.adv.disableApiNodes', type: 'bool' },
      { key: 'disableMetadata', label: 'settings.adv.disableMetadata', type: 'bool' },
      { key: 'multiUser', label: 'settings.adv.multiUser', type: 'bool' }
    ]
  },
  {
    title: 'settings.adv.g.logs',
    opts: [
      {
        key: 'verbose', label: 'settings.adv.verbose', type: 'select',
        options: [
          { v: '', label: 'settings.adv.verbose.info' },
          { v: 'DEBUG', label: 'settings.adv.verbose.debug' },
          { v: 'WARNING', label: 'settings.adv.verbose.warning' },
          { v: 'ERROR', label: 'settings.adv.verbose.error' },
          { v: 'CRITICAL', label: 'settings.adv.verbose.critical' }
        ]
      },
      { key: 'logStdout', label: 'settings.adv.logStdout', type: 'bool' },
      { key: 'dontPrintServer', label: 'settings.adv.dontPrintServer', type: 'bool' }
    ]
  }
]

const advPreview = computed(() => buildAdvancedArgs(adv.value).join(' '))

/**
 * 高级选项 ↔ 「额外启动参数」双向同步：
 * 改高级选项 → 重新生成参数并替换上次生成的部分（保留手写参数）；
 * 改输入框 → 反向解析已知参数，勾选/取消对应高级选项。
 */
const prevGenerated = ref<string[]>([])
let syncing = false

function argTokens(): string[] {
  return String(s.value.launchArgs || '').split(/\s+/).filter(Boolean)
}

watch(
  adv,
  a => {
    if (syncing) return
    syncing = true
    try {
      const gen = buildAdvancedArgs(a)
      const rest = argTokens()
      for (const t of prevGenerated.value) {
        const i = rest.indexOf(t)
        if (i >= 0) rest.splice(i, 1)
      }
      s.value.launchArgs = [...rest, ...gen].join(' ')
      prevGenerated.value = gen
    } finally {
      syncing = false
    }
  },
  { deep: true }
)

watch(
  () => s.value.launchArgs,
  () => {
    if (syncing) return
    syncing = true
    try {
      const parsed = parseAdvancedArgs(argTokens())
      const next: Record<string, unknown> = { ...adv.value }
      for (const k of ADV_KEYS) {
        if (k in parsed) next[k] = parsed[k]
        else delete next[k]
      }
      adv.value = next
    } finally {
      syncing = false
    }
  }
)

onMounted(async () => {
  const st = (await api.getSettings()) as Record<string, unknown>
  s.value = st
  // 面板状态由文本框反向解析得到（文本框是唯一来源）
  adv.value = parseAdvancedArgs(String(st.launchArgs || '').split(/\s+/).filter(Boolean))
  prevGenerated.value = buildAdvancedArgs(adv.value)
  lastSaved = snapshot()
  void loadTorchIndexes()
})

/** 深拷贝为纯对象：Vue 响应式 Proxy 无法通过 IPC 结构化克隆 */
function snapshot(): string {
  return JSON.stringify(JSON.parse(JSON.stringify({ ...s.value, advArgs: adv.value })))
}

async function saveNow(): Promise<void> {
  const plain = snapshot()
  // 无变化不写盘（双向同步 watcher 会空跑）
  if (plain === lastSaved) return
  error.value = ''
  try {
    await api.saveSettings(JSON.parse(plain))
    lastSaved = plain
    await refreshSettings()
    await refreshInfo()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

/** 改动即保存：输入类改动合并到 400ms 后写盘，避免每敲一个字符发一次 IPC */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveNow(), 400)
}

watch([s, adv], scheduleSave, { deep: true })

async function pick(key: string) {
  const d = await api.pickDir()
  if (d) s.value[key] = d
}

/** 主题 / 语言：立即生效并落盘 */
async function applyTheme(v: Theme): Promise<void> {
  setTheme(v)
  await api.saveSettings({ theme: v })
  await refreshSettings()
}

async function applyLocale(v: Locale): Promise<void> {
  setLocale(v)
  await api.saveSettings({ locale: v })
  await refreshSettings()
}
</script>

<template>
  <div>
    <div class="page-title">{{ t('settings.title') }}</div>
    <div class="muted" style="margin-top: 6px; margin-bottom: 16px">{{ t('settings.autosaveNote') }}</div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>

    <div class="card">
      <h3>{{ t('settings.appearance.title') }}</h3>
      <div class="row" style="gap: 28px; align-items: flex-start">
        <div class="field" style="margin: 0">
          <label>{{ t('settings.appearance.theme') }}</label>
          <div class="chips" style="margin: 0">
            <div v-for="v in THEMES" :key="v" class="chip" :class="{ active: theme === v }" @click="applyTheme(v)">
              {{ t(v === 'dark' ? 'settings.appearance.theme.dark' : 'settings.appearance.theme.light') }}
            </div>
          </div>
        </div>
        <div class="field" style="margin: 0">
          <label>{{ t('settings.appearance.locale') }}</label>
          <div class="chips" style="margin: 0">
            <div v-for="v in LOCALES" :key="v" class="chip" :class="{ active: locale === v }" @click="applyLocale(v)">
              {{ LOCALE_LABELS[v] }}
            </div>
          </div>
        </div>
      </div>
      <div class="field row" style="gap: 6px; align-items: center; margin-top: 14px">
        <input id="syncComfyTheme" v-model="(s.syncComfyTheme as boolean)" type="checkbox" />
        <label for="syncComfyTheme" style="margin: 0">{{ t('settings.appearance.syncComfyTheme') }}</label>
      </div>
    </div>

    <div class="card">
      <h3>{{ t('settings.launch.title') }}</h3>
      <div class="row" style="align-items: flex-start">
        <div class="field" style="width: 160px; flex-shrink: 0">
          <label>{{ t('settings.launch.port') }}</label>
          <input v-model.number="(s.port as number)" type="number" min="1" max="65535" />
        </div>
        <div class="field" style="flex: 1">
          <label>{{ t('settings.launch.extraArgs') }}</label>
          <input v-model="(s.launchArgs as string)" type="text" :placeholder="t('settings.launch.extraArgs.ph')" />
        </div>
      </div>

      <div class="adv-toggle" @click="showAdv = !showAdv">
        <span class="ico" :class="{ open: showAdv }">▶</span>
        <span class="t">{{ t('settings.adv.toggle') }}</span>
        <span class="sub">{{ t('settings.adv.sub') }}</span>
      </div>

      <div v-show="showAdv" class="adv-body">
        <div v-for="g in advGroups" :key="g.title" class="adv-group">
          <div class="adv-group-title">{{ t(g.title) }}</div>
          <div class="adv-grid">
            <template v-for="o in g.opts" :key="o.key">
              <label
                v-if="o.type === 'bool'"
                v-show="!o.showIf || o.showIf(adv)"
                class="adv-check"
                :title="t(o.hint || o.label)"
              >
                <input v-model="adv[o.key]" type="checkbox" />
                <span>{{ t(o.label) }}</span>
              </label>
              <div v-else v-show="!o.showIf || o.showIf(adv)" class="adv-field">
                <label>{{ t(o.label) }}</label>
                <select v-if="o.type === 'select'" v-model="adv[o.key]">
                  <option v-for="op in o.options" :key="op.v" :value="op.v">{{ t(op.label) }}</option>
                </select>
                <input
                  v-else
                  v-model="adv[o.key]"
                  :type="o.type === 'number' ? 'number' : 'text'"
                  :placeholder="o.placeholder ? t(o.placeholder) : undefined"
                />
                <div v-if="o.hint" class="hint">{{ t(o.hint) }}</div>
              </div>
            </template>
          </div>
        </div>

        <div v-if="advPreview" class="adv-preview">
          <span class="k">{{ t('settings.adv.preview') }}</span>
          <code class="mono">{{ advPreview }}</code>
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>{{ t('settings.mirror.title') }}</h3>
        <div class="field">
          <label>{{ t('settings.mirror.repo') }}</label>
          <select v-model="(s.gitMirror as string)">
            <option value="github">{{ t('settings.mirror.repo.github') }}</option>
            <option value="gitcode">{{ t('settings.mirror.repo.gitcode') }}</option>
            <option value="custom">{{ t('settings.mirror.repo.custom') }}</option>
          </select>
        </div>
        <div class="field" v-if="s.gitMirror === 'custom'">
          <label>{{ t('settings.mirror.customRepo') }}</label>
          <input v-model="(s.customRepoUrl as string)" type="text" placeholder="https://..." />
        </div>
        <div class="field">
          <label>{{ t('settings.mirror.gitProxy') }}</label>
          <input v-model="(s.gitProxyPrefix as string)" type="text" :placeholder="t('settings.mirror.gitProxy.ph')" />
          <div class="hint">{{ t('settings.mirror.gitProxy.hint') }}</div>
        </div>
        <div class="field">
          <label>{{ t('settings.mirror.pip') }}</label>
          <select v-model="(s.pipMirror as string)">
            <option v-for="m in pipMirrors" :key="m.v" :value="m.v">{{ t(m.label) }}</option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('settings.mirror.torch') }}</label>
          <select v-model="(s.torchMirror as string)">
            <option value="official">{{ t('settings.mirror.torch.official') }}</option>
            <option value="aliyun">{{ t('settings.mirror.torch.aliyun') }}</option>
          </select>
          <div class="hint">{{ t('settings.mirror.torch.hint') }}</div>
        </div>
      </div>

      <div class="card">
        <h3>{{ t('settings.paths.title') }}</h3>
        <div class="field">
          <label>{{ t('settings.paths.modelPath') }}</label>
          <div class="row">
            <input v-model="(s.modelPath as string)" type="text" placeholder="D:\AI\Models" style="flex: 1" />
            <button class="btn" @click="pick('modelPath')">{{ t('common.browse') }}</button>
          </div>
        </div>
        <div class="field">
          <label>{{ t('settings.paths.installPath') }}</label>
          <div class="row">
            <input v-model="(s.installPath as string)" type="text" style="flex: 1" />
            <button class="btn" @click="pick('installPath')">{{ t('common.browse') }}</button>
          </div>
        </div>
        <div class="field row" style="gap: 6px; align-items: center">
          <input id="hfm" v-model="(s.hfMirror as boolean)" type="checkbox" />
          <label for="hfm" style="margin: 0">{{ t('settings.paths.hfMirror') }}</label>
        </div>
      </div>

      <div class="card">
        <h3>{{ t('settings.env.title') }}</h3>
        <div class="field">
          <label>{{ t('settings.env.torchIndex') }}</label>
          <select v-model="(s.torchIndex as string)">
            <option value="auto">{{ t('settings.env.torchIndex.auto') }}</option>
            <option v-for="ti in store.torchIndexes" :key="ti" :value="ti">{{ torchLabel(ti) }}</option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('settings.env.python') }}</label>
          <input v-model="(s.pythonPath as string)" type="text" placeholder="C:\...\python.exe" />
        </div>
      </div>
    </div>
  </div>
</template>
