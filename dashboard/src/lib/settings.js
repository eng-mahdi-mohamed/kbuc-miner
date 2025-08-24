import { reactive, computed } from 'vue'

const state = reactive({
  apiBase: localStorage.getItem('apiBase') || (import.meta.env.VITE_API_BASE || 'http://localhost:8001'),
  apiKey: localStorage.getItem('apiKey') || (import.meta.env.VITE_API_KEY || ''),
})

export function useSettings() {
  const setApiBase = (v) => { state.apiBase = v; localStorage.setItem('apiBase', v) }
  const setApiKey = (v) => { state.apiKey = v; localStorage.setItem('apiKey', v) }
  return {
    apiBase: computed(() => state.apiBase),
    apiKey: computed(() => state.apiKey),
    setApiBase,
    setApiKey,
  }
}
