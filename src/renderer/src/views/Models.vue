<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../api'
import { refreshSettings } from '../store'
import { t, fmtDate } from '../i18n'
import type { MessageKey } from '../../../shared/i18n'
import type { DownloadTask, ModelDir, ModelDirContent, ModelItem, ModelSource, OnlineModel, OnlineModelFile } from '../../../shared/api'

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

// 在线搜索：HuggingFace（站点随「HF 镜像」开关切换）/ 魔搭 ModelScope（国内直连）
const onlineSource = ref<ModelSource>('hf')
const onlineQuery = ref('')
const onlineSearching = ref(false)
const onlineSearched = ref(false)
const onlineResults = ref<OnlineModel[]>([])
/** 实际生效的检索词（链接/文件名被自动提取或近似降级时与输入不同，用于界面提示） */
const onlineUsedQuery = ref('')
/** 降级搜索的结果是否已按文件名回校验过滤 */
const onlineFileFiltered = ref(false)
/** 展开查看文件的仓库 ID（同一时刻只展开一个） */
const onlineOpenId = ref('')
const onlineFiles = ref<OnlineModelFile[]>([])
const onlineFilesLoading = ref(false)
/** 仓库内文件过滤（大仓库里按文件名快速定位） */
const onlineFileFilter = ref('')
/** 在线下载的类别，空串 = 按文件/链接自动识别 */
const onlineCat = ref('')

// 下载管理（主进程统一管理，支持暂停/继续/取消）
const tasks = ref<DownloadTask[]>([])

const STATUS_TEXT: Record<string, MessageKey> = { downloading: 'models.status.downloading', paused: 'models.status.paused', completed: 'models.status.completed', error: 'models.status.error' }

// 模型库：树 + 面包屑导航（整个模型目录，含内置分类与自定义目录）
const crumb = ref<string[]>([])
const dirContent = ref<ModelDirContent | null>(null)
const newDirOpen = ref(false)
const newDirName = ref('')
const libraryQuery = ref('')
/** 当前目录下的文件（按文件名/相对路径搜索过滤） */
const libraryShownFiles = computed(() => {
  if (!dirContent.value) return []
  const q = libraryQuery.value.trim().toLowerCase()
  const files = dirContent.value.files
  if (!q) return files
  return files.filter(f => f.name.toLowerCase().includes(q) || f.relPath.toLowerCase().includes(q))
})

