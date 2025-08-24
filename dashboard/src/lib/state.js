import { reactive, computed } from 'vue'

const s = reactive({
  wsReady: false,
  apiOnline: false,
  theme: localStorage.getItem('theme') || 'light',
})

export function useAppState() {
  const setWsReady = (v) => { s.wsReady = !!v }
  const setApiOnline = (v) => { s.apiOnline = !!v }
  const setTheme = (v) => { s.theme = v; localStorage.setItem('theme', v) }
  return {
    wsReady: computed(() => s.wsReady),
    apiOnline: computed(() => s.apiOnline),
    theme: computed(() => s.theme),
    setWsReady,
    setApiOnline,
    setTheme,
    _raw: s,
  }
}
