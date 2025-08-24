<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">الإعدادات العامة - Configuration</h2>
      <div class="flex gap-2">
        <button class="bg-gray-100 text-gray-800 text-sm rounded px-3 py-1 border" @click="downloadJson">تنزيل JSON</button>
        <input ref="uploader" type="file" accept="application/json" class="hidden" @change="onUploadJson" />
        <button class="bg-gray-100 text-gray-800 text-sm rounded px-3 py-1 border" @click="() => uploader && uploader.click()">رفع JSON</button>
        <button :disabled="hasErrors || mutation.isPending?.isPending" class="bg-blue-600 disabled:opacity-50 text-white text-sm rounded px-3 py-1" @click="save">حفظ Save</button>
        <!-- {{ hasErrors + " | " + JSON.stringify(mutation.isPending) }} -->
        <button class="bg-gray-200 text-gray-800 text-sm rounded px-3 py-1" @click="reset">استعادة Reset</button>
      </div>
    </div>

    <div class="rounded-lg border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 p-4 shadow-sm text-sm">
      <div v-if="isLoading">Loading...</div>
      <div v-else-if="error">تعذر تحميل الإعدادات</div>
      <div v-else class="space-y-6">
        <!-- System -->
        <section>
          <h3 class="font-semibold mb-2">النظام - System</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormInput v-model="editable.system.name" label="اسم النظام" hint="اسم العرض للنظام" />
            <FormInput v-model="editable.system.environment" label="البيئة" hint="production / development" :validator="vRequired" :error="errors['system.environment']"/>
            <FormSelect v-model="editable.system.logLevel" label="مستوى السجل" :options="logLevels" :error="errors['system.logLevel']"/>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <FormSwitch v-model="editable.system.debug" label="وضع التصحيح" hint="تشغيل سجلات تفصيلية" />
            <FormSwitch v-model="editable.system.testMode" label="وضع الاختبار" />
          </div>
        </section>

        <!-- Network API -->
        <section>
          <h3 class="font-semibold mb-2">الشبكة - API</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormInput v-model="editable.network.api.host" label="API Host" :validator="vRequired" :error="errors['network.api.host']"/>
            <FormNumber v-model.number="editable.network.api.port" label="Port" :validator="vPort" :error="errors['network.api.port']"/>
            <FormNumber v-model.number="editable.network.api.timeout" label="Timeout (ms)" :validator="vPositive" :error="errors['network.api.timeout']"/>
            <FormNumber v-model.number="editable.network.api.retryDelay" label="Retry Delay (ms)" :validator="vPositiveOrZero" />
          </div>
        </section>

        <!-- Network RPC -->
        <section>
          <h3 class="font-semibold mb-2">الشبكة - RPC</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormInput v-model="editable.network.rpc.host" label="RPC Host" :validator="vRequired" :error="errors['network.rpc.host']"/>
            <FormNumber v-model.number="editable.network.rpc.port" label="Port" :validator="vPort" :error="errors['network.rpc.port']"/>
            <FormNumber v-model.number="editable.network.rpc.timeout" label="Timeout (ms)" :validator="vPositive" />
            <FormSwitch v-model="editable.network.rpc.connectionPool.keepAlive" label="Keep Alive" />
          </div>
        </section>

        <!-- Mining: Blockchain -->
        <section>
          <h3 class="font-semibold mb-2">التعدين - السلسلة</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormInput v-model="editable.mining.blockchain.defaultRewardAddress" label="عنوان المكافأة" :validator="vHex40" :error="errors['mining.blockchain.defaultRewardAddress']" hint="عنوان Hex بطول 40" />
            <FormInput v-model="editable.mining.blockchain.defaultTicketData" label="بيانات التذكرة" :validator="vHex64" :error="errors['mining.blockchain.defaultTicketData']" hint="Hex بطول 64" />
            <FormInput v-model="editable.mining.blockchain.defaultDifficultyTarget" label="الهدف" :validator="vHex64" :error="errors['mining.blockchain.defaultDifficultyTarget']" />
          </div>
        </section>

        <!-- Mining: Session/Restart -->
        <section>
          <h3 class="font-semibold mb-2">التعدين - الجلسة وإعادة التشغيل</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormNumber v-model.number="editable.mining.session.maxTimeSeconds" label="المدة القصوى (ث)" :validator="vPositive" />
            <FormNumber v-model.number="editable.mining.session.timeout" label="مهلة الجلسة (ث)" :validator="vPositive" />
            <FormSwitch v-model="editable.mining.restart.autoRestart" label="إعادة تلقائية" />
            <FormNumber v-model.number="editable.mining.restart.delaySeconds" label="مهلة الإعادة (ث)" :validator="vPositiveOrZero" />
          </div>
        </section>

        <!-- Mining: Broadcast/Solutions -->
        <section>
          <h3 class="font-semibold mb-2">التعدين - البث والحلول</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormSwitch v-model="editable.mining.broadcast.enabled" label="تفعيل البث" />
            <FormSelect v-model="editable.mining.broadcast.mode" label="وضع البث" :options="broadcastModes" />
            <FormNumber v-model.number="editable.mining.broadcast.batchSize" label="حجم الدفعة" :validator="vPositive" />
            <FormNumber v-model.number="editable.mining.broadcast.batchTimeoutMs" label="مهلة الدفعة (ms)" :validator="vPositive" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <FormSwitch v-model="editable.mining.solutions.supportSubSolutions" label="حلول فرعية" />
            <FormSwitch v-model="editable.mining.solutions.broadcastAll" label="بث جميع الحلول" />
          </div>
        </section>

        <!-- Engines -->
        <section>
          <h3 class="font-semibold mb-2">المحركات - Engines</h3>
          <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
            <FormSwitch v-model="editable.engines.gpu.enabled" label="GPU" />
            <FormSelect v-model="editable.engines.gpu.priority" label="أولوية GPU" :options="priorities" />
            <FormNumber v-model.number="editable.engines.gpu.batchSize" label="Batch Size" :validator="vPositive" class="col-span-2" />
            <FormNumber v-model.number="editable.engines.gpu.blocks" label="Blocks" :validator="vPositive" class="col-span-2" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <FormSelect v-model="editable.engines.cpu.priority" label="أولوية CPU" :options="priorities" />
            <FormInput v-model="editable.engines.cpu.threads" label="Threads" hint="auto أو رقم موجب" :validator="vThreads" :error="errors['engines.cpu.threads']"/>
            <FormNumber v-model.number="editable.engines.cpu.batchSize" label="Batch Size" :validator="vPositive" />
          </div>
        </section>

        <!-- Storage -->
        <section>
          <h3 class="font-semibold mb-2">التخزين - Storage</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormInput v-model="editable.storage.paths.solutions" label="Solutions Path" />
            <FormInput v-model="editable.storage.paths.state" label="State Path" />
            <FormInput v-model="editable.storage.paths.backup" label="Backup Path" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <FormSwitch v-model="editable.storage.backup.enabled" label="Auto Backup" />
            <FormNumber v-model.number="editable.storage.backup.interval" label="Interval (ms)" :validator="vPositive" />
            <FormNumber v-model.number="editable.storage.backup.retention.days" label="Retention Days" :validator="vPositive" />
          </div>
        </section>

        <!-- Logging -->
        <section>
          <h3 class="font-semibold mb-2">السجلات - Logging</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormSelect v-model="editable.logging.level" label="Level" :options="logLevels" />
            <FormInput v-model="editable.logging.file" label="File" />
            <FormInput v-model="editable.logging.maxSize" label="Max Size" hint="مثل 10m" />
            <FormNumber v-model.number="editable.logging.maxFiles" label="Max Files" :validator="vPositive" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <FormSwitch v-model="editable.logging.console" label="Console" />
            <FormSelect v-model="editable.logging.format" label="Format" :options="[{label:'json',value:'json'},{label:'text',value:'text'}]" />
            <FormSelect v-model="editable.logging.rotation.frequency" label="Rotation" :options="rotationOptions" />
          </div>
        </section>

        <!-- Security & Monitoring -->
        <section>
          <h3 class="font-semibold mb-2">الأمان والمراقبة</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormInput v-model="editable.security.apiKey" label="API Key" hint="يُستخدم للواجهات و WS" />
            <FormSwitch v-model="editable.monitoring.enabled" label="Monitoring" />
            <FormNumber v-model.number="editable.monitoring.interval" label="Interval (ms)" :validator="vPositive" />
            <FormNumber v-model.number="editable.security.rateLimit.maxRequests" label="Rate Limit (max)" :validator="vPositive" />
          </div>
        </section>

        <div v-if="hasErrors" class="text-red-600 text-sm">توجد حقول غير صحيحة. الرجاء تصحيحها قبل الحفظ.</div>
      </div>
    </div>
  </div>