/** 当前面包屑路径（根为空串） */
function curRel(): string {
  return crumb.value.join('/')
}
async function loadDir(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    dirContent.value = (await api.listModelDir(curRel())) as ModelDirContent
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
}
function enterDir(d: ModelDir): void {
  crumb.value.push(d.name)
  movingPath.value = ''
  void loadDir()
}
function backTo(i: number): void {
  crumb.value = crumb.value.slice(0, i)
  movingPath.value = ''
  void loadDir()
}
function openNewDir(): void {
  newDirName.value = ''
  newDirOpen.value = true
}
async function createDir(): Promise<void> {
  const name = newDirName.value.trim()
  if (!name || name.includes('/') || name.startsWith('.')) {
    error.value = t('models.custom.nameInvalid')
    return
  }
  error.value = ''
  try {
    await api.createModelDir(curRel() ? `${curRel()}/${name}` : name)
    newDirOpen.value = false
    newDirName.value = ''
    // 在根视图新建顶层目录后刷新类别下拉（下载/移动目标）
    if (!crumb.value.length) categories.value = (await api.modelCategories()) as string[]
    await loadDir()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

/** 过滤后的仓库文件（按文件名子串） */
const onlineShownFiles = computed(() => {
  const f = onlineFileFilter.value.trim().toLowerCase()
  return f ? onlineFiles.value.filter(x => x.name.toLowerCase().includes(f)) : onlineFiles.value
})

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

async function del(f: ModelItem) {
  if (!confirm(t('models.confirmDelete', { path: f.relPath }))) return
  try {
    await api.deleteModel(f.relPath)
    toast.value = t('models.toast.deleted', { name: f.name })
    setTimeout(() => (toast.value = ''), 2500)
    await loadDir()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
}

async function reveal(f: ModelItem) {
  await api.revealFile(f.relPath)
}

// 移动模型文件到其他类别目录（行内选择目标类别后确认）
const movingPath = ref('')
const movingCat = ref('')

function startMove(f: ModelItem): void {
  movingPath.value = f.relPath
  movingCat.value = ''
}

async function doMove(f: ModelItem): Promise<void> {
  if (!movingCat.value || movingCat.value === f.category) return
  error.value = ''
  try {
    await api.moveModel(f.relPath, movingCat.value)
    toast.value = t('models.toast.moved', { name: f.name, category: movingCat.value })
    setTimeout(() => (toast.value = ''), 2500)
    movingPath.value = ''
    await loadDir()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
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

/** 有正在下载 / 可继续（暂停或失败）的任务时才启用批量按钮 */
const hasDownloading = computed(() => tasks.value.some(x => x.status === 'downloading'))
const hasResumable = computed(() => tasks.value.some(x => x.status === 'paused' || x.status === 'error'))

function pauseAll(): void {
  void api.pauseAllDownloads()
}
function resumeAll(): void {
  void api.resumeAllDownloads()
}
function stopAll(): void {
  void api.cancelAllDownloads()
}

/** 勾选即写回设置（与设置页同源）；切换搜索源后清空上次结果 */
function persistMirror(): void {
  resetOnline()
  void api.saveSettings({ hfMirror: dlMirror.value }).then(() => refreshSettings())
}

/** 清空在线搜索结果（切换搜索源 / 镜像开关时旧结果已失效） */
function resetOnline(): void {
  onlineResults.value = []
  onlineUsedQuery.value = ''
  onlineFileFiltered.value = false
  onlineSearched.value = false
  onlineOpenId.value = ''
}

function switchSource(s: ModelSource): void {
  if (onlineSource.value === s) return
  onlineSource.value = s
  resetOnline()
}

/** 下载量 / 点赞数简写 */
function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

async function searchOnline(): Promise<void> {
  const q = onlineQuery.value.trim()
  if (!q || onlineSearching.value) return
  onlineSearching.value = true
  error.value = ''
  onlineOpenId.value = ''
  try {
    const r = await api.searchOnlineModels(onlineSource.value, q, dlMirror.value)
    onlineResults.value = r.models
    onlineUsedQuery.value = r.query
    onlineFileFiltered.value = r.fileFiltered === true
    onlineSearched.value = true
  } catch (e) {
    error.value = (e as Error).message || String(e)
    onlineResults.value = []
  } finally {
    onlineSearching.value = false
  }
}

async function toggleFiles(m: OnlineModel): Promise<void> {
  if (onlineOpenId.value === m.id) {
    onlineOpenId.value = ''
    return
  }
  onlineOpenId.value = m.id
  onlineFiles.value = []
  onlineFileFilter.value = ''
  onlineFilesLoading.value = true
  error.value = ''
  try {
    onlineFiles.value = await api.listOnlineModelFiles(m.source, m.id, m.revision, dlMirror.value)
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    onlineFilesLoading.value = false
  }
}

/** 下载仓库内单个文件：类别留空时由主进程按文件名 / 链接推断；重复点击由主进程去重 */
async function downloadOnline(f: OnlineModelFile): Promise<void> {
  error.value = ''
  try {
    await api.startDownload({
      url: f.url,
      category: onlineCat.value || undefined,
      filename: f.name.split('/').pop(),
      useHfMirror: dlMirror.value
    })
    toast.value = t('models.online.toastAdded', { name: f.name })
    setTimeout(() => (toast.value = ''), 3000)
  } catch (e) {
    error.value = (e as Error).message || String(e)
  }
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
      // 下载完成：跳到对应目录并刷新
      if (task.status === 'completed' && prev.get(task.id) !== 'completed') {
        toast.value = t('models.toast.done', { name: task.filename })
        setTimeout(() => (toast.value = ''), 4000)
        const seg = (task.category ? String(task.category).split('/').filter(Boolean) : []).slice(0, 3)
        crumb.value = seg
        movingPath.value = ''
        void loadDir()
      }
    }
  })
  await loadDir()
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
        <div class="row" style="gap: 8px; align-items: center; margin-bottom: 8px">
          <h3 style="margin: 0">{{ t('models.dlList.title') }}</h3>
          <div class="spacer"></div>
          <button class="btn small" :disabled="!hasDownloading" @click="pauseAll">{{ t('models.dl.pauseAll') }}</button>
          <button class="btn small" :disabled="!hasResumable" @click="resumeAll">{{ t('models.dl.resumeAll') }}</button>
          <button class="btn small danger" @click="stopAll">{{ t('models.dl.stopAll') }}</button>
        </div>
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
      <h3>{{ t('models.online.title') }}</h3>
      <div class="chips" style="margin-bottom: 8px">
        <span class="chip" :class="{ active: onlineSource === 'hf' }" @click="switchSource('hf')">
          {{ t('models.online.src.hf') }}
        </span>
        <span class="chip" :class="{ active: onlineSource === 'ms' }" @click="switchSource('ms')">
          {{ t('models.online.src.ms') }}
        </span>
      </div>
      <div class="row wrap" style="margin-bottom: 8px">
        <input
          v-model="onlineQuery"
          type="text"
          :placeholder="t('models.online.placeholder')"
          style="flex: 2; min-width: 260px"
          @keyup.enter="searchOnline"
        />
        <select v-model="onlineCat" style="width: 170px">
          <option value="">{{ t('models.online.autoCat') }}</option>
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
        <label v-if="onlineSource === 'hf'" class="muted row" style="gap: 4px; cursor: pointer">
          <input v-model="dlMirror" type="checkbox" @change="persistMirror" /> {{ t('models.dl.hfMirror') }}
        </label>
        <button class="btn primary" :disabled="!onlineQuery.trim() || onlineSearching" @click="searchOnline">
          {{ onlineSearching ? t('models.online.searching') : t('common.search') }}
        </button>
      </div>
      <div class="hint muted" style="margin-bottom: 10px">
        <template v-if="onlineSource === 'ms'">{{ t('models.online.hintMs') }}</template>
        <template v-else>{{ dlMirror ? t('models.online.hintMirror') : t('models.online.hintHf') }}</template>
      </div>

      <div v-if="onlineResults.length" class="online-list">
        <div v-if="onlineUsedQuery !== onlineQuery.trim()" class="hint muted" style="margin-bottom: 8px">
          {{ t('models.online.usedQuery', { q: onlineUsedQuery }) }}
          <template v-if="onlineFileFiltered">{{ t('models.online.fileFiltered') }}</template>
        </div>
        <div v-for="m in onlineResults" :key="m.id" class="online-row">
          <div class="row wrap" style="gap: 8px; align-items: center">
            <span class="mono" style="word-break: break-all; font-weight: 600">{{ m.id }}</span>
            <span v-if="m.tag" class="chip small">{{ m.tag }}</span>
            <span v-if="m.gated" class="chip small gated">{{ t('models.online.gated') }}</span>
            <div class="spacer"></div>
            <span class="muted">{{ t('models.online.downloads', { n: compact(m.downloads) }) }} · ♥ {{ compact(m.likes) }}</span>
            <button class="btn small" @click="toggleFiles(m)">
              {{ onlineOpenId === m.id ? t('models.online.hideFiles') : t('models.online.showFiles') }}
            </button>
          </div>
          <div v-if="onlineOpenId === m.id" style="margin-top: 6px">
            <div v-if="onlineFilesLoading" class="muted" style="padding: 4px 0">{{ t('common.loading') }}</div>
            <template v-else-if="onlineFiles.length">
              <input
                v-if="onlineFiles.length > 5"
                v-model="onlineFileFilter"
                type="text"
                :placeholder="t('models.online.filterFiles')"
                style="width: 100%; margin-bottom: 6px"
              />
              <div v-for="f in onlineShownFiles" :key="f.name" class="online-file">
                <span class="mono" style="word-break: break-all">{{ f.name }}</span>
                <span class="muted" style="white-space: nowrap">{{ f.size ? human(f.size) : '' }}</span>
                <div class="spacer"></div>
                <button class="btn small primary" @click="downloadOnline(f)">{{ t('common.download') }}</button>
              </div>
              <div v-if="!onlineShownFiles.length" class="muted" style="padding: 4px 0">{{ t('models.online.noMatch') }}</div>
            </template>
            <div v-else class="muted" style="padding: 4px 0">{{ t('models.online.noFiles') }}</div>
          </div>
        </div>
      </div>
      <div v-else-if="onlineSearched && !onlineSearching" class="empty">
        {{ t('models.online.noResult', { q: onlineQuery }) }}
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom: 12px">
        <h3 style="margin: 0">{{ t('models.library') }}</h3>
        <div class="spacer"></div>
        <input v-model="libraryQuery" type="text" :placeholder="t('models.library.search')" style="width: 240px; margin-right: 8px" />
        <button class="btn small" :disabled="loading" @click="loadDir">{{ loading ? t('models.scanning') : t('common.refresh') }}</button>
      </div>
      <div class="row wrap" style="gap: 8px; align-items: center; margin-bottom: 10px">
        <div class="row" style="gap: 4px; align-items: center">
          <span
            class="crumb"
            :class="{ active: crumb.length === 0 }"
            @click="backTo(0)"
          >{{ t('models.custom.root') }}</span>
          <template v-for="(seg, i) in crumb" :key="i">
            <span class="crumb muted">/</span>
            <span class="crumb" :class="{ active: i === crumb.length - 1 }" @click="backTo(i + 1)">{{ seg }}</span>
          </template>
        </div>
        <div class="spacer"></div>
        <button class="btn small" @click="openNewDir">{{ crumb.length ? t('models.custom.newSub') : t('models.custom.newTop') }}</button>
      </div>
      <div v-if="newDirOpen" class="row" style="gap: 8px; align-items: center; margin-bottom: 10px">
        <input v-model="newDirName" type="text" :placeholder="t('models.custom.name')" style="width: 220px" @keyup.enter="createDir" />
        <button class="btn small primary" :disabled="!newDirName.trim()" @click="createDir">{{ t('models.custom.create') }}</button>
        <button class="btn small" @click="newDirOpen = false">{{ t('common.cancel') }}</button>
      </div>
      <div v-if="loading" class="muted" style="padding: 6px 0">{{ t('common.loading') }}</div>
      <div v-else-if="dirContent">
        <div v-if="dirContent.dirs.length" class="custom-dirs">
          <div v-for="d in dirContent.dirs" :key="d.relPath" class="custom-dir-row" @click="enterDir(d)">
            <span class="mono">{{ d.name }}</span>
            <div class="spacer"></div>
            <span class="muted">→</span>
          </div>
        </div>
        <table class="list" v-if="libraryShownFiles.length">
          <thead>
            <tr><th>{{ t('models.col.file') }}</th><th style="width: 90px">{{ t('common.size') }}</th><th style="width: 100px">{{ t('models.col.date') }}</th><th style="width: 200px"></th></tr>
          </thead>
          <tbody>
            <template v-for="f in libraryShownFiles" :key="f.relPath">
              <tr>
                <td class="mono">{{ f.name }}</td>
                <td>{{ human(f.size) }}</td>
                <td class="muted">{{ fmtDate(f.mtime) }}</td>
                <td>
                  <button class="btn small" @click="reveal(f)">{{ t('common.reveal') }}</button>
                  <button class="btn small" @click="startMove(f)">{{ t('models.move') }}</button>
                  <button class="btn small danger" @click="del(f)">{{ t('common.delete') }}</button>
                </td>
              </tr>
              <tr v-if="movingPath === f.relPath">
                <td colspan="4">
                  <div class="row" style="gap: 8px; align-items: center">
                    <span class="muted">{{ t('models.move.tip', { name: f.name }) }}</span>
                    <select v-model="movingCat" style="width: 200px">
                      <option value="">{{ t('models.move.pick') }}</option>
                      <option v-for="c in categories" :key="c" :value="c" :disabled="c === f.category">{{ c }}</option>
                    </select>
                    <button class="btn small primary" :disabled="!movingCat" @click="doMove(f)">{{ t('models.move.confirm') }}</button>
                    <button class="btn small" @click="movingPath = ''">{{ t('common.cancel') }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div v-if="!dirContent.dirs.length && !libraryShownFiles.length" class="empty">
          {{ libraryQuery.trim() ? t('models.library.noMatch') : t('models.custom.empty') }}
        </div>
      </div>
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
.chip.small.gated {
  color: var(--yellow);
}
.online-list {
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.online-row {
  padding: 8px 0;
  border-bottom: 1px dashed var(--border);
}
.online-row:last-child {
  border-bottom: none;
}
.online-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0 3px 10px;
  font-size: 12px;
}
.crumb {
  cursor: pointer;
  color: var(--accent-2);
  font-size: 13px;
}
.crumb:hover {
  text-decoration: underline;
}
.crumb.muted {
  color: var(--text-dim);
}
.crumb.active {
  color: var(--text-strong);
  font-weight: 600;
  cursor: default;
}
.custom-dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px dashed var(--border);
  cursor: pointer;
  border-radius: 4px;
}
.custom-dir-row:hover {
  background: var(--bg-hover);
}
</style>
