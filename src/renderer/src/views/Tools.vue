<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { store, loadTorchIndexes, torchLabel } from '../store'
import { t } from '../i18n'
import type { DiagItem, ProgressEvent, PythonInfo } from '../../../shared/api'
import uninstallBanner from '../assets/brand/uninstall-banner.png'

const items = ref<DiagItem[]>([])
const scanning = ref(false)
const repairing = ref(false)
const progress = ref<ProgressEvent | null>(null)
const toast = ref('')
const error = ref('')

// 重建环境所需
const pythons = ref<PythonInfo[]>([])
const pythonPath = ref('')
const torchIndex = ref('')

let offProgress: (() => void) | null = null

async function scan() {
  scanning.value = true
  error.value = ''
  try {
    items.value = (await api.runDiagnostics()) as DiagItem[]
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    scanning.value = false
  }
}

async function repair(mode: string) {
  repairing.value = true
  error.value = ''
  progress.value = null
  try {
    await api.repair(mode, pythonPath.value, torchIndex.value)
    toast.value = t('tools.repairDone')
    setTimeout(() => (toast.value = ''), 3000)
    await scan()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    repairing.value = false
  }
}

onMounted(async () => {
  pythons.value = (await api.listPythons()) as PythonInfo[]
  if (pythons.value.length) pythonPath.value = pythons.value[0].path
  await loadTorchIndexes()
  if (!torchIndex.value) torchIndex.value = store.torchIndexes.find(t => t.startsWith('cu')) || 'cpu'
  offProgress = api.onInstallProgress(e => (progress.value = e.percent >= 100 ? null : e))
  await scan()
})

onUnmounted(() => offProgress?.())
</script>

<template>
  <div>
    <div class="page-hero">
      <div class="page-hero-body">
        <div class="page-title">{{ t('tools.title') }}</div>
        <div class="page-desc">{{ t('tools.desc') }}</div>
      </div>
      <img class="page-hero-art" :src="uninstallBanner" alt="" />
    </div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>
    <div v-if="toast" class="card" style="border-color: var(--green); color: var(--green)">{{ toast }}</div>

    <div class="card">
      <div class="row" style="margin-bottom: 12px">
        <h3 style="margin: 0">{{ t('tools.diagTitle') }}</h3>
        <div class="spacer"></div>
        <button class="btn" :disabled="scanning" @click="scan">{{ scanning ? t('tools.scanning') : t('tools.rescan') }}</button>
      </div>
      <div v-if="items.length">
        <div v-for="it in items" :key="it.id" class="diag-item">
          <div class="diag-badge" :class="it.status">{{ it.status === 'pass' ? '✓' : it.status === 'fail' ? '✕' : '!' }}</div>
          <div>
            <div style="font-weight: 600">{{ it.name }}</div>
            <div class="muted mono" style="word-break: break-all">{{ it.message }}</div>
          </div>
        </div>
      </div>
      <div v-else class="empty">{{ t('tools.empty') }}</div>
    </div>

    <div class="card">
      <h3>{{ t('tools.repairTitle') }}</h3>
      <div class="row wrap" style="margin-bottom: 10px">
        <select v-model="pythonPath" style="width: 280px">
          <option v-for="p in pythons" :key="p.path" :value="p.path">Python {{ p.version }} — {{ p.path }}</option>
        </select>
        <select v-model="torchIndex" style="width: 140px">
          <option v-for="t in store.torchIndexes" :key="t" :value="t">{{ torchLabel(t) }}</option>
        </select>
      </div>
      <div class="row wrap">
        <button class="btn" :disabled="repairing" @click="repair('pip')">{{ t('tools.repairPip') }}</button>
        <button class="btn" :disabled="repairing" @click="repair('torch')">{{ t('tools.reinstallTorch') }}</button>
        <button class="btn" :disabled="repairing" @click="repair('deps')">{{ t('tools.reinstallDeps') }}</button>
        <button class="btn danger" :disabled="repairing" @click="repair('rebuild')">{{ t('tools.rebuildAll') }}</button>
        <span v-if="repairing" class="muted">{{ t('tools.repairing') }}</span>
      </div>
      <div v-if="progress" style="margin-top: 12px">
        <div class="row" style="margin-bottom: 6px">
          <span style="font-weight: 600">{{ progress.stage }}</span>
          <span class="muted">{{ Math.round(progress.percent) }}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" :style="{ width: progress.percent + '%' }"></div></div>
        <div class="muted mono" style="margin-top: 6px">{{ progress.message }}</div>
      </div>
    </div>
  </div>
</template>