</template>
<script setup lang="jsx">
import { ref, reactive, watch, computed, defineComponent } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { apiClient } from '../lib/api'

// Inline form controls
const FormInput = defineComponent({
  props: { modelValue: [String, Number], label: String, hint: String, error: String, validator: Function },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const onInput = (e) => emit('update:modelValue', e.target.value)
    return () => (
      <div>
        <label class="block text-xs text-gray-600 dark:text-gray-300 mb-1">{props.label}</label>
        <input class="w-full rounded border px-2 py-1 text-sm bg-white text-gray-900 border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700" value={props.modelValue ?? ''} onInput={onInput} />
        {props.hint ? <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{props.hint}</div> : null}
        {props.error ? <div class="text-[11px] text-red-600 dark:text-red-400 mt-1">{props.error}</div> : null}
      </div>
    )
  }
})

const FormNumber = defineComponent({
  props: { modelValue: [Number, String], label: String, hint: String, error: String, validator: Function },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const onInput = (e) => emit('update:modelValue', e.target.value === '' ? '' : Number(e.target.value))
    return () => (
      <div>
        <label class="block text-xs text-gray-600 dark:text-gray-300 mb-1">{props.label}</label>
        <input type="number" class="w-full rounded border px-2 py-1 text-sm bg-white text-gray-900 border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700" value={props.modelValue ?? ''} onInput={onInput} />
        {props.hint ? <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{props.hint}</div> : null}
        {props.error ? <div class="text-[11px] text-red-600 dark:text-red-400 mt-1">{props.error}</div> : null}
      </div>
    )
  }
})

