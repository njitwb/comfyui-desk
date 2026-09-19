<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import type { NodeItem } from '../../../shared/api'

const nodes = ref<NodeItem[]>([])
const installUrl = ref('')
const busy = ref(false)
const updatingAll = ref(false)
const logs = ref<string[]>([])
const error = ref('')
const filter = ref('')
const logEl = ref<HTMLElement | null>(null)

let offEvent: (() => void) | null = null

const filtered = computed(() =>
  nodes.value.filter(n => !filter.value || n.name.toLowerCase().includes(filter.value.toLowerCase()))
)

async function refresh() {
  try {
    nodes.value = (await api.listNodes()) as NodeItem[]
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

async function install() {
  if (!installUrl.value || busy.value) return
  busy.value = true
  error.value = ''
  logs.value = []
  try {
    const name = (await api.installNode(installUrl.value)) as string
    installUrl.value = ''
    await refresh()
    logs.value.push(t('nodes.done', { name }))
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    busy.value = false
  }
}

async function update(n: NodeItem) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await api.updateNode(n.name)
    logs.value.push(t('nodes.updated', { name: n.name }))
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    busy.value = false
  }
}

async function updateAll() {
  if (updatingAll.value) return
  updatingAll.value = true
  error.value = ''
  try {
    const r = (await api.updateAllNodes()) as { ok: string[]; failed: string[] }
    logs.value.push(t('nodes.updateAllDone', { ok: r.ok.length, failed: r.failed.length }))
    await refresh()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    updatingAll.value = false
  }
}

async function remove(n: NodeItem) {
  if (!confirm(t('nodes.confirmRemove', { name: n.name, path: n.path }))) return
  try {
    await api.removeNode(n.name)
    await refresh()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

function openDir(n: NodeItem) {
  void api.openPath(n.path)
}

onMounted(async () => {
  offEvent = api.onNodeEvent((m: string) => {
    logs.value.push(m)
    if (logs.value.length > 200) logs.value.shift()
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
  await refresh()
})

onUnmounted(() => offEvent?.())
</script>

<template>
  <div>
    <div class="page-title">{{ t('nodes.title') }}</div>
    <div class="page-desc">{{ t('nodes.desc') }}</div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>

    <div class="card">
      <h3>{{ t('nodes.install.title') }}</h3>
      <div class="row wrap">
        <input v-model="installUrl" type="text" :placeholder="t('nodes.install.placeholder')" style="flex: 1; min-width: 320px" @keydown.enter="install" />
        <button class="btn primary" :disabled="!installUrl || busy" @click="install">{{ busy ? t('nodes.installing') : t('nodes.install') }}</button>
        <button class="btn" :disabled="updatingAll || busy" @click="updateAll">{{ updatingAll ? t('nodes.updatingAll') : t('nodes.updateAll') }}</button>
      </div>
      <div class="hint muted" style="margin-top: 6px">{{ t('nodes.install.proxyHint') }}</div>
    </div>

    <div class="card" v-if="logs.length">
      <h3>{{ t('nodes.logs.title') }}</h3>
      <div ref="logEl" class="log-view" style="height: 140px">
        <div v-for="(l, i) in logs" :key="i">{{ l }}</div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom: 12px">
        <h3 style="margin: 0">{{ t('nodes.installedCount', { n: nodes.length }) }}</h3>
        <input v-model="filter" type="text" :placeholder="t('nodes.filterPlaceholder')" style="width: 180px" />
        <div class="spacer"></div>
        <button class="btn small" @click="refresh">{{ t('nodes.refresh') }}</button>
      </div>
      <table class="list" v-if="filtered.length">
        <thead>
          <tr><th>{{ t('nodes.col.name') }}</th><th>{{ t('nodes.col.source') }}</th><th style="width: 60px">git</th><th style="width: 1%; white-space: nowrap"></th></tr>
        </thead>
        <tbody>
          <tr v-for="n in filtered" :key="n.name">
            <td class="mono">{{ n.name }}</td>
            <td class="mono muted" style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ n.remote || t('nodes.local') }}</td>
            <td><span :style="{ color: n.git ? 'var(--green)' : 'var(--text-dim)' }">{{ n.git ? '✓' : '—' }}</span></td>
            <td style="white-space: nowrap">
              <button class="btn small" :disabled="busy || !n.git" @click="update(n)">{{ t('nodes.update') }}</button>
              <button class="btn small" @click="openDir(n)">{{ t('nodes.openDir') }}</button>
              <button class="btn small danger" @click="remove(n)">{{ t('nodes.remove') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">{{ t('nodes.empty') }}</div>
    </div>
  </div>
</template>
