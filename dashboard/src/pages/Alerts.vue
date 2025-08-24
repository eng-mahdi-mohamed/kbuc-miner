<template>
  <div class="space-y-4">
    <h2 class="text-lg font-semibold">Alerts</h2>
    <div class="rounded-lg border bg-white p-4 shadow-sm text-sm">
      <div v-if="isLoading">Loading...</div>
      <div v-else-if="error">Error</div>
      <ul>
        <li v-for="(a,i) in data || []" :key="i" class="border rounded p-2 mb-2">
          <div class="text-xs text-gray-500">{{ a.timestamp }} • {{ a.severity || 'info' }}</div>
          <div class="text-sm">{{ a.message }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup>
import { useQuery } from '@tanstack/vue-query'
import { apiClient } from '../lib/api'
const api = apiClient()
const { data, isLoading, error } = useQuery({ queryKey: ['alerts'], queryFn: async () => (await api.get('/api/alerts')).data, refetchInterval: 15000 })
</script>
