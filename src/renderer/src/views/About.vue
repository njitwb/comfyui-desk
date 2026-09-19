<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { store } from '../store'
import { t, fmtDate } from '../i18n'
import type { AppInfo, AppUpdateInfo, AppUpdateProgress } from '../../../shared/api'
import appIcon from '../assets/brand/app-icon.png'

const info = ref<AppInfo | null>(null)
const update = ref<AppUpdateInfo | null>(null)
const checking = ref(false)
/** 「稍后」收起更新提示，点「重新检查」会再次展开 */
const postponed = ref(false)
const progress = ref<AppUpdateProgress | null>(null)
const installing = ref(false)
const installError = ref('')

async function checkUpdate(): Promise<void> {
  checking.value = true
  postponed.value = false
  try {
    update.value = (await api.checkUpdate()) as AppUpdateInfo
  } finally {
    checking.value = false
  }
}

function openRelease(): void {
  if (update.value?.url) void api.openExternal(update.value.url)
}

/** 下载 + 静默安装；进程随后被安装器接管并重启，所以成功时不复位 installing */
async function runInstall(): Promise<void> {
  installing.value = true
  installError.value = ''
  progress.value = null
  try {
    await api.installUpdate()
  } catch (e) {
    installError.value = (e as Error).message
    installing.value = false
  }
}

let offProgress: (() => void) | null = null

onMounted(async () => {
  offProgress = api.onUpdateProgress(e => {
    progress.value = e
  })
  info.value = (await api.appInfo()) as AppInfo
  void checkUpdate()
})

onUnmounted(() => offProgress?.())
</script>

<template>
  <div>
    <div class="page-title">{{ t('about.title') }}</div>
    <div class="page-desc">{{ t('about.desc') }}</div>

    <div class="card">
      <div class="row" style="align-items: center">
        <div class="logo" style="width: 48px; height: 48px; border-radius: 12%; overflow: hidden; box-shadow: var(--glow-accent); flex-shrink: 0">
          <img :src="appIcon" alt="" style="width: 100%; height: 100%; display: block" />
        </div>
        <div>
          <div style="font-size: 17px; font-weight: 600">{{ t('app.title') }}</div>
          <div class="muted">{{ t('about.version', { version: info?.version || '—' }) }}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>{{ t('about.update.title') }}</h3>
      <div class="row">
        <div style="flex: 1; min-width: 0">
          <div v-if="checking" class="muted">{{ t('about.update.checking') }}</div>
          <template v-else-if="update">
            <div v-if="update.error" class="muted">{{ t('about.update.failed', { message: update.error }) }}</div>
            <div v-else-if="update.hasUpdate" style="color: var(--accent); font-weight: 600">
              {{ t('about.update.available', { version: update.latest }) }}
            </div>
            <div v-else class="muted">
              {{ update.latest ? t('about.update.latest') : t('about.update.none') }}
            </div>
            <div class="muted" style="margin-top: 6px">
              {{
                update.latest
                  ? t('about.update.currentLatest', { current: update.current, latest: update.latest })
                  : t('about.update.currentOnly', { current: update.current })
              }}
              <span v-if="update.publishedAt">
                · {{ t('about.update.publishedAt', { date: fmtDate(new Date(update.publishedAt).getTime()) }) }}
              </span>
            </div>
          </template>
        </div>
        <button class="btn small" :disabled="checking" @click="checkUpdate">{{ t('about.update.checkAgain') }}</button>
      </div>

      <div v-if="update?.hasUpdate && !postponed" style="margin-top: 14px">
        <div class="row wrap">
          <button v-if="update.asset" class="btn primary small" :disabled="installing" @click="runInstall">
            {{ installing ? t('about.update.installing') : t('about.update.install') }}
          </button>
          <button class="btn small" :disabled="installing" @click="openRelease">{{ t('about.update.download') }}</button>
          <button v-if="!installing" class="btn small" @click="postponed = true">{{ t('about.update.later') }}</button>
        </div>
        <div class="muted" style="margin-top: 8px">
          {{ update.asset ? t('about.update.installHint') : t('about.update.manualOnly') }}
        </div>

        <div v-if="installing" style="margin-top: 12px">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: (progress?.percent || 0) + '%' }"></div>
          </div>
          <div class="muted" style="margin-top: 6px">{{ progress?.message || t('about.update.preparing') }}</div>
        </div>
        <div v-if="installError" style="margin-top: 10px; color: var(--red); font-size: 12px">{{ installError }}</div>

        <pre v-if="update.notes" class="update-notes mono">{{ update.notes }}</pre>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>{{ t('about.env.title') }}</h3>
        <table class="list" v-if="info">
          <tbody>
            <tr><td class="muted" style="width: 110px">Electron</td><td class="mono">{{ info.electron }}</td></tr>
            <tr><td class="muted">Chromium</td><td class="mono">{{ info.chrome }}</td></tr>
            <tr><td class="muted">Node.js</td><td class="mono">{{ info.node }}</td></tr>
            <tr><td class="muted">{{ t('about.platform') }}</td><td class="mono">{{ info.platform }}</td></tr>
            <tr><td class="muted">ComfyUI</td><td class="mono">{{ store.info?.version || t('common.notInstalled') }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>{{ t('about.data.title') }}</h3>
        <div class="field">
          <label>{{ t('about.settingsFile') }}</label>
          <div class="row">
            <span class="mono muted" style="word-break: break-all; flex: 1">{{ info?.settingsFile }}</span>
            <button class="btn small" :disabled="!info" @click="info && api.revealFile(info.settingsFile)">{{ t('common.reveal') }}</button>
          </div>
        </div>
        <div class="field">
          <label>{{ t('about.userData') }}</label>
          <div class="row">
            <span class="mono muted" style="word-break: break-all; flex: 1">{{ info?.userData }}</span>
            <button class="btn small" :disabled="!info" @click="info && api.openPath(info.userData)">{{ t('common.open') }}</button>
          </div>
        </div>
        <div class="field" style="margin-bottom: 0">
          <label>{{ t('about.logDir') }}</label>
          <div class="row">
            <span class="mono muted" style="word-break: break-all; flex: 1">{{ info?.logDir }}</span>
            <button class="btn small" :disabled="!info" @click="info && api.openPath(info.logDir)">{{ t('common.open') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>{{ t('about.links.title') }}</h3>
      <div class="row wrap">
        <button class="btn small" @click="api.openExternal('https://github.com/njitwb/comfyui-desk')">{{ t('about.link.project') }}</button>
        <button class="btn small" @click="api.openExternal('https://github.com/comfyanonymous/ComfyUI')">{{ t('about.link.repo') }}</button>
        <button class="btn small" @click="api.openExternal('https://docs.comfy.org')">{{ t('about.link.docs') }}</button>
        <button class="btn small" @click="api.openExternal('https://github.com/Comfy-Org/ComfyUI-Manager')">ComfyUI-Manager</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 更新说明：限高滚动，避免超长 release notes 撑爆页面 */
.update-notes {
  margin: 12px 0 0;
  padding: 12px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-dim);
  background: var(--glass-bg);
  border: 1px solid var(--glass-edge);
  border-radius: 8px;
}
</style>
