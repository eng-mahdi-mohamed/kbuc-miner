<template>
  <div class="rounded-lg border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 p-4 shadow-sm">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-sm font-medium">التحكم</div>
        <div class="text-xs text-gray-500 dark:text-gray-400">إدارة دورة تشغيل التعدين</div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="px-3 py-1.5 rounded text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isRunning || anyLoading"
          @click="onStart"
        >تشغيل</button>
        
        <button
          class="px-3 py-1.5 rounded text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isRunning || anyLoading"
          @click="onStop"
        >إيقاف</button>

        <button
          class="px-3 py-1.5 rounded text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="anyLoading"
          @click="onRestart"
        >إعادة التشغيل</button>

        <button
          v-if="!isPaused"
          class="px-3 py-1.5 rounded text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isRunning || anyLoading"
          @click="onPause"
        >إيقاف مؤقت</button>
        <button
          v-else
          class="px-3 py-1.5 rounded text-sm font-medium text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="anyLoading"
          @click="onResume"
        >استئناف</button>
      </div>
    </div>

    <div class="mt-3 text-xs text-gray-600 dark:text-gray-400 flex items-center gap-3">
      <span :class="['inline-flex items-center gap-1', isRunning ? 'text-green-700' : 'text-gray-500 dark:text-gray-400']">
        <span class="w-2 h-2 rounded-full" :class="isRunning ? 'bg-green-500' : 'bg-gray-400'" />
        {{ isRunning ? 'قيد التشغيل' : 'متوقف' }}
      </span>
      <span v-if="message" class="text-gray-500 dark:text-gray-400">{{ message }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { startMining, stopMining, restartMining, pauseMining, resumeMining, getCurrentSession, invalidateMiningQueries } from '../lib/mining'

const props = defineProps({
  status: { type: String, default: 'unknown' },
})

const isRunning = computed(() => props.status === 'running')
const isPaused = ref(false)
const message = ref('')

const queryClient = useQueryClient()
const anyLoading = ref(false)

function setMessage(text) {
  message.value = text
  if (!text) return
  // Auto clear
  setTimeout(() => { if (message.value === text) message.value = '' }, 3000)
}

async function onStart() {
  try {
    anyLoading.value = true
    setMessage('Starting...')
    await startMining({})
    await invalidateMiningQueries(queryClient)
    setMessage('Started')
  } catch (e) {
    setMessage(`Failed to start: ${e?.response?.data?.message || e.message}`)
  } finally {
    anyLoading.value = false
  }
}

async function onStop() {
  try {
    anyLoading.value = true
    setMessage('Stopping...')
    const session = await getCurrentSession().catch(() => null)
    if (!session?.id && !session?.sessionId) {
      setMessage('No active session to stop')
    } else {
      await stopMining(session.id || session.sessionId)
      await invalidateMiningQueries(queryClient)
      isPaused.value = false
      setMessage('Stopped')
    }
  } catch (e) {
    setMessage(`Failed to stop: ${e?.response?.data?.message || e.message}`)
  } finally {
    anyLoading.value = false
  }
}

async function onRestart() {
  try {
    anyLoading.value = true
    setMessage('Restarting...')
    await restartMining('manual', true)
    await invalidateMiningQueries(queryClient)
    isPaused.value = false
    setMessage('Restarted')
  } catch (e) {
    setMessage(`Failed to restart: ${e?.response?.data?.message || e.message}`)
  } finally {
    anyLoading.value = false
  }
}

async function onPause() {
  try {
    anyLoading.value = true
    setMessage('Pausing...')
    const res = await pauseMining()
    if (res?.success) {
      isPaused.value = true
      setMessage('Paused')
    } else {
      setMessage(res?.message || 'Unable to pause')
    }
    await invalidateMiningQueries(queryClient)
  } catch (e) {
    setMessage(`Failed to pause: ${e?.response?.data?.message || e.message}`)
  } finally {
    anyLoading.value = false
  }
}

async function onResume() {
  try {
    anyLoading.value = true
    setMessage('Resuming...')
    const res = await resumeMining()
    if (res?.success) {
      isPaused.value = false
      setMessage('Resumed')
    } else {
      setMessage(res?.message || 'Unable to resume')
    }
    await invalidateMiningQueries(queryClient)
  } catch (e) {
    setMessage(`Failed to resume: ${e?.response?.data?.message || e.message}`)
  } finally {
    anyLoading.value = false
  }
}
</script>
