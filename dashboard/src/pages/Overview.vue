 <template>
  <div class="space-y-6">
    <ControlPanel :status="miningStatus" />
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard title="Status" :value="miningStatus" />
      <StatCard title="Hash Rate" :value="formatHashRate(displayedHashRate)" />
      <StatCard title="Total Hashes" :value="formatInteger(displayedTotalHashes)" />
      <StatCard title="Solutions" :value="formatInteger(displayedSolutions)" />
    </div>

    <ChartCard title="Hash Rate" :data="seriesData">
      <template #actions>
        <button class="text-xs text-blue-600 hover:underline" @click="resetSeries">Reset</button>
      </template>
      <template #default>
      </template>
    </ChartCard>

    <div class="rounded-lg border bg-white p-4 shadow-sm">
      <div class="text-sm font-medium mb-2">Connection</div>
      <div class="flex flex-wrap gap-3 items-end">
        <div>
          <label class="block text-xs text-gray-500">API Base</label>
          <input class="border rounded px-2 py-1 text-sm" v-model="apiBaseModel" placeholder="http://localhost:8001" />
        </div>
        <div>
          <label class="block text-xs text-gray-500">API Key</label>
          <input class="border rounded px-2 py-1 text-sm" v-model="apiKeyModel" placeholder="optional" />
        </div>
        <button class="bg-blue-600 text-white text-sm rounded px-3 py-1" @click="saveConn">Save</button>
        <span class="text-xs" :class="wsReady ? 'text-green-600' : 'text-gray-500'">WS: {{ wsReady ? 'connected' : 'disconnected' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { apiClient } from '../lib/api'
import { connectWs } from '../lib/ws'
import { useSettings } from '../lib/settings'
import StatCard from '../components/StatCard.vue'
import ChartCard from '../components/ChartCard.vue'
import ControlPanel from '../components/ControlPanel.vue'

const { apiBase, apiKey, setApiBase, setApiKey } = useSettings()
const api = apiClient()

// Polling fallback for stats
const statsQuery = useQuery({ queryKey: ['stats'], queryFn: async () => (await api.get('/api/mining/stats')).data, refetchInterval: 5000 })
const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get('/api/dashboard')).data, refetchInterval: 10000 })

const miningStatus = computed(() => dashboard.data?.value?.mining?.status || 'unknown')

const seriesData = ref([]) // [ [ts, value], ... ]
let ws
const wsReady = ref(false)
const lastWsStats = ref(null)

function resetSeries() { seriesData.value = [] }
function formatInteger(n) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0))) }
function formatHashRate(v) {
  const n = Number(v || 0)
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GH/s`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MH/s`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} kH/s`
  return `${n.toFixed(2)} H/s`
}

function openWs() {
  if (ws) try { ws.close() } catch {}
  ws = connectWs('/api/ws')
  ws.onopen = () => { wsReady.value = true }
  ws.onclose = () => { wsReady.value = false }
  ws.onerror = () => {}
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'stats' && msg.data) {
        lastWsStats.value = msg.data
        if (msg.data.hashRate != null) {
          const ts = msg.ts || Date.now()
          // Exponential smoothing for smoother chart
          const alpha = 0.4
          const prev = seriesData.value.length ? Number(seriesData.value[seriesData.value.length - 1][1]) : Number(msg.data.hashRate)
          const smoothed = alpha * Number(msg.data.hashRate) + (1 - alpha) * prev
          seriesData.value = [...seriesData.value.slice(-300), [ts, smoothed]]
        }
      }
    } catch {}
  }
}

onMounted(() => { openWs() })

onBeforeUnmount(() => { if (ws) ws.close() })

watch([apiBase, apiKey], () => { openWs() })

const apiBaseModel = ref(apiBase.value)
const apiKeyModel = ref(apiKey.value)
function saveConn() { setApiBase(apiBaseModel.value); setApiKey(apiKeyModel.value) }

// Prefer WS stats when available, fall back to polling
const displayedHashRate = computed(() => {
  return Number(lastWsStats.value?.hashRate ?? statsQuery.data?.value?.hashRate ?? 0)
})
const displayedTotalHashes = computed(() => {
  return Number(lastWsStats.value?.totalHashes ?? statsQuery.data?.value?.totalHashes ?? 0)
})
const displayedSolutions = computed(() => {
  return Number(lastWsStats.value?.solutions ?? statsQuery.data?.value?.solutions ?? 0)
})
</script>
