<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { t } from '../i18n'
import { store } from '../store'

const autoScroll = ref(true)
const filter = ref('')
const streamFilter = ref<'all' | 'stdout' | 'stderr' | 'sys'>('all')
const logEl = ref<HTMLElement | null>(null)

const lines = computed(() =>
  store.logs.filter(l => {
    if (streamFilter.value !== 'all' && l.stream !== streamFilter.value) return false
    if (filter.value && !l.text.toLowerCase().includes(filter.value.toLowerCase())) return false
    return true
  })
)

function fmt(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

watch(
  () => store.logs.length,
  async () => {
    if (autoScroll.value) {
      await nextTick()
      if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
    }
  }
)

function clearView() {
  store.logs.splice(0)
}

async function copyAll() {
  const text = lines.value.map(l => `[${fmt(l.ts)}] ${l.text}`).join('\n')
  await navigator.clipboard.writeText(text)
}
</script>

<template>
  <div>
    <div class="page-title">{{ t('logs.pageTitle') }}</div>
    <div class="page-desc">{{ t('logs.desc') }}</div>

    <div class="card">
      <div class="row" style="margin-bottom: 12px">
        <input v-model="filter" type="text" :placeholder="t('logs.filterPlaceholder')" style="width: 220px" />
        <select v-model="streamFilter" style="width: 130px">
          <option value="all">{{ t('logs.streamAll') }}</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
          <option value="sys">{{ t('logs.streamSys') }}</option>
        </select>
        <label class="muted row" style="gap: 4px; cursor: pointer">
          <input v-model="autoScroll" type="checkbox" /> {{ t('logs.autoScroll') }}
        </label>
        <div class="spacer"></div>
        <button class="btn small" @click="copyAll">{{ t('logs.copyAll') }}</button>
        <button class="btn small danger" @click="clearView">{{ t('logs.clearView') }}</button>
      </div>
      <div ref="logEl" class="log-view" style="height: calc(100vh - 280px)">
        <div v-for="(l, i) in lines" :key="i" class="log-line">
          <span class="time">{{ fmt(l.ts) }}</span>
          <span :class="l.stream">{{ l.text }}</span>
        </div>
        <div v-if="!lines.length" class="empty">{{ t('logs.empty') }}</div>
      </div>
    </div>
  </div>
</template>
