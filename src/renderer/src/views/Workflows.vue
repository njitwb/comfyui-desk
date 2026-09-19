<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '../api'
import { store } from '../store'
import { t, fmtDate } from '../i18n'
import type { WorkflowItem } from '../../../shared/api'
import type { MessageKey } from '../../../shared/i18n'

const items = ref<WorkflowItem[]>([])
const dir = ref('')
const loading = ref(false)
const error = ref('')
const toast = ref('')
const keyword = ref('')
const busyPath = ref('')

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return items.value
  return items.value.filter(w => w.name.toLowerCase().includes(k) || w.relPath.toLowerCase().includes(k))
})

const formatText: Record<WorkflowItem['format'], MessageKey> = { api: 'wf.format.api', ui: 'wf.format.ui', unknown: 'wf.format.unknown' }

function human(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return (n / 1e3).toFixed(0) + ' KB'
}

function showToast(msg: string): void {
  toast.value = msg
  setTimeout(() => (toast.value = ''), 3000)
}

async function scan() {
  loading.value = true
  error.value = ''
  try {
    items.value = (await api.scanWorkflows()) as WorkflowItem[]
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
}

async function importFile() {
  error.value = ''
  try {
    const w = (await api.importWorkflow()) as WorkflowItem | null
    if (w) {
      showToast(t('wf.toast.imported', { name: w.name }))
      await scan()
    }
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

async function run(w: WorkflowItem) {
  if (busyPath.value) return
  busyPath.value = w.path
  error.value = ''
  try {
    const r = await api.queueWorkflow(w.path)
    showToast(t('wf.toast.queued', { number: r.number }))
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    busyPath.value = ''
  }
}

async function reveal(w: WorkflowItem) {
  await api.revealFile(w.path)
}

async function del(w: WorkflowItem) {
  if (!confirm(t('wf.confirmDelete', { path: w.relPath }))) return
  try {
    await api.deleteWorkflow(w.path)
    showToast(t('wf.toast.deleted', { name: w.name }))
    await scan()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

onMounted(async () => {
  dir.value = await api.workflowDir()
  await scan()
})
</script>

<template>
  <div>
    <div class="page-title">{{ t('wf.pageTitle') }}</div>
    <div class="page-desc">{{ t('wf.desc') }}</div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>
    <div v-if="toast" class="card" style="border-color: var(--green); color: var(--green)">{{ toast }}</div>

    <div class="card">
      <h3>{{ t('wf.dir.title') }}</h3>
      <div class="row">
        <span class="mono muted" style="word-break: break-all">{{ dir }}</span>
        <div class="spacer"></div>
        <button class="btn small" @click="api.openPath(dir)">{{ t('wf.openDir') }}</button>
      </div>
      <div class="hint muted" style="margin-top: 6px">
        {{ t('wf.dir.hint') }}
      </div>
    </div>

    <div class="card">
      <div class="row wrap" style="margin-bottom: 12px">
        <h3 style="margin: 0">{{ t('wf.libraryCount', { n: items.length }) }}</h3>
        <div class="spacer"></div>
        <input v-model="keyword" type="text" :placeholder="t('wf.searchPlaceholder')" style="width: 200px" />
        <button class="btn small" :disabled="loading" @click="scan">{{ loading ? t('wf.scanning') : t('wf.refresh') }}</button>
        <button class="btn primary small" @click="importFile">{{ t('wf.importJson') }}</button>
      </div>
      <table class="list" v-if="filtered.length">
        <thead>
          <tr>
            <th>{{ t('wf.col.name') }}</th>
            <th style="width: 100px">{{ t('wf.col.format') }}</th>
            <th style="width: 70px">{{ t('wf.col.nodeCount') }}</th>
            <th style="width: 80px">{{ t('wf.col.size') }}</th>
            <th style="width: 100px">{{ t('wf.col.date') }}</th>
            <th>{{ t('wf.col.relPath') }}</th>
            <th style="width: 170px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in filtered" :key="w.path">
            <td class="mono">{{ w.name }}</td>
            <td>
              <span
                class="pill"
                :style="`
                  white-space: nowrap;
                  ${
                    w.format === 'api'
                      ? 'background: var(--tint-green-soft); color: var(--green)'
                      : w.format === 'ui'
                        ? 'background: var(--tint-yellow-soft); color: var(--yellow)'
                        : 'background: var(--tint-neutral); color: var(--text-dim)'
                  }`
                "
              >
                {{ t(formatText[w.format]) }}
              </span>
            </td>
            <td>{{ w.nodeCount || '—' }}</td>
            <td>{{ human(w.size) }}</td>
            <td class="muted">{{ fmtDate(w.mtime) }}</td>
            <td class="mono muted" style="word-break: break-all">{{ w.relPath }}</td>
            <td>
              <button
                class="btn small primary"
                :disabled="w.format !== 'api' || store.status !== 'running' || busyPath === w.path"
                :title="w.format !== 'api' ? t('wf.run.tip.apiOnly') : store.status !== 'running' ? t('wf.run.tip.notRunning') : ''"
                @click="run(w)"
              >
                {{ busyPath === w.path ? t('wf.submitting') : t('wf.run') }}
              </button>
              <button class="btn small" @click="reveal(w)">{{ t('wf.reveal') }}</button>
              <button class="btn small danger" @click="del(w)">{{ t('wf.remove') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="keyword" class="empty">{{ t('wf.emptyMatch', { keyword }) }}</div>
      <div v-else class="empty">{{ t('wf.empty') }}</div>
    </div>
  </div>
</template>
