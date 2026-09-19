<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { store, refreshInfo, refreshSettings, loadTorchVariants, torchLabel } from '../store'
import { api } from '../api'
import { t } from '../i18n'
import type { ComfyInfo, ComfyStatus, ComfyUpdateInfo } from '../../../shared/api'
import type { MessageKey } from '../../../shared/i18n'
import appIcon from '../assets/brand/app-icon.png'

const emit = defineEmits<{ nav: [k: string] }>()
const acting = ref(false)
const error = ref('')
const updating = ref(false)
const checking = ref(false)
const toast = ref('')
const torchSel = ref('')
const updateInfo = ref<ComfyUpdateInfo | null>(null)

const info = computed<ComfyInfo | null>(() => store.info)
const statusText: Record<ComfyStatus, MessageKey> = {
  stopped: 'dash.status.stopped',
  starting: 'dash.status.starting',
  running: 'dash.status.running',
  error: 'dash.status.error'
}
const canStart = computed(() => !!info.value?.installed && store.status === 'stopped')
const running = computed(() => store.status === 'running')

async function act(fn: () => Promise<unknown>) {
  acting.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    acting.value = false
  }
}

function openGui() {
  // 主界面已内嵌到工作台页
  emit('nav', 'workbench')
}

/** 选择已有的 ComfyUI 安装目录（可选根目录或 ComfyUI 目录本身） */
async function pickExisting() {
  error.value = ''
  const dir = await api.pickDir()
  if (!dir) return
  try {
    const r = await api.useExistingInstall(dir)
    toast.value = r.venvExists
      ? t('dash.pickedOk')
      : t('dash.pickedNoEnv')
    setTimeout(() => (toast.value = ''), 5000)
    await refreshSettings()
    await refreshInfo()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

async function checkUpdate() {
  if (checking.value) return
  checking.value = true
  error.value = ''
  try {
    updateInfo.value = (await api.checkComfyUpdate()) as ComfyUpdateInfo
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    checking.value = false
  }
}

async function update() {
  if (!updateInfo.value?.hasUpdate || updating.value) return
  updating.value = true
  error.value = ''
  try {
    await api.updateComfy(updateInfo.value.latest)
    toast.value = t('dash.updateDone')
    updateInfo.value = { ...updateInfo.value, hasUpdate: false }
    await refreshInfo()
    setTimeout(() => (toast.value = ''), 3000)
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    updating.value = false
  }
}

async function switchTorch() {
  if (!torchSel.value || updating.value) return
  updating.value = true
  error.value = ''
  try {
    await api.switchTorch(torchSel.value)
    toast.value = t('dash.switchDone')
    await refreshInfo()
    setTimeout(() => (toast.value = ''), 4000)
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    updating.value = false
  }
}

onMounted(async () => {
  await refreshInfo()
  await refreshSettings()
  void loadTorchVariants()
})
</script>

<template>
  <div>
    <div class="page-title">{{ t('dash.title') }}</div>
    <div class="page-desc">{{ t('dash.desc') }}</div>

    <div v-if="info && !info.installed" class="card" style="text-align: center; padding: 40px">
      <img class="welcome-mark" :src="appIcon" alt="" />
      <div style="font-size: 16px; margin-bottom: 8px">{{ t('dash.notInstalled') }}</div>
      <div class="muted" style="margin-bottom: 18px">{{ t('dash.notInstalledHint') }}</div>
      <div class="row" style="justify-content: center">
        <button class="btn primary" @click="emit('nav', 'install')">{{ t('dash.installNow') }}</button>
        <button class="btn" @click="pickExisting">{{ t('dash.pickExisting') }}</button>
      </div>
    </div>

    <template v-else>
      <div class="hero">
        <span class="pill" :class="store.status">
          <span class="dot"></span>{{ t(statusText[store.status]) }}
        </span>
        <div class="spacer"></div>
        <button v-if="running" class="btn success big" @click="openGui">{{ t('dash.openGui') }}</button>
        <button class="btn primary big" :disabled="!canStart || acting" @click="act(() => api.start())">{{ t('dash.start') }}</button>
        <button class="btn big" :disabled="store.status === 'stopped' || acting" @click="act(() => api.restart())">{{ t('dash.restart') }}</button>
        <button class="btn danger big" :disabled="store.status === 'stopped' || acting" @click="act(() => api.stop())">{{ t('dash.stop') }}</button>
      </div>

      <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>
      <div v-if="toast" class="card" style="border-color: var(--green); color: var(--green)">{{ toast }}</div>

      <div class="grid grid-4" style="margin-bottom: 16px">
        <div class="info-tile">
          <div class="k">{{ t('dash.version') }}</div>
          <div class="v">{{ info?.version || '—' }}</div>
        </div>
        <div class="info-tile">
          <div class="k">{{ t('dash.gpu') }}</div>
          <div class="v">{{ info?.gpus.map(g => g.name).join(' / ') || t('dash.gpuNone') }}</div>
        </div>
        <div class="info-tile">
          <div class="k">{{ t('dash.driver') }}</div>
          <div class="v">{{ info?.gpus.map(g => g.driver).filter(Boolean).join(' / ') || '—' }}</div>
        </div>
        <div class="info-tile">
          <div class="k">PyTorch / CUDA</div>
          <div class="v">
            {{ info?.torchVersion || '—' }}
            <span v-if="info?.cudaAvailable === true" style="color: var(--green)">CUDA ✓</span>
            <span v-else-if="info?.cudaAvailable === false" style="color: var(--yellow)">CPU</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>{{ t('dash.installPath') }}</h3>
        <div class="row">
          <span class="mono" style="word-break: break-all">{{ info?.installPath }}</span>
          <button class="btn small" @click="info && api.openPath(info.installPath)">{{ t('dash.openDir') }}</button>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>{{ t('dash.updateTitle') }}</h3>
          <div class="row">
            <button class="btn" :disabled="checking || updating" @click="checkUpdate">
              {{ checking ? t('dash.checking') : t('dash.checkUpdate') }}
            </button>
            <div class="spacer"></div>
            <button class="btn primary" :disabled="!updateInfo?.hasUpdate || updating" @click="update">
              {{ updating ? t('dash.updating') : updateInfo?.hasUpdate ? t('dash.updateTo', { version: updateInfo.latest }) : t('dash.update') }}
            </button>
          </div>
          <div class="hint muted" style="margin-top: 6px">
            <template v-if="updateInfo">
              <span v-if="updateInfo.hasUpdate" style="color: var(--yellow)">{{ t('dash.hasUpdate', { latest: updateInfo.latest, current: updateInfo.current || '—' }) }}</span>
              <span v-else style="color: var(--green)">{{ t('dash.isLatest', { current: updateInfo.current || '—' }) }}</span>
            </template>
            <template v-else>{{ t('dash.checkHint') }}</template>
          </div>
        </div>
        <div class="card">
          <h3>{{ t('dash.switchTitle') }}</h3>
          <div class="row">
            <select v-model="torchSel" style="flex: 1">
              <option value="" disabled>{{ t('dash.selectVersion') }}</option>
              <option v-for="v in store.torchVariants" :key="v.index" :value="v.index">
                {{ v.torch || torchLabel(v.index) }}
              </option>
            </select>
            <button class="btn" :disabled="!torchSel || updating" @click="switchTorch">{{ t('dash.switch') }}</button>
          </div>
          <div class="hint muted" style="margin-top: 6px">{{ t('dash.switchHint') }}</div>
        </div>
      </div>
    </template>
  </div>
</template>
