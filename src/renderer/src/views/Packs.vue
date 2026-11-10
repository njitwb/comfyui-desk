<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import type {
  PackApplyResult,
  PackComponentSummary,
  PackExportCandidate,
  PackExportResult,
  PackInspectResult,
  PackItemState,
  PackItemStatus,
  PackModelExportStrategy,
  PackProgressEvent,
  PackRecord
} from '../../../shared/pack'
import type { MessageKey } from '../../../shared/i18n'

type Mode = 'import' | 'export'

const mode = ref<Mode>('import')
const error = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

function showError(e: unknown): void {
  error.value = (e as Error).message || String(e)
}

function human(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i <= 1 ? 0 : 1)} ${units[i]}`
}

// ---- 导入 ----
const inspect = ref<PackInspectResult | null>(null)
const selected = ref<Set<string>>(new Set())
const inspecting = ref(false)
const applying = ref(false)
const applyResult = ref<PackApplyResult | null>(null)
const progress = ref<{ stage: string; message: string; percent: number } | null>(null)
const itemStates = ref<Record<string, PackItemState>>({})
const applyError = ref('')
let offProgress: (() => void) | null = null

const selectedComponents = computed<PackComponentSummary[]>(() => {
  const list = inspect.value?.components || []
  return list.filter(c => selected.value.has(c.id))
})

const selectedItems = computed<PackItemState[]>(() => {
  if (!inspect.value) return []
  const ids = new Set(selectedComponents.value.map(c => c.id))
  return inspect.value.items.filter(i => ids.has(i.componentId))
})

const totals = computed(() => {
  let nodes = 0
  let models = 0
  let workflows = 0
  let bytes = 0
  for (const c of selectedComponents.value) {
    nodes += c.nodeCount
    models += c.modelCount
    workflows += c.workflowCount
    bytes += c.downloadBytes
  }
  return { nodes, models, workflows, bytes }
})

const requiredDisk = computed(() => inspect.value?.manifest.requirements?.diskFreeGB || 0)

async function runInspect(ref: string): Promise<void> {
  inspecting.value = true
  error.value = ''
  applyResult.value = null
  applyError.value = ''
  progress.value = null
  itemStates.value = {}
  try {
    const r = await api.packInspect(ref)
    inspect.value = r
    const next = new Set<string>()
    for (const c of r.components) if (c.defaultSelected && !c.blocked) next.add(c.id)
    selected.value = next
  } catch (e) {
    inspect.value = null
    showError(e)
  } finally {
    inspecting.value = false
  }
}

async function pickZip(): Promise<void> {
  try {
    const p = await api.packPickZip()
    if (p) await runInspect(p)
  } catch (e) {
    showError(e)
  }
}

async function useBuiltin(): Promise<void> {
  await runInspect('builtin:infinite-canvas')
}

function toggleComponent(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAll(): void {
  selected.value = new Set((inspect.value?.components || []).filter(c => !c.blocked).map(c => c.id))
}

function selectNone(): void {
  selected.value = new Set()
}

async function startImport(): Promise<void> {
  if (!inspect.value) return showToast(t('packs.selectZipFirst'))
  if (!selectedComponents.value.length) return showToast(t('packs.selectComponent'))
  const body = t('packs.confirmBody', {
    nodes: String(totals.value.nodes),
    models: String(totals.value.models),
    workflows: String(totals.value.workflows),
    size: human(totals.value.bytes)
  })
  if (!confirm(`${t('packs.confirmTitle')}\n\n${body}`)) return
  applying.value = true
  applyError.value = ''
  progress.value = null
  itemStates.value = {}
  try {
    const r = await api.packApply({
      zipPath: inspect.value.zipPath,
      components: [...selected.value],
      continueOnManual: true
    })
    applyResult.value = r
    if (r.error) applyError.value = r.error
    await loadInstalled()
  } catch (e) {
    showError(e)
  } finally {
    applying.value = false
  }
}

async function cancelApply(): Promise<void> {
  try {
    await api.packCancel()
  } catch (e) {
    showError(e)
  }
}

async function restartComfy(): Promise<void> {
  try {
    await api.restart()
    showToast(t('app.status.starting'))
  } catch (e) {
    showError(e)
  }
}

function onProgressEvent(e: PackProgressEvent): void {
  if (e.kind === 'stage') {
    progress.value = { stage: e.stage, message: e.message, percent: e.percent }
    return
  }
  if (e.kind === 'item') {
    itemStates.value = { ...itemStates.value, [e.item.id]: e.item }
    return
  }
  if (e.kind === 'log') {
    // 日志只更新到进度行，避免刷屏
    if (progress.value) progress.value = { ...progress.value, message: e.message }
  }
}

const stageLabel: Record<string, MessageKey> = {
  prepare: 'packs.stagePrepare',
  nodes: 'packs.stageNodes',
  assets: 'packs.stageAssets',
  pip: 'packs.stagePip',
  models: 'packs.stageModels',
  workflows: 'packs.stageWorkflows',
  done: 'packs.stageDone'
}

function stageText(stage: string): string {
  const key = stageLabel[stage]
  return key ? t(key) : stage
}

const statusLabel: Record<PackItemStatus, MessageKey> = {
  ok: 'packs.statusOk',
  missing: 'packs.statusMissing',
  mismatch: 'packs.statusMismatch',
  manual: 'packs.statusManual',
  unknown: 'packs.statusUnknown'
}

const statusClass: Record<PackItemStatus, string> = {
  ok: 'pass',
  missing: 'warn',
  mismatch: 'warn',
  manual: 'warn',
  unknown: 'fail'
}

const kindLabel: Record<PackItemState['kind'], MessageKey> = {
  node: 'packs.kindNode',
  model: 'packs.kindModel',
  workflow: 'packs.kindWorkflow',
  asset: 'packs.kindAsset'
}

function itemOf(id: string, fallback: PackItemState): PackItemState {
  return itemStates.value[id] || fallback
}

function componentsItems(componentId: string): PackItemState[] {
  return selectedItems.value.filter(i => i.componentId === componentId)
}

async function copyPath(p: string): Promise<void> {
  try {
    await api.clipboardWrite(p)
    showToast(t('packs.copied'))
  } catch (e) {
    showError(e)
  }
}

// ---- 导出 ----
const exportSource = ref<'builtin' | 'current'>('builtin')
const candidate = ref<PackExportCandidate | null>(null)
const exportSelected = ref<Set<string>>(new Set())
const modelStrategies = ref<Record<string, PackModelExportStrategy>>({})
const includeUi = ref(true)
const exporting = ref(false)
const exportResult = ref<PackExportResult | null>(null)

const exportSelectedModels = computed(() => {
  if (!candidate.value) return []
  return candidate.value.models
})

async function loadCandidate(): Promise<void> {
  error.value = ''
  try {
    const c = await api.packExportPreview(exportSource.value)
    candidate.value = c
    exportSelected.value = new Set(c.components.filter(x => !x.blocked).map(x => x.id))
    const next: Record<string, PackModelExportStrategy> = {}
    for (const m of c.models) next[`${m.category}/${m.filename}`] = m.hasLink ? 'link' : 'skip'
    modelStrategies.value = next
  } catch (e) {
    candidate.value = null
    showError(e)
  }
}

function toggleExportComponent(id: string): void {
  const next = new Set(exportSelected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  exportSelected.value = next
}

function setStrategy(key: string, s: PackModelExportStrategy): void {
  modelStrategies.value = { ...modelStrategies.value, [key]: s }
}

const strategyCount = computed(() => {
  const v = Object.values(modelStrategies.value)
  return {
    link: v.filter(x => x === 'link').length,
    bundle: v.filter(x => x === 'bundle').length,
    skip: v.filter(x => x === 'skip').length
  }
})

async function startExport(): Promise<void> {
  if (!exportSelected.value.size) return showToast(t('packs.selectComponent'))
  exporting.value = true
  error.value = ''
  exportResult.value = null
  try {
    const r = await api.packExport({
      source: exportSource.value,
      builtinId: exportSource.value === 'builtin' ? 'infinite-canvas' : undefined,
      components: [...exportSelected.value],
      modelStrategies: modelStrategies.value,
      includeUiWorkflows: includeUi.value,
      outPath: ''
    })
    exportResult.value = r
    showToast(t('packs.exportDone', { path: r.outPath }))
  } catch (e) {
    showError(e)
  } finally {
    exporting.value = false
  }
}

async function revealOut(): Promise<void> {
  if (exportResult.value) await api.revealFile(exportResult.value.outPath)
}

// ---- 已安装记录 ----
const installed = ref<PackRecord[]>([])

async function loadInstalled(): Promise<void> {
  try {
    installed.value = await api.packInstalled()
  } catch (e) {
    showError(e)
  }
}

/** 归档：切换模式时按需加载候选项 */
async function switchMode(m: Mode): Promise<void> {
  mode.value = m
  error.value = ''
  if (m === 'export' && !candidate.value) await loadCandidate()
}

onMounted(async () => {
  offProgress = api.onPackProgress(onProgressEvent)
  await loadInstalled()
})

onUnmounted(() => {
  offProgress?.()
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div>
    <div class="page-hero">
      <div class="page-hero-body">
        <div class="page-title">{{ t('packs.title') }}</div>
        <div class="page-desc">{{ t('packs.desc') }}</div>
      </div>
    </div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>
    <div v-if="toast" class="card" style="border-color: var(--green); color: var(--green)">{{ toast }}</div>

    <div class="row" style="margin-bottom: 16px">
      <button class="btn" :class="{ primary: mode === 'import' }" @click="switchMode('import')">
        {{ t('packs.importTitle') }}
      </button>
      <button class="btn" :class="{ primary: mode === 'export' }" @click="switchMode('export')">
        {{ t('packs.exportTitle') }}
      </button>
    </div>

    <!-- 导入 -->
    <template v-if="mode === 'import'">
      <div class="card">
        <h3>{{ t('packs.importTitle') }}</h3>
        <p class="muted" style="margin-bottom: 12px">{{ t('packs.importDesc') }}</p>
        <div class="row wrap">
          <button class="btn primary" :disabled="inspecting || applying" @click="pickZip">
            {{ inspecting ? t('packs.scanning') : t('packs.pickZip') }}
          </button>
          <button class="btn" :disabled="inspecting || applying" @click="useBuiltin">
            {{ t('packs.useBuiltin') }}
          </button>
        </div>
        <p class="muted" style="margin-top: 10px">{{ t('packs.builtinHint') }}</p>
      </div>

      <template v-if="inspect">
        <!-- 包信息 -->
        <div class="card">
          <div class="row" style="margin-bottom: 10px">
            <h3 style="margin: 0">{{ t('packs.summary') }} · {{ inspect.manifest.name }}</h3>
            <div class="spacer"></div>
            <span class="pill running"><span class="dot"></span>{{ inspect.manifest.version }}</span>
          </div>
          <div class="grid grid-2">
            <div class="muted">
              <div>{{ t('packs.version') }}: {{ inspect.manifest.version }}</div>
              <div>{{ t('packs.author') }}: {{ inspect.manifest.author || '—' }}</div>
              <div>{{ t('packs.createdAt') }}: {{ inspect.manifest.createdAt }}</div>
            </div>
            <div class="muted">
              <div>{{ t('packs.size') }}: {{ human(inspect.packSize) }}</div>
              <div v-if="requiredDisk">{{ t('packs.diskRequired') }}: {{ requiredDisk }} GB</div>
              <div>{{ t('packs.requirements') }}: ComfyUI ≥ {{ inspect.manifest.requirements?.comfyui?.min || '—' }}</div>
            </div>
          </div>
          <p v-if="inspect.manifest.description" class="muted" style="margin-top: 10px">{{ inspect.manifest.description }}</p>
          <div v-if="inspect.warnings.length" style="margin-top: 12px">
            <div style="font-weight: 600; margin-bottom: 6px">{{ t('packs.warnings') }}</div>
            <div v-for="(w, i) in inspect.warnings" :key="i" class="muted">· {{ w }}</div>
          </div>
        </div>

        <!-- 环境 -->
        <div class="card">
          <h3>{{ t('packs.envTitle') }}</h3>
          <div class="diag-item">
            <div class="diag-badge" :class="inspect.env.comfyInstalled ? 'pass' : 'fail'">{{ inspect.env.comfyInstalled ? '✓' : '✕' }}</div>
            <div>
              <div style="font-weight: 600">{{ t('packs.envComfy') }}</div>
              <div class="muted mono">
                {{ inspect.env.comfyInstalled ? `${inspect.env.comfyVersion} · ${inspect.env.versionOk ? t('packs.envVersionOk') : t('packs.envVersionLow')}` : t('packs.envNotInstalled') }}
              </div>
            </div>
          </div>
          <div class="diag-item">
            <div class="diag-badge" :class="inspect.env.venvOk ? 'pass' : 'fail'">{{ inspect.env.venvOk ? '✓' : '✕' }}</div>
            <div>
              <div style="font-weight: 600">{{ t('packs.envVenv') }}</div>
              <div class="muted mono">{{ inspect.env.pythonVersion || '—' }}</div>
            </div>
          </div>
          <div class="diag-item">
            <div class="diag-badge" :class="requiredDisk && inspect.env.diskFreeBytes < requiredDisk * 1073741824 ? 'warn' : 'pass'">i</div>
            <div>
              <div style="font-weight: 600">{{ t('packs.envDisk') }}</div>
              <div class="muted mono">{{ human(inspect.env.diskFreeBytes) }} · {{ inspect.env.modelsRoot }}</div>
            </div>
          </div>
        </div>

        <!-- 组件 -->
        <div class="card">
          <div class="row" style="margin-bottom: 10px">
            <h3 style="margin: 0">{{ t('packs.componentsTitle') }}</h3>
            <div class="spacer"></div>
            <button class="btn small" :disabled="applying" @click="selectAll">{{ t('packs.selectAll') }}</button>
            <button class="btn small" :disabled="applying" @click="selectNone">{{ t('packs.selectNone') }}</button>
          </div>
          <div v-if="inspect.components.length">
            <label
              v-for="c in inspect.components"
              :key="c.id"
              class="diag-item"
              style="cursor: pointer"
              :style="c.blocked ? 'opacity: .55' : ''"
            >
              <input
                type="checkbox"
                :checked="selected.has(c.id)"
                :disabled="c.blocked || applying"
                @change="toggleComponent(c.id)"
              />
              <div style="flex: 1">
                <div style="font-weight: 600">{{ c.name }}</div>
                <div class="muted">{{ t('packs.componentMeta', { workflows: String(c.workflowCount), nodes: String(c.nodeCount), models: String(c.modelCount) }) }}</div>
                <div class="muted">{{ c.description }}</div>
                <div v-if="c.blocked" style="color: var(--yellow); font-size: 12px">
                  {{ t('packs.blocked', { reason: c.blockReason || '—' }) }}
                </div>
                <div v-else class="muted" style="font-size: 12px">
                  {{ t('packs.downloadTotal', { size: human(c.downloadBytes) }) }}
                  <span v-if="c.missingModels"> · {{ t('packs.missingModels', { n: String(c.missingModels) }) }}</span>
                </div>
              </div>
            </label>
          </div>
          <div v-else class="empty">{{ t('packs.emptyComponents') }}</div>
        </div>

        <!-- 预检明细 -->
        <div class="card">
          <h3>{{ t('packs.preflightTitle') }}（{{ t('packs.downloadTotal', { size: human(totals.bytes) }) }}）</h3>
          <div v-if="selectedComponents.length">
            <details v-for="c in selectedComponents" :key="c.id" open style="margin-bottom: 10px">
              <summary style="cursor: pointer; font-weight: 600; margin-bottom: 8px">{{ c.name }}</summary>
              <div v-if="componentsItems(c.id).length" style="max-height: 320px; overflow: auto">
                <div
                  v-for="it in componentsItems(c.id)"
                  :key="it.id"
                  class="diag-item"
                >
                  <div class="diag-badge" :class="statusClass[itemOf(it.id, it).status]">
                    {{ itemOf(it.id, it).status === 'ok' ? '✓' : itemOf(it.id, it).status === 'unknown' ? '✕' : '!' }}
                  </div>
                  <div style="flex: 1; min-width: 0">
                    <div style="font-weight: 600">
                      <span class="muted">[{{ t(kindLabel[it.kind]) }}]</span>
                      {{ it.name }}
                      <span class="muted" style="font-weight: 400">· {{ t(statusLabel[itemOf(it.id, it).status]) }}</span>
                      <span v-if="it.sourceLabel" class="muted" style="font-weight: 400"> · {{ it.sourceLabel }}</span>
                    </div>
                    <div class="muted mono" style="word-break: break-all">{{ itemOf(it.id, it).message || it.target }}</div>
                  </div>
                  <button v-if="itemOf(it.id, it).status === 'manual'" class="btn small" @click="copyPath(it.target)">
                    {{ t('packs.copyPath') }}
                  </button>
                </div>
              </div>
              <div v-else class="muted">—</div>
            </details>
          </div>
          <div v-else class="empty">{{ t('packs.selectComponent') }}</div>
        </div>

        <!-- 执行 -->
        <div class="card">
          <div class="row">
            <button
              class="btn primary"
              :disabled="applying || !selectedComponents.length || !inspect.env.comfyInstalled || !inspect.env.venvOk"
              @click="startImport"
            >
              {{ applying ? t('packs.progressTitle') : t('packs.start') }}
            </button>
            <button v-if="applying" class="btn danger" @click="cancelApply">{{ t('packs.cancel') }}</button>
            <div class="spacer"></div>
            <span class="muted">{{ t('packs.downloadTotal', { size: human(totals.bytes) }) }}</span>
          </div>

          <div v-if="progress" style="margin-top: 14px">
            <div class="row" style="margin-bottom: 6px">
              <span style="font-weight: 600">{{ stageText(progress.stage) }}</span>
              <div class="spacer"></div>
              <span class="muted">{{ Math.round(progress.percent) }}%</span>
            </div>
            <div class="progress-track"><div class="progress-fill" :style="{ width: progress.percent + '%' }"></div></div>
            <div class="muted mono" style="margin-top: 6px; word-break: break-all">{{ progress.message }}</div>
          </div>

          <div v-if="applyResult" style="margin-top: 14px">
            <div v-if="applyError" class="muted" style="color: var(--red); margin-bottom: 8px">{{ applyError }}</div>
            <div class="row wrap" style="margin-bottom: 8px">
              <span class="pill running"><span class="dot"></span>{{ t('packs.resultInstalled', { n: String(applyResult.installed.length) }) }}</span>
              <span class="pill">{{ t('packs.resultSkipped', { n: String(applyResult.skipped.length) }) }}</span>
              <span class="pill" :class="applyResult.failed.length ? 'error' : ''">{{ t('packs.resultFailed', { n: String(applyResult.failed.length) }) }}</span>
              <span class="pill" :class="applyResult.manual.length ? 'starting' : ''">{{ t('packs.resultManual', { n: String(applyResult.manual.length) }) }}</span>
            </div>
            <div v-if="applyResult.restartRequired" style="margin-bottom: 10px">
              <div class="muted" style="margin-bottom: 8px">{{ t('packs.restartHint') }}</div>
              <button class="btn" @click="restartComfy">{{ t('packs.restart') }}</button>
            </div>
            <details v-if="applyResult.manual.length" open>
              <summary style="cursor: pointer; font-weight: 600">{{ t('packs.resultManual', { n: String(applyResult.manual.length) }) }}</summary>
              <div v-for="m in applyResult.manual" :key="m.name" class="diag-item">
                <div style="flex: 1; min-width: 0">
                  <div style="font-weight: 600">{{ m.name }}</div>
                  <div class="muted mono" style="word-break: break-all">{{ m.target }}</div>
                </div>
                <button class="btn small" @click="copyPath(m.target)">{{ t('packs.copyPath') }}</button>
              </div>
            </details>
            <details v-if="applyResult.failed.length" open style="margin-top: 10px">
              <summary style="cursor: pointer; font-weight: 600; color: var(--red)">{{ t('packs.resultFailed', { n: String(applyResult.failed.length) }) }}</summary>
              <div v-for="f in applyResult.failed" :key="f.name" class="diag-item">
                <div class="diag-badge fail">✕</div>
                <div>
                  <div style="font-weight: 600">{{ f.name }}</div>
                  <div class="muted mono" style="word-break: break-all">{{ f.error }}</div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </template>
    </template>

    <!-- 导出 -->
    <template v-else>
      <div class="card">
        <h3>{{ t('packs.exportTitle') }}</h3>
        <p class="muted" style="margin-bottom: 12px">{{ t('packs.exportDesc') }}</p>
        <div class="row wrap">
          <select v-model="exportSource" style="width: 220px" @change="loadCandidate">
            <option value="builtin">{{ t('packs.sourceBuiltin') }}</option>
            <option value="current">{{ t('packs.sourceCurrent') }}</option>
          </select>
          <label class="row" style="gap: 6px">
            <input v-model="includeUi" type="checkbox" />
            <span class="muted">{{ t('packs.exportUi') }}</span>
          </label>
        </div>
      </div>

      <div v-if="candidate" class="card">
        <h3>{{ candidate.name }} · {{ candidate.version }}</h3>
        <div v-if="candidate.components.length">
          <label
            v-for="c in candidate.components"
            :key="c.id"
            class="diag-item"
            style="cursor: pointer"
            :style="c.blocked ? 'opacity: .55' : ''"
          >
            <input type="checkbox" :checked="exportSelected.has(c.id)" :disabled="c.blocked || exporting" @change="toggleExportComponent(c.id)" />
            <div>
              <div style="font-weight: 600">{{ c.name }}</div>
              <div class="muted">{{ t('packs.componentMeta', { workflows: String(c.workflowCount), nodes: String(c.nodeCount), models: String(c.modelCount) }) }}</div>
            </div>
          </label>
        </div>
        <div v-else class="empty">{{ t('packs.emptyComponents') }}</div>

        <div class="row wrap" style="margin-top: 12px">
          <span class="muted">{{ t('packs.exportStrategies') }}:</span>
          <span class="pill running">{{ t('packs.strategyLink') }} {{ strategyCount.link }}</span>
          <span class="pill">{{ t('packs.strategyBundle') }} {{ strategyCount.bundle }}</span>
          <span class="pill">{{ t('packs.strategySkip') }} {{ strategyCount.skip }}</span>
        </div>

        <div style="max-height: 360px; overflow: auto; margin-top: 12px">
          <div v-for="m in exportSelectedModels" :key="m.category + '/' + m.filename" class="diag-item">
            <div style="flex: 1; min-width: 0">
              <div style="font-weight: 600">{{ m.filename }}</div>
              <div class="muted mono">{{ m.category }} · {{ m.size ? human(m.size) : t('packs.sizeUnknown') }} · {{ m.hasLink ? m.sourceLabel : t('packs.noLink') }}</div>
            </div>
            <select
              style="width: 150px"
              :value="modelStrategies[m.category + '/' + m.filename] || (m.hasLink ? 'link' : 'skip')"
              @change="setStrategy(m.category + '/' + m.filename, ($event.target as HTMLSelectElement).value as PackModelExportStrategy)"
            >
              <option value="link">{{ t('packs.strategyLink') }}</option>
              <option value="bundle">{{ t('packs.strategyBundle') }}</option>
              <option value="skip">{{ t('packs.strategySkip') }}</option>
            </select>
          </div>
        </div>

        <div class="row" style="margin-top: 14px">
          <button class="btn primary" :disabled="exporting || !exportSelected.size" @click="startExport">
            {{ exporting ? t('packs.exporting') : t('packs.exportStart') }}
          </button>
        </div>

        <div v-if="exportResult" style="margin-top: 14px">
          <div class="muted mono" style="word-break: break-all">
            {{ t('packs.exportDone', { path: exportResult.outPath }) }} · {{ human(exportResult.size) }}
          </div>
          <div v-if="exportResult.missingLinks.length" class="muted" style="color: var(--yellow); margin-top: 6px">
            {{ t('packs.exportMissingLinks', { n: String(exportResult.missingLinks.length) }) }}
            <div class="mono">{{ exportResult.missingLinks.join(', ') }}</div>
          </div>
          <button class="btn small" style="margin-top: 8px" @click="revealOut">{{ t('common.reveal') }}</button>
        </div>
      </div>
      <div v-else class="card empty">{{ t('packs.scanning') }}</div>
    </template>

    <!-- 已导入记录 -->
    <div class="card">
      <h3>{{ t('packs.installedTitle') }}</h3>
      <div v-if="installed.length">
        <div v-for="r in installed" :key="r.id + r.installedAt" class="diag-item">
          <div class="diag-badge pass">✓</div>
          <div>
            <div style="font-weight: 600">{{ r.name }} · {{ r.version }}</div>
            <div class="muted mono">{{ r.installedAt }} · {{ r.components.join(', ') }}</div>
          </div>
        </div>
      </div>
      <div v-else class="empty">{{ t('packs.noInstalled') }}</div>
    </div>
  </div>
</template>
