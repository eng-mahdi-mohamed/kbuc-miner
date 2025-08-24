<template>
  <div class="min-h-full">
    <header class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <h1 class="text-xl font-semibold">KBUC Miner Dashboard</h1>
        <nav class="flex gap-4 text-sm">
          <RouterLink class="hover:underline" to="/">Overview</RouterLink>
          <RouterLink class="hover:underline" to="/miners">Workers</RouterLink>
          <RouterLink class="hover:underline" to="/sessions">Sessions</RouterLink>
          <RouterLink class="hover:underline" to="/logs">Logs</RouterLink>
          <RouterLink class="hover:underline" to="/config">Config</RouterLink>
          <RouterLink class="hover:underline" to="/alerts">Alerts</RouterLink>
        </nav>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <router-view />
    </main>

    <StatusBar @toggle-theme="toggleTheme" />
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import StatusBar from './components/StatusBar.vue'
import { startHealthPolling, stopHealthPolling } from './lib/health'
import { useAppState } from './lib/state'

const { theme, setTheme } = useAppState()

function toggleTheme() {
  const next = theme.value === 'light' ? 'dark' : 'light'
  setTheme(next)
  document.documentElement.classList.toggle('dark', next === 'dark')
}

onMounted(() => {
  // Apply saved theme
  document.documentElement.classList.toggle('dark', theme.value === 'dark')
  startHealthPolling(5000)
})

onBeforeUnmount(() => {
  stopHealthPolling()
})
</script>

<style scoped>
</style>
