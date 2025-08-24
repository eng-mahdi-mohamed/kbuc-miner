import { useQueryClient } from '@tanstack/vue-query'
import { apiClient } from './api'

const api = () => apiClient()

// Mining control API
export async function startMining(params = {}) {
  // Backend validates presence of fields but ignores values when starting.
  // Provide minimal defaults if not supplied.
  const payload = {
    hash: params.hash ?? String(Date.now()),
    leader_address: params.leader_address ?? '0xleader',
    reward_address: params.reward_address ?? '0xreward',
    block_height: params.block_height ?? 1,
    timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
    target: params.target ?? '0x',
    mining_type: params.mining_type ?? 1,
  }
  const res = await api().post('/api/mining/start', payload)
  return res.data
}

export async function stopMining(sessionId) {
  const res = await api().post('/api/mining/stop', { sessionId: sessionId ?? null })
  return res.data
}

export async function restartMining(reason = 'manual', force = false) {
  const res = await api().post('/api/mining/restart', { reason, force })
  return res.data
}

export async function pauseMining() {
  const res = await api().post('/api/mining/pause', {})
  return res.data
}

export async function resumeMining() {
  const res = await api().post('/api/mining/resume', {})
  return res.data
}

export async function getDashboard() {
  const res = await api().get('/api/dashboard')
  return res.data
}

export async function getStatus() {
  const res = await api().get('/api/mining/status')
  return res.data
}

export async function getCurrentSession(id) {
  const res = await api().get('/api/mining/session', {
    params: id ? { id } : undefined,
  })
  return res.data
}

export function invalidateMiningQueries(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['stats'] }),
    queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  ])
}
