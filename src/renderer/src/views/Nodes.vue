<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import type { NodeItem } from '../../../shared/api'

const nodes = ref<NodeItem[]>([])
const installInput = ref('')
const busy = ref(false)
const updatingAll = ref(false)
const logs = ref<string[]>([])
const error = ref('')
const filter = ref('')
const logEl = ref<HTMLElement | null>(null)

interface QueueItem {
  name: string
  url: string
  status: string
  error?: string
}

const queue = ref<QueueItem[]>([])
let activeBatch = 0
let batchSeq = 0

let offEvent: (() => void) | null = null
let offItem: (() => void) | null = null

/** 解析输入框中的多个仓库地址（按行 / 逗号分隔） */
const urls = computed(() =>
  installInput.value
    .split(/[\r\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
)

/** 与主进程一致的节点名提取 */
function nameOf(url: string): string {
  return decodeURIComponent(url.replace(/\/+$/, '').split(/[/:]/).pop() || url).replace(/\.git$/i, '')
}

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

/** 合并单个节点的状态事件到队列（按 url 命中，支持重试复用同一行） */
function applyItem(e: { name: string; status: string; error?: string }): void {
  const it = queue.value.find(q => q.name === e.name)
  if (!it) return
  it.status = e.status
  it.error = e.error
}

/** 发起安装（首个或重试共用） */
async function runInstall(list: string[]): Promise<void> {
  if (!list.length || busy.value) return
  const id = ++batchSeq
  activeBatch = id
  busy.value = true
  error.value = ''
  // 队列补全；已存在的行保留位置，等待 onItem 更新状态
  for (const url of list) {
    const it = queue.value.find(q => q.url === url)
    if (it) {
      it.status = 'pending'
      it.error = ''
    } else {
      queue.value.push({ name: nameOf(url), url, status: 'pending' })
    }
  }
  try {
    const r = (await api.installNodes(list, id)) as { ok: string[]; failed: string[]; cancelled: boolean }
    if (r.cancelled) logs.value.push(t('nodes.batch.cancelled'))
    else logs.value.push(t('nodes.batch.done', { n: r.ok.length }))
    const bad = queue.value.filter(q => q.status === 'failed')
    if (bad.length) error.value = t('nodes.batch.someFailed')
    await refresh()
  } catch (e) {
    error.value = (e as Error).message || String(e)
  } finally {
    busy.value = false
  }
}

function install() {
  void runInstall(urls.value)
}

function stopInstall() {
  if (activeBatch) void api.cancelNodeInstall(activeBatch)
}

function retry(name: string) {
  const it = queue.value.find(q => q.name === name && q.status === 'failed')
  if (it) void runInstall([it.url])
}

function retryFailed() {
  const f = queue.value.filter(q => q.status === 'failed').map(q => q.url)
  void runInstall(f)
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

function statusLabel(s: string): string {
  return t(`nodes.status.${s}` as never)
}

onMounted(async () => {
  offItem = api.onNodeItem((e: { batchId: number; name: string; status: string; error?: string }) => {
    // 只处理当前批次的事件（重试批次 id 已更新）
    if (e.batchId === activeBatch) applyItem(e)
  })
  offEvent = api.onNodeEvent((m: string) => {
    logs.value.push(m)
    if (logs.value.length > 200) logs.value.shift()
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
  await refresh()
})

onUnmounted(() => {
  offEvent?.()
  offItem?.()
})
</script>

<template>
  <div>
    <div class="page-title">{{ t('nodes.title') }}</div>
    <div class="page-desc">{{ t('nodes.desc') }}</div>

    <div v-if="error" class="card" style="border-color: var(--red); color: var(--red)">{{ error }}</div>

    <div class="card">
      <h3>{{ t('nodes.install.title') }}</h3>
      <textarea
        v-model="installInput"
        rows="3"
        :placeholder="t('nodes.install.placeholder')"
        style="width: 100%"
        @keydown.ctrl.enter="install"
      />
      <div class="row wrap" style="gap: 6px; margin-top: 8px">
        <button class="btn primary" :disabled="!urls.length || busy" @click="install">
          {{ busy ? t('nodes.installing') : t('nodes.install') }}
        </button>
        <button v-if="busy" class="btn danger" @click="stopInstall">{{ t('nodes.install.stop') }}</button>
        <button class="btn" :disabled="updatingAll || busy" @click="updateAll">{{ t('nodes.updateAll') }}</button>
      </div>
      <div class="hint muted" style="margin-top: 6px">{{ t('nodes.install.proxyHint') }}</div>
    </div>

    <div class="card" v-if="queue.length">
      <h3>{{ t('nodes.batch.title') }}</h3>
      <div v-for="it in queue" :key="it.url" class="row" style="gap: 8px; padding: 4px 0; align-items: center">
        <span class="mono" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ it.name }}</span>
        <span class="batch-status" :class="it.status">{{ statusLabel(it.status) }}</span>
        <span class="muted" style="max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ it.error }}</span>
        <button v-if="it.status === 'failed'" class="btn small" @click="retry(it.name)">{{ t('nodes.retry') }}</button>
      </div>
      <div class="row" style="margin-top: 6px" v-if="!busy && queue.some(x => x.status === 'failed')">
        <button class="btn small" @click="retryFailed">{{ t('nodes.retryFailed') }}</button>
      </div>
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

<style scoped>
.batch-status {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
}
.batch-status.installing {
  color: var(--accent);
  background: var(--glass-bg-strong);
}
.batch-status.done {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 12%, transparent);
}
.batch-status.failed {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 12%, transparent);
}
.batch-status.skipped {
  color: var(--text-dim);
  background: var(--glass-bg-strong);
}
.batch-status.cancelled {
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 12%, transparent);
}
.batch-status.pending {
  color: var(--text-dim);
  background: var(--glass-bg);
}
</style>