const FormSelect = defineComponent({
  props: { modelValue: [String, Number], label: String, options: Array, error: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const onChange = (e) => emit('update:modelValue', e.target.value)
    return () => (
      <div>
        <label class="block text-xs text-gray-600 dark:text-gray-300 mb-1">{props.label}</label>
        <select class="w-full rounded border px-2 py-1 text-sm bg-white text-gray-900 border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700" value={props.modelValue ?? ''} onChange={onChange}>
          {(props.options || []).map(o => <option value={o.value}>{o.label}</option>)}
        </select>
        {props.error ? <div class="text-[11px] text-red-600 dark:text-red-400 mt-1">{props.error}</div> : null}
      </div>
    )
  }
})

const FormSwitch = defineComponent({
  props: { modelValue: Boolean, label: String, hint: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const onChange = (e) => emit('update:modelValue', e.target.checked)
    return () => (
      <label class="inline-flex items-center gap-2">
        <input type="checkbox" checked={!!props.modelValue} onChange={onChange} />
        <span class="text-sm">{props.label}</span>
        {props.hint ? <span class="text-[11px] text-gray-500">{props.hint}</span> : null}
      </label>
    )
  }
})

// Defaults aligned to new structure
const defaults = {
  system: { name: 'KBUC Mining System', environment: 'production', logLevel: 'info', debug: false, testMode: false },
  network: {
    api: { host: 'localhost', port: 8001, timeout: 30000, retryAttempts: 3, retryDelay: 5000 },
    rpc: { host: 'https://rpc.kbunet.net', port: 443, timeout: 30000, connectionPool: { maxConnections: 10, keepAlive: true } }
  },
  mining: {
    blockchain: { defaultTicketData: '', defaultRewardAddress: '', defaultDifficultyTarget: '', defaultMiningType: 1 },
    session: { maxTimeSeconds: 1800, timeout: 1200, testModeTimeout: 120, maxSolutionsPerSession: 10, continueAfterSolution: true },
    restart: { autoRestart: true, delaySeconds: 5, maxAttempts: 10, onSuccess: false, onFailure: false },
    solutions: { supportSubSolutions: true, broadcastAll: true },
    broadcast: { enabled: true, mode: 'immediate', batchSize: 5, batchTimeoutMs: 5000 }
  },
  engines: { gpu: { enabled: true, priority: 'high', batchSize: 100000, optimization: 'performance', fallbackBatchSize: 10000, blocks: 4096 }, cpu: { enabled: true, priority: 'medium', threads: 'auto', batchSize: 10000, optimization: 'performance' } },
  storage: { paths: { solutions: 'data/solutions', state: 'data/state', backup: 'data/backup', logs: 'logs' }, backup: { enabled: true, interval: 3600000, retention: { days: 30, maxFiles: 100 } } },
  logging: { level: 'info', file: 'logs/mining.log', maxSize: '10m', maxFiles: 5, console: true, format: 'json', rotation: { enabled: true, frequency: 'daily' } },
  monitoring: { enabled: true, interval: 5000, metrics: {}, alerts: {} },
  security: { apiKey: '', rateLimit: { enabled: true, maxRequests: 100, windowMs: 60000 }, cors: { enabled: true, origins: {} }, authentication: { enabled: false, apiKey: '' }, headers: { securityHeaders: true } },
}

