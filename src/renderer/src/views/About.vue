<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { store } from '../store'
import { t } from '../i18n'
import type { AppInfo } from '../../../shared/api'
import appIcon from '../assets/brand/app-icon.png'

const info = ref<AppInfo | null>(null)

onMounted(async () => {
  info.value = (await api.appInfo()) as AppInfo
})
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
