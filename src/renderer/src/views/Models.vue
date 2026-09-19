<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { refreshSettings } from '../store'
import { t, fmtDate } from '../i18n'
import type { MessageKey } from '../../../shared/i18n'
import type { DownloadTask, ModelCategory, ModelItem } from '../../../shared/api'

const cats = ref<ModelCategory[]>([])
const activeCat = ref('')
const loading = ref(false)
const error = ref('')
const toast = ref('')
const categories = ref<string[]>([])

// 新建下载
const dlUrl = ref('')
const dlCat = ref('checkpoints')
const dlName = ref('')
/** HF 镜像：与「设置」页的 settings.hfMirror 是同一个开关 */
const dlMirror = ref(true)

// 下载管理（主进程统一管理，支持暂停/继续/取消）
const tasks = ref<DownloadTask[]>([])

const STATUS_TEXT: Record<string, MessageKey> = { downloading: 'models.status.downloading', paused: 'models.status.paused', completed: 'models.status.completed', error: 'models.status.error' }

const active = computed(() => cats.value.find(c => c.name === activeCat.value))

function human(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return (n / 1e3).toFixed(0) + ' KB'
}

function pct(task: DownloadTask): number {
  return task.total ? Math.min(100, (task.received / task.total) * 100) : 0
}

function statusText(task: DownloadTask): string {
  if (task.status === 'downloading') return task.total ? t('models.dl.pct', { p: Math.floor(pct(task)) }) : t('models.status.downloading')
  const key = STATUS_TEXT[task.status]
  return key ? t(key) : task.status
}