function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return target
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      target[k] = deepMerge(target[k] || (Array.isArray(source[k]) ? [] : {}), source[k])
    } else {
      target[k] = source[k]
    }
  }
  return target
}

const api = apiClient()
const { data, isLoading, error } = useQuery({ queryKey: ['config'], queryFn: async () => (await api.get('/api/config')).data })
const editable = reactive(JSON.parse(JSON.stringify(defaults)))
const uploader = ref(null)

watch(data, () => {
  const incoming = JSON.parse(JSON.stringify(data.value || {}))
  // Prefer new structure; merge to defaults
  const merged = deepMerge(JSON.parse(JSON.stringify(defaults)), incoming)
  Object.keys(editable).forEach(k => { delete editable[k] })
  Object.assign(editable, merged)
  validateAll()
})

const qc = useQueryClient()
const mutation = useMutation({ mutationFn: async (body) => (await api.put('/api/config', body)).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }) })

function save() {
  validateAll()
  if (hasErrors.value) return
  // Strip legacy duplicated keys from payload if exist
  const payload = JSON.parse(JSON.stringify(editable))
  delete payload.api
  delete payload.data
  delete payload.support_hash_broadcast
  mutation.mutate(payload)
}

function reset() {
  if (!data.value) return
  const incoming = JSON.parse(JSON.stringify(data.value))
  const merged = deepMerge(JSON.parse(JSON.stringify(defaults)), incoming)
  Object.keys(editable).forEach(k => { delete editable[k] })
  Object.assign(editable, merged)
  validateAll()
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(editable, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mining-config.json'
  a.click()
  URL.revokeObjectURL(url)
}

function onUploadJson(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'))
      const merged = deepMerge(JSON.parse(JSON.stringify(defaults)), parsed)
      Object.keys(editable).forEach(k => { delete editable[k] })
      Object.assign(editable, merged)
      validateAll()
    } catch {}
  }
  reader.readAsText(file)
}

// Validation
const errors = reactive({})
const logLevels = [ 'debug','info','warn','error' ].map(x => ({ label: x, value: x }))
const priorities = [ 'low','medium','high' ].map(x => ({ label: x, value: x }))
const broadcastModes = [ 'immediate','batch' ].map(x => ({ label: x, value: x }))
const rotationOptions = [ 'daily','hourly','weekly' ].map(x => ({ label: x, value: x }))

const setErr = (k, m) => { if (m) errors[k] = m; else delete errors[k] }
const vRequired = (v) => (v === undefined || v === null || String(v).trim() === '') ? 'هذا الحقل مطلوب' : ''
const vPositive = (v) => (typeof v !== 'number' || v <= 0) ? 'يجب أن يكون رقماً موجباً' : ''
const vPositiveOrZero = (v) => (typeof v !== 'number' || v < 0) ? 'يجب أن يكون صفراً أو موجباً' : ''
const vPort = (v) => (typeof v !== 'number' || v < 1 || v > 65535) ? 'رقم منفذ صالح (1-65535)' : ''
const vHexLen = (len) => (v) => (!/^[0-9a-fA-F]+$/.test(String(v || '')) || String(v).length !== len) ? `Hex بطول ${len}` : ''
const vHex64 = vHexLen(64)
const vHex40 = vHexLen(40)
const vThreads = (v) => (v === 'auto' || (typeof v === 'number' && v > 0)) ? '' : 'auto أو رقم موجب'

function validateAll() {
  setErr('system.environment', vRequired(editable.system.environment))
  setErr('system.logLevel', logLevels.find(o => o.value === editable.system.logLevel) ? '' : 'قيمة غير صحيحة')
  setErr('network.api.host', vRequired(editable.network.api.host))
  setErr('network.api.port', vPort(editable.network.api.port))
  setErr('network.api.timeout', vPositive(editable.network.api.timeout))
  setErr('network.rpc.host', vRequired(editable.network.rpc.host))
  setErr('network.rpc.port', vPort(editable.network.rpc.port))
  setErr('mining.blockchain.defaultRewardAddress', vHex40(editable.mining.blockchain.defaultRewardAddress))
  setErr('mining.blockchain.defaultTicketData', vHex64(editable.mining.blockchain.defaultTicketData))
  setErr('mining.blockchain.defaultDifficultyTarget', vHex64(editable.mining.blockchain.defaultDifficultyTarget))
  setErr('engines.cpu.threads', vThreads(editable.engines.cpu.threads))
}

watch(editable, validateAll, { deep: true })
const hasErrors = computed(() => Object.keys(errors).length > 0)
</script>
