<template>
  <div class="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 z-10">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between text-xs">
      <div class="flex items-center gap-3">
        <span :class="['inline-flex items-center gap-1', apiOnline ? 'text-green-600' : 'text-gray-500']">
          <span class="w-2 h-2 rounded-full" :class="apiOnline ? 'bg-green-500' : 'bg-gray-400'" />
          API {{ apiOnline ? 'online' : 'offline' }}
        </span>
        <span :class="['inline-flex items-center gap-1', wsReady ? 'text-blue-600' : 'text-gray-500']">
          <span class="w-2 h-2 rounded-full" :class="wsReady ? 'bg-blue-500' : 'bg-gray-400'" />
          WS {{ wsReady ? 'connected' : 'disconnected' }}
        </span>
      </div>
      <div class="opacity-70">
        <span>Theme:</span>
        <button class="ml-2 px-2 py-0.5 border rounded" @click="$emit('toggle-theme')">Toggle</button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { useAppState } from '../lib/state'
const { wsReady, apiOnline } = useAppState()
</script>
