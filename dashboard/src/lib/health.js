import { useSettings } from './settings'
import { useAppState } from './state'

let timer = null

export function startHealthPolling(interval = 5000) {
  stopHealthPolling()
  const { apiBase } = useSettings()
  const { setApiOnline } = useAppState()
  const poll = async () => {
    try {
      const url = new URL('/health', apiBase.value)
      const res = await fetch(url.toString(), { cache: 'no-store' })
      setApiOnline(res.ok)
    } catch (e) {
      setApiOnline(false)
    } finally {
      timer = setTimeout(poll, interval)
    }
  }
  poll()
}

export function stopHealthPolling() {
  if (timer) { clearTimeout(timer); timer = null }
}
