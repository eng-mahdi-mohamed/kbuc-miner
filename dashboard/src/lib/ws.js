import { useSettings } from './settings'
import { useAppState } from './state'

export function connectWs(path = '/api/ws') {
  const { apiBase, apiKey } = useSettings()
  const { setWsReady } = useAppState()
  const url = new URL(path, apiBase.value)
  if (apiKey.value) url.searchParams.set('apiKey', apiKey.value)
  // Force ws protocol
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  const ws = new WebSocket(url.toString())
  ws.addEventListener('open', () => setWsReady(true))
  ws.addEventListener('close', () => setWsReady(false))
  ws.addEventListener('error', () => setWsReady(false))
  return ws
}
