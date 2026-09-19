<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { store, refreshInfo, loadTorchIndexes, torchLabel } from '../store'
import type { GpuInfo, PythonInfo, ProgressEvent } from '../../../shared/api'
import installBanner from '../assets/brand/install-banner.png'

const pythons = ref<PythonInfo[]>([])
const pythonPath = ref('')
const versions = ref<string[]>([])
const version = ref('')
const installPath = ref('')
const torchIndex = ref('auto')
const gpus = ref<GpuInfo[]>([])
const installing = ref(false)
const progress = ref<ProgressEvent | null>(null)
const tail = ref<string[]>([])
const error = ref('')
const done = ref(false)
const logEl = ref<HTMLElement | null>(null)

const canInstall = computed(
  () => pythonPath.value && version.value && installPath.value && !installing.value
)

let offProgress: (() => void) | null = null

async function refresh() {
  error.value = ''
  try {
    gpus.value = (await api.detectGpu()) as GpuInfo[]
  } catch { /* ignore */ }
  try {
    pythons.value = (await api.listPythons()) as PythonInfo[]
    if (!pythonPath.value && pythons.value.length) pythonPath.value = pythons.value[0].path
  } catch { /* ignore */ }
  try {
    versions.value = (await api.comfyVersions()) as string[]
    if (!version.value && versions.value.length) version.value = versions.value[0]
  } catch { /* ignore */ }
}

async function pickDir() {
  const d = await api.pickDir()
  if (d) installPath.value = d
}

async function install() {
  installing.value = true
  done.value = false
  error.value = ''
  tail.value = []
  progress.value = { stage: t('install.stagePreparing'), message: '', percent: 0 }
  try {
    await api.saveSettings({ installPath: installPath.value })
    await api.install({ pythonPath: pythonPath.value, version: version.value, torchIndex: torchIndex.value })
    done.value = true
    await refreshInfo()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    installing.value = false
  }
}

onMounted(async () => {
  const s = (await api.getSettings()) as { installPath?: string; pythonPath?: string; comfyVersion?: string }
  if (s.installPath) installPath.value = s.installPath
  else {
    // 未手动选过路径：预填默认目录
    const info = (await api.appInfo()) as { defaultInstallPath: string }
    installPath.value = info.defaultInstallPath
  }
  void loadTorchIndexes()
  offProgress = api.onInstallProgress((e: ProgressEvent) => {
    progress.value = e
    if (e.message) {
      tail.value.push(e.message)
      if (tail.value.length > 200) tail.value.shift()
      requestAnimationFrame(() => {
        if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
      })
    }
  })
  await refresh()
})

onUnmounted(() => {
  offProgress?.()
})
</script>

<template>
  <div>
    <div class="page-hero">
      <div class="page-hero-body">
        <div class="page-title">{{ t('install.pageTitle') }}</div>
        <div class="page-desc">{{ t('install.desc') }}</div>
      </div>
      <img class="page-hero-art" :src="installBanner" alt="" />
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>{{ t('install.basicConfig') }}</h3>
        <div class="field">
          <label>{{ t('install.pythonLabel') }}</label>
          <select v-model="pythonPath">
            <option value="" disabled>{{ t('install.noPython') }}</option>
            <option v-for="p in pythons" :key="p.path" :value="p.path">
              Python {{ p.version }} — {{ p.path }}
            </option>
          </select>
          <div class="hint">{{ t('install.pythonHint') }}</div>
        </div>
        <div class="field">
          <label>{{ t('install.versionLabel') }}</label>
          <select v-model="version">
            <option value="" disabled>{{ t('install.versionFail') }}</option>
            <option v-for="v in versions" :key="v" :value="v">{{ v }}</option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('install.pathLabel') }}</label>
          <div class="row">
            <input v-model="installPath" type="text" :placeholder="t('install.pathPlaceholder')" style="flex: 1" />
            <button class="btn" @click="pickDir">{{ t('common.browse') }}</button>
          </div>
          <div class="hint">{{ t('install.pathHint') }}</div>
        </div>
        <div class="field">
          <label>{{ t('install.torchVersion') }}</label>
          <select v-model="torchIndex">
            <option value="auto">{{ t('install.torchAuto') }}</option>
            <option v-for="t2 in store.torchIndexes" :key="t2" :value="t2">{{ torchLabel(t2) }}</option>
          </select>
        </div>
        <div class="row">
          <button class="btn primary" :disabled="!canInstall" @click="install">
            {{ installing ? t('install.installing') : t('install.start') }}
          </button>
          <button class="btn" :disabled="installing" @click="refresh">{{ t('install.redetect') }}</button>
        </div>
      </div>

      <div class="card">
        <h3>{{ t('install.hardware') }}</h3>
        <div v-if="gpus.length" class="grid" style="gap: 8px">
          <div v-for="g in gpus" :key="g.name" class="diag-item">
            <div class="diag-badge" :class="g.vendor === 'nvidia' ? 'pass' : 'warn'">◆</div>
            <div>
              <div style="font-weight: 600">{{ g.name }}</div>
              <div class="muted">{{ t('install.driverVersion', { v: g.driver || t('common.unknown') }) }}</div>
            </div>
          </div>
        </div>
        <div v-else class="empty">{{ t('install.noGpu') }}</div>

        <div v-if="progress" style="margin-top: 16px">
          <div class="row" style="margin-bottom: 8px">
            <span style="font-weight: 600">{{ progress.stage }}</span>
            <span class="muted">{{ Math.round(progress.percent) }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progress.percent + '%' }"></div>
          </div>
          <div ref="logEl" class="log-view mono" style="height: 180px; margin-top: 12px">
            <div v-for="(l, i) in tail" :key="i">{{ l }}</div>
          </div>
        </div>
        <div v-if="error" class="card" style="border-color: var(--red); color: var(--red); margin-top: 12px; margin-bottom: 0">
          {{ error }}
        </div>
        <div v-if="done" class="card" style="border-color: var(--green); color: var(--green); margin-top: 12px; margin-bottom: 0">
          {{ t('install.done') }}
        </div>
      </div>
    </div>
  </div>
</template>
