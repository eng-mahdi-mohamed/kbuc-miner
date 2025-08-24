<template>
  <div class="rounded-lg border bg-white p-4 shadow-sm">
    <div class="text-sm text-gray-500">{{ title }}</div>
    <div class="mt-1 text-2xl font-semibold">{{ value }}</div>
    <div v-if="hint" class="text-xs text-gray-400 mt-1">{{ hint }}</div>
  </div>
</template>
<script setup>
defineProps({ title: String, value: [String, Number], hint: String })
</script>
