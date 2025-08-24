<template>
  <div class="rounded-lg border bg-white p-4 shadow-sm">
    <div class="flex items-center justify-between mb-2">
      <div class="text-sm text-gray-600">{{ title }}</div>
      <slot name="actions" />
    </div>
    <apexchart type="line" height="260" :options="options" :series="series" />
  </div>
</template>
<script setup>
import VueApexCharts from 'vue3-apexcharts'
import { computed } from 'vue'

const props = defineProps({ title: String, data: { type: Array, default: () => [] } })

function formatHashRate(n) {
  const v = Number(n || 0)
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GH/s`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MH/s`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} kH/s`
  return `${v.toFixed(2)} H/s`
}

const options = computed(() => ({
  chart: { animations: { enabled: true } },
  xaxis: { type: 'datetime' },
  yaxis: { labels: { formatter: (val) => formatHashRate(val) } },
  stroke: { curve: 'smooth', width: 2 },
  dataLabels: { enabled: false },
  tooltip: { x: { format: 'HH:mm:ss' }, y: { formatter: (val) => formatHashRate(val) } },
}))

const series = computed(() => [{ name: 'Hash Rate', data: props.data }])
</script>
<script>
export default { components: { apexchart: VueApexCharts } }
</script>
