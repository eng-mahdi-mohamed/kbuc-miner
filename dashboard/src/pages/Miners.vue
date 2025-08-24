<template>
  <div class="space-y-4">
    <h2 class="text-lg font-semibold">Mining Health</h2>

    <div class="rounded-lg border bg-white p-4 shadow-sm text-sm" v-if="isLoading">
      Loading health...
    </div>

    <div class="rounded-lg border bg-white p-4 shadow-sm text-sm text-red-600" v-else-if="error">
      Failed to load health
    </div>

    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard :title="'Status'" :value="statusLabel" :hint="engineLabel" />
        <StatCard :title="'Uptime'" :value="uptimeFormatted" />
        <StatCard :title="'Errors'" :value="safe(data.errors)" />
        <StatCard :title="'Restarts'" :value="safe(data.restarts)" />
        <StatCard :title="'Active Sessions'" :value="safe(data.activeSessions)" />
      </div>

      <div class="rounded-lg border bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-semibold">Current Miner</div>
          <span :class="['px-2 py-0.5 rounded text-xs', statusClass]">{{ statusLabel }}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
          <div>
            <div class="text-gray-500 text-xs">Engine</div>
            <div class="font-medium">{{ engineLabel }}</div>
          </div>
          <div>
            <div class="text-gray-500 text-xs">Hash rate</div>
            <div class="font-medium">{{ hashRateFormatted }}</div>
          </div>
          <div>
            <div class="text-gray-500 text-xs">Solutions</div>
            <div class="font-medium">{{ safe(data.solutions) }}</div>
          </div>
          <div>
            <div class="text-gray-500 text-xs">Usage</div>
            <div class="font-medium">{{ usageFormatted }}</div>
          </div>
          <div>
            <div class="text-gray-500 text-xs">Workers</div>
            <div class="font-medium">{{ data.workers !== undefined ? data.workers : '-' }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
 </template>
 <script setup>
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { apiClient } from '../lib/api'
import StatCard from '../components/StatCard.vue'

const api = apiClient()
const { data, isLoading, error } = useQuery({
  queryKey: ['health'],
  queryFn: async () => (await api.get('/api/mining/health')).data,
  refetchInterval: 7000,
})

const statusLabel = computed(() => {
  const s = data?.value?.status || 'stopped'
  return s === 'healthy' ? 'Healthy' : s.charAt(0).toUpperCase() + s.slice(1)
})

const statusClass = computed(() => {
  const s = data?.value?.status
  return s === 'healthy'
    ? 'bg-green-100 text-green-700 border border-green-200'
    : 'bg-gray-100 text-gray-700 border border-gray-200'
})

const uptimeFormatted = computed(() => formatDuration(data?.value?.uptime || 0))

const engineLabel = computed(() => {
  const d = data?.value || {}
  if (d.gpuUsage !== undefined || d.gpuHashRate !== undefined) return 'GPU'
  if (d.cpuUsage !== undefined || d.workers !== undefined) return 'CPU'
  return 'Unknown'
})

const hashRateFormatted = computed(() => formatHashRate(data?.value?.hashRate || data?.value?.gpuHashRate || data?.value?.cpuHashRate || 0))

const usageFormatted = computed(() => {
  const d = data?.value || {}
  const usage = d.gpuUsage ?? d.cpuUsage
  return usage !== undefined ? `${Number(usage).toFixed(1)}%` : '-'
})

function safe(v) {
  return v ?? 0
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

function formatHashRate(v) {
  const n = Number(v || 0)
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GH/s`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MH/s`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} kH/s`
  return `${n.toFixed(2)} H/s`
}
 </script>
