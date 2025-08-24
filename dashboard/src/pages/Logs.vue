<template>
  <div class="space-y-4">
    <h2 class="text-lg font-semibold">Logs</h2>
    <div class="rounded-lg border bg-white p-4 shadow-sm text-sm">
      <div class="flex gap-2 items-center mb-2">
        <label class="text-xs">Level</label>
        <select v-model="level" class="border rounded px-2 py-1 text-sm">
          <option>info</option>
          <option>warn</option>
          <option>error</option>
        </select>
        <button class="bg-gray-800 text-white text-sm rounded px-3 py-1" @click="refetch()">Refresh</button>
      </div>
      <div v-if="isLoading">Loading...</div>
      <div v-else-if="error">Error</div>
      <ul class="space-y-2">
        <li v-for="(l,i) in data || []" :key="i" class="border rounded p-2">
          <div class="text-xs text-gray-500">{{ l.timestamp }} • {{ l.level }}</div>
          <div class="text-sm">{{ l.message }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { apiClient } from '../lib/api'
const api = apiClient()
const level = ref('info')
const { data, isLoading, error, refetch } = useQuery({ queryKey: ['logs', level], queryFn: async () => (await api.get('/api/logs', { params: { level: level.value, limit: 100 } })).data })
</script>
