<template>
  <div class="space-y-4">
    <h2 class="text-lg font-semibold">Sessions</h2>

    <div class="rounded-lg border bg-white p-4 shadow-sm text-sm" v-if="isLoading">
      Loading sessions...
    </div>

    <div class="rounded-lg border bg-white p-4 shadow-sm text-sm text-red-600" v-else-if="error">
      Failed to load sessions
    </div>

    <div v-else class="rounded-lg border bg-white p-0 shadow-sm overflow-hidden">
      <div class="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b">
        <div class="col-span-4">ID</div>
        <div class="col-span-2">Status</div>
        <div class="col-span-2">Miner</div>
        <div class="col-span-2">Start</div>
        <div class="col-span-2 text-right pr-1">Uptime</div>
      </div>
      <div v-if="(sessions || []).length === 0" class="px-4 py-6 text-center text-sm text-gray-500">
        No sessions yet
      </div>
      <div v-for="s in sessions" :key="s.id" class="px-4 py-3 border-b last:border-b-0 text-sm">
        <div class="grid grid-cols-12 items-center gap-2">
          <div class="col-span-12 md:col-span-4">
            <div class="flex items-center gap-2">
              <code class="bg-gray-50 border px-2 py-0.5 rounded text-xs">{{ shortId(s.id) }}</code>
              <span v-if="isCurrent(s)" class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs border border-blue-200">Current</span>
            </div>
            <div class="mt-1 text-xs text-gray-500 truncate">
              {{ s.id }}
            </div>
          </div>
          <div class="col-span-6 md:col-span-2">
            <span :class="['px-2 py-0.5 rounded text-xs border', statusClass(s.status)]">{{ labelStatus(s.status) }}</span>
          </div>
          <div class="col-span-6 md:col-span-2">{{ s.minerType || '-' }}</div>
          <div class="col-span-6 md:col-span-2">{{ formatTime(s.startTime) }}</div>
          <div class="col-span-6 md:col-span-2 text-right pr-1">{{ formatDuration(uptimeOf(s)) }}</div>
        </div>
        <div v-if="s.config" class="mt-2 text-xs text-gray-500 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <div class="text-[10px] uppercase">Block</div>
            <div>{{ s.config.block_height ?? '-' }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase">Leader</div>
            <div class="truncate" :title="s.config.leader_address">{{ s.config.leader_address ?? '-' }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase">Reward</div>
            <div class="truncate" :title="s.config.reward_address">{{ s.config.reward_address ?? '-' }}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase">Type</div>
            <div>{{ s.config.mining_type ?? '-' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { apiClient } from '../lib/api'

const api = apiClient()
const sessionsQuery = useQuery({
  queryKey: ['sessions'],
  queryFn: async () => (await api.get('/api/mining/sessions')).data,
  refetchInterval: 10000,
})

const currentQuery = useQuery({
  queryKey: ['currentSession'],
  queryFn: async () => (await api.get('/api/mining/session')).data,
  refetchInterval: 10000,
})

const data = sessionsQuery.data
const isLoading = computed(() => sessionsQuery.isLoading.value || currentQuery.isLoading.value)
const error = computed(() => sessionsQuery.error.value || currentQuery.error.value)
const sessions = computed(() => Array.isArray(data?.value) ? data.value : [])
const currentId = computed(() => currentQuery?.data?.value?.id || null)

function shortId(id) {
  if (!id) return '-'
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

function isCurrent(s) {
  return s && currentId.value && s.id === currentId.value
}

function labelStatus(s) {
  if (!s) return 'Unknown'
  const map = { starting: 'Starting', running: 'Running', paused: 'Paused', stopped: 'Stopped', error: 'Error' }
  return map[s] || (s.charAt(0).toUpperCase() + s.slice(1))
}

function statusClass(s) {
  switch (s) {
    case 'running': return 'bg-green-50 text-green-700 border-green-200'
    case 'paused': return 'bg-yellow-50 text-yellow-700 border-yellow-200'
    case 'stopped': return 'bg-gray-50 text-gray-700 border-gray-200'
    case 'error': return 'bg-red-50 text-red-700 border-red-200'
    default: return 'bg-blue-50 text-blue-700 border-blue-200'
  }
}

function uptimeOf(s) {
  if (!s) return 0
  if (typeof s.uptime === 'number') return s.uptime
  if (s.startTime) return Date.now() - s.startTime
  return 0
}

function formatTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString()
}

function formatDuration(ms) {
  ms = Number(ms || 0)
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h > 0) return `${h}h ${m}m ${ss}s`
  if (m > 0) return `${m}m ${ss}s`
  return `${ss}s`
}
</script>