async function scan() {
  loading.value = true
  error.value = ''
  try {
    cats.value = (await api.scanModels()) as ModelCategory[]
    if (!activeCat.value && cats.value.length) activeCat.value = cats.value[0].name
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
}

async function del(f: ModelItem) {
  if (!confirm(t('models.confirmDelete', { path: f.relPath }))) return
  try {
    await api.deleteModel(f.relPath)
    toast.value = t('models.toast.deleted', { name: f.name })
    setTimeout(() => (toast.value = ''), 2500)
    await scan()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

async function reveal(f: ModelItem) {
  await api.revealFile(f.relPath)
}

/** 添加下载：交给主进程后立即返回，进度经 onDownloads 推送 */
async function addDownload() {
  if (!dlUrl.value) return
  error.value = ''
  try {
    await api.startDownload({ url: dlUrl.value, category: dlCat.value, filename: dlName.value, useHfMirror: dlMirror.value })
    dlUrl.value = ''
    dlName.value = ''
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

function pause(task: DownloadTask) {
  void api.pauseDownload(task.id)
}
function resume(task: DownloadTask) {
  void api.resumeDownload(task.id)
}
function remove(task: DownloadTask) {
  void api.cancelDownload(task.id)
}

/** 勾选即写回设置（与设置页同源） */
function persistMirror(): void {
  void api.saveSettings({ hfMirror: dlMirror.value }).then(() => refreshSettings())
}

let offDl: (() => void) | null = null

onMounted(async () => {
  categories.value = (await api.modelCategories()) as string[]
  tasks.value = (await api.listDownloads()) as DownloadTask[]
  const st = (await api.getSettings()) as { hfMirror?: boolean }
  dlMirror.value = st.hfMirror !== false
  offDl = api.onDownloads((list) => {
    const prev = new Map(tasks.value.map(task => [task.id, task.status]))
    tasks.value = list
    for (const task of list) {
      // 下载完成：刷新模型库并切到对应类别
      if (task.status === 'completed' && prev.get(task.id) !== 'completed') {
        toast.value = t('models.toast.done', { name: task.filename })
        setTimeout(() => (toast.value = ''), 4000)
        void scan().then(() => {
          if (cats.value.some(c => c.name === task.category)) activeCat.value = task.category
        })
      }
    }
  })
  await scan()
})

onUnmounted(() => offDl?.())
</script>

<template>
  <div>
    <div class="page-title">{{ t('models.title') }}</div>
    <div class="page-desc">{{ t('models.desc') }}</div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>
    <div v-if="toast" class="card" style="border-color: var(--green); color: var(--green)">{{ toast }}</div>

    <div class="card">
      <h3>{{ t('models.dl.title') }}</h3>
      <div class="row wrap" style="margin-bottom: 8px">
        <input v-model="dlUrl" type="text" :placeholder="t('models.dl.urlPlaceholder')" style="flex: 2; min-width: 280px" />
        <select v-model="dlCat" style="width: 150px">
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
        <input v-model="dlName" type="text" :placeholder="t('models.dl.namePlaceholder')" style="width: 180px" />
        <label class="muted row" style="gap: 4px; cursor: pointer">
          <input v-model="dlMirror" type="checkbox" @change="persistMirror" /> {{ t('models.dl.hfMirror') }}
        </label>
        <button class="btn primary" :disabled="!dlUrl" @click="addDownload">{{ t('models.dl.add') }}</button>
      </div>
      <div class="hint muted" style="margin-bottom: 10px">{{ t('models.dl.hint') }}</div>

      <div v-if="tasks.length" class="dl-list">
        <h3 style="margin: 0 0 8px">{{ t('models.dlList.title') }}</h3>
        <div v-for="task in tasks" :key="task.id" class="dl-row">
          <div class="row" style="gap: 8px">
            <span class="mono" style="word-break: break-all; font-weight: 600">{{ task.filename }}</span>
            <span class="chip small">{{ task.category }}</span>
            <div class="spacer"></div>
            <span class="muted">{{ human(task.received) }} / {{ task.total ? human(task.total) : '?' }}<template v-if="task.speed > 0"> · {{ human(task.speed) }}/s</template></span>
          </div>
          <div class="progress-track" style="margin: 6px 0">
            <div class="progress-fill" :class="{ done: task.status === 'completed', err: task.status === 'error' }" :style="{ width: pct(task) + '%' }"></div>
          </div>
          <div class="row" style="gap: 8px; align-items: center">
            <span class="dl-status" :class="task.status">{{ statusText(task) }}</span>
            <span v-if="task.error" class="dl-err">{{ task.error }}</span>
            <div class="spacer"></div>
            <button v-if="task.status === 'downloading'" class="btn small" @click="pause(task)">{{ t('models.pause') }}</button>
            <button v-if="task.status === 'paused' || task.status === 'error'" class="btn small" @click="resume(task)">{{ task.status === 'error' ? t('common.retry') : t('models.resume') }}</button>
            <button class="btn small danger" @click="remove(task)">{{ task.status === 'completed' || task.status === 'error' ? t('common.remove') : t('common.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom: 12px">
        <h3 style="margin: 0">{{ t('models.library') }}</h3>
        <div class="spacer"></div>
        <button class="btn small" :disabled="loading" @click="scan">{{ loading ? t('models.scanning') : t('common.refresh') }}</button>
      </div>
      <div v-if="cats.length" class="chips">
        <span
          v-for="c in cats"
          :key="c.name"
          class="chip"
          :class="{ active: activeCat === c.name }"
          @click="activeCat = c.name"
        >
          {{ c.name }}<span class="count">{{ c.count }}</span>
        </span>
      </div>
      <div v-if="active">
        <table class="list" v-if="active.files.length">
          <thead>
            <tr><th>{{ t('models.col.file') }}</th><th style="width: 90px">{{ t('common.size') }}</th><th style="width: 100px">{{ t('models.col.date') }}</th><th style="width: 200px">{{ t('models.col.relPath') }}</th><th style="width: 130px"></th></tr>
          </thead>
          <tbody>
            <tr v-for="f in active.files" :key="f.relPath">
              <td class="mono">{{ f.name }}</td>
              <td>{{ human(f.size) }}</td>
              <td class="muted">{{ fmtDate(f.mtime) }}</td>
              <td class="mono muted" style="word-break: break-all">{{ f.relPath }}</td>
              <td>
                <button class="btn small" @click="reveal(f)">{{ t('common.reveal') }}</button>
                <button class="btn small danger" @click="del(f)">{{ t('common.delete') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">{{ t('models.empty.cat') }}</div>
      </div>
      <div v-else class="empty">{{ t('models.empty.dir') }}</div>
    </div>
  </div>
</template>

<style scoped>
.dl-list {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.dl-row {
  padding: 8px 0;
  border-bottom: 1px dashed var(--border);
}
.dl-row:last-child {
  border-bottom: none;
}
.dl-status {
  font-size: 12px;
}
.dl-status.downloading {
  color: var(--accent-2);
}
.dl-status.paused {
  color: var(--text-dim);
}
.dl-status.completed {
  color: var(--green);
}
.dl-status.error {
  color: var(--red);
}
.dl-err {
  color: var(--red);
  font-size: 12px;
  word-break: break-all;
}
.progress-fill.done {
  background: var(--green);
}
.progress-fill.err {
  background: var(--red);
}
.chip.small {
  padding: 0 6px;
  font-size: 11px;
}
</style>
