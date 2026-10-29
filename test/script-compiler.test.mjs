import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compilePageScript } from '../src/script-compiler.mjs'

test('compiles TypeScript setup into a native page script and manifest data', async () => {
  const result = await compilePageScript(`<script setup lang="ts">
const count = ref<number>(0)
async function increment(): Promise<void> { count.value++ }
</script>`, { filename: 'counter.vue' })

  assert.equal(result.language, 'ts')
  assert.deepEqual(result.actions, ['increment'])
  assert.deepEqual(result.stateRefs, ['count'])
  assert.match(result.code, /function increment\(/)
  assert.doesNotMatch(result.code, /ref<number>/)
  assert.match(result.code, /function useRoute\(/)
  assert.match(result.code, /function useRouter\(/)
})

test('compiles JavaScript setup without requiring a template runtime', async () => {
  const result = await compilePageScript(`<script setup>
const ready = ref(false)
function start() { ready.value = true }
</script>`)

  assert.equal(result.language, 'js')
  assert.deepEqual(result.actions, ['start'])
  assert.match(result.code, /__nuxtSnapshot/)
  assert.match(result.code, /function navigateTo\(/)
  assert.match(result.code, /function useRuntimeConfig\(/)
  assert.match(result.code, /function useAppConfig\(/)
  assert.match(result.code, /function useNuxtApp\(/)
  assert.match(result.code, /function useNativeCapability\(/)
  assert.match(result.code, /function definePageMeta\(/)
  assert.match(result.code, /function onMounted\(/)
  assert.match(result.code, /function onUnmounted\(/)
  assert.match(result.code, /function onBeforeRouteLeave\(/)
  assert.match(result.code, /function onBeforeRouteUpdate\(/)
  assert.match(result.code, /function onErrorCaptured\(/)
  assert.match(result.code, /function computed\(/)
  assert.match(result.code, /function watch\(/)
  assert.match(result.code, /function useNativeDevice\(/)
  assert.match(result.code, /function useNativeStorage\(/)
  assert.match(result.code, /function nextTick\(/)
  assert.match(result.code, /function toRef\(/)
})

test('provides common Vue ref helpers in the native runtime', async () => {
  const result = await compilePageScript(`<script setup>
const count = shallowRef(1)
const state = reactive({ count: 2 })
const countRef = toRef(state, 'count')
const values = toRefs(state)
isRef(countRef)
unref(countRef)
readonly(state)
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ count: count.value, ref: isRef(countRef), unwrapped: unref(countRef), refs: values.count.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 1, ref: true, unwrapped: 2, refs: 2 })
})

test('accepts Vue-style ref values inside helpers', async () => {
  const result = await compilePageScript(`<script setup>
function createValue() { return ref(5) }
const nested = createValue()
const output = ref({ value: nested.value })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { value: 5 })
})

test('discovers arrow-function actions for native event dispatch', async () => {
  const result = await compilePageScript(`<script setup>
const handleGesture = (event) => event && event.type
const handleAsync = async (event) => event
</script>`)
  assert.deepEqual(result.actions, ['handleGesture', 'handleAsync'])
})

test('provides reusable native gesture handlers', async () => {
  const result = await compilePageScript(`<script setup>
const onGesture = useNativeGesture({ left: (event) => event.type })
</script>`)
  assert.ok(result.actions.includes('onGesture'))
  assert.match(result.code, /function useNativeGesture\(/)
})

test('exposes capability-gated native device and storage composables', async () => {
  const result = await compilePageScript(`<script setup>
const device = useNativeDevice()
const storage = useNativeStorage()
</script>`)
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['device', 'storage']) } },
    __nuxtNativeDevice: { current() { return JSON.stringify({ model: 'Test handset', sdkInt: 35 }) } },
    __nuxtNativeStorage: {
      values: { theme: JSON.stringify('dark') },
      get(key) { return this.values[key] || null },
      set(key, value) { this.values[key] = value },
      remove(key) { delete this.values[key] }
    },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ device: device, theme: storage.get('theme') })`, context)
  assert.deepEqual(JSON.parse(context.result), { device: { model: 'Test handset', sdkInt: 35 }, theme: 'dark' })
  vm.runInNewContext(`storage.set('count', 3); result = storage.get('count'); storage.remove('count'); removed = storage.get('count')`, context)
  assert.equal(context.result, 3)
  assert.equal(context.removed, null)
})

test('exposes a capability-gated native clipboard composable', async () => {
  const result = await compilePageScript(`<script setup>
const clipboard = useNativeClipboard()
const available = ref(clipboard.available)
const current = ref(clipboard.readText('empty'))
const written = ref(clipboard.writeText('copied'))
</script>`)
  const writes = []
  const context = {
    __nuxtStateChanged: { changed() {} },
    __nuxtCapabilities: { current() { return JSON.stringify(['clipboard']) } },
    __nuxtNativeClipboard: { readText() { return 'from clipboard' }, writeText(value) { writes.push(value); return true } }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { clipboard: { available: true }, available: true, current: 'from clipboard', written: true })
  assert.deepEqual(writes, ['copied'])
})

test('resolves native permission requests through the generated promise bridge', async () => {
  const result = await compilePageScript(`<script setup>
const permissions = useNativePermissions()
</script>`)
  const requests = []
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['permissions']) } },
    __nuxtNativePermissions: {
      has() { return false },
      request(permission) { requests.push(permission); return 91 }
    },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = permissions.request('android.permission.CAMERA').then(value => { resolved = value })`, context)
  assert.deepEqual(requests, ['android.permission.CAMERA'])
  assert.equal(context.resolved, undefined)
  vm.runInNewContext(`__nuxtResolvePermission(91, true)`, context)
  assert.equal(context.resolved, true)
})

test('exposes a capability-gated app-private filesystem composable', async () => {
  const result = await compilePageScript(`<script setup>
const files = useNativeFileSystem()
</script>`)
  const values = { 'notes.txt': 'hello' }
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['filesystem']) } },
    __nuxtNativeFileSystem: {
      readText(path) { return values[path] ?? null },
      writeText(path, value) { values[path] = value },
      exists(path) { return Object.hasOwn(values, path) },
      remove(path) { delete values[path] },
      list() { return JSON.stringify(Object.keys(values)) }
    },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ text: files.readText('notes.txt'), entries: files.list('') })`, context)
  assert.deepEqual(JSON.parse(context.result), { text: 'hello', entries: ['notes.txt'] })
  vm.runInNewContext(`files.writeText('draft.txt', 'draft'); result = files.exists('draft.txt'); files.remove('draft.txt'); removed = files.exists('draft.txt')`, context)
  assert.equal(context.result, true)
  assert.equal(context.removed, false)
})

test('exposes capability-gated native notifications', async () => {
  const result = await compilePageScript(`<script setup>
const notifications = useNativeNotifications()
</script>`)
  const calls = []
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['notifications']) } },
    __nuxtNativeNotifications: {
      show(title, body, channel) { calls.push({ title, body, channel }); return true }
    },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = notifications.show('Ready', 'Native notification', 'updates')`, context)
  assert.equal(context.result, true)
  assert.deepEqual(calls, [{ title: 'Ready', body: 'Native notification', channel: 'updates' }])
})

test('bridges native dialog confirmation through the generated promise runtime', async () => {
  const result = await compilePageScript(`<script setup>
const dialog = useNativeDialog()
</script>`)
  const calls = []
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['dialog']) } },
    __nuxtNativeDialog: {
      show(title, message, positive, negative) {
        calls.push({ title, message, positive, negative })
        return 125
      }
    },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = dialog.show({ title: 'Native', message: 'Confirm?', confirmText: 'Yes', cancelText: 'No' }).then(value => { confirmed = value })`, context)
  assert.deepEqual(calls, [{ title: 'Native', message: 'Confirm?', positive: 'Yes', negative: 'No' }])
  assert.equal(context.confirmed, undefined)
  vm.runInNewContext(`__nuxtResolveDialog(125, true); __nuxtFlushJobs()`, context)
  assert.equal(context.confirmed, true)
})

test('bridges native media picker results into the generated promise runtime', async () => {
  const result = await compilePageScript(`<script setup>
const media = useNativeMedia()
</script>`)
  const requests = []
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['media']) } },
    __nuxtNativeMedia: { pick(type) { requests.push(type); return 123 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = media.pickImage().then(value => { selected = value })`, context)
  assert.deepEqual(requests, ['image/*'])
  assert.equal(context.selected, undefined)
  vm.runInNewContext(`__nuxtResolveMedia(123, 'content://picker/photo')`, context)
  assert.equal(context.selected, 'content://picker/photo')
})

test('bridges native camera capture results through the same media promise channel', async () => {
  const result = await compilePageScript(`<script setup>
const media = useNativeMedia()
</script>`)
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['media']) } },
    __nuxtNativeMedia: { capture() { return 124 }, pick() { return -1 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = media.capturePhoto().then(value => { captured = value })`, context)
  vm.runInNewContext(`__nuxtResolveMedia(124, 'content://media/captured-photo')`, context)
  assert.equal(context.captured, 'content://media/captured-photo')
})

test('delivers native app lifecycle changes to registered listeners', async () => {
  const result = await compilePageScript(`<script setup>
const lifecycle = useNativeAppLifecycle()
events = []
lifecycle.onChange(value => events.push(value))
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunAppState('background'); state = lifecycle.state.value`, context)
  assert.equal(JSON.stringify(context.events), '["background"]')
  assert.equal(context.state, 'background')
})

test('subscribes to and stops capability-gated native sensor streams', async () => {
  const result = await compilePageScript(`<script setup>
const sensors = useNativeSensors()
samples = []
sensorId = sensors.start('accelerometer', sample => samples.push(sample))
</script>`)
  const calls = []
  const context = {
    __nuxtCapabilities: { current() { return JSON.stringify(['sensors']) } },
    __nuxtNativeSensors: {
      start(type) { calls.push(['start', type]); return 30001 },
      stop(id) { calls.push(['stop', id]) }
    },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\n__nuxtResolveSensor(30001, JSON.stringify({ x: 1, y: 2, z: 3 })); sensors.stop(sensorId)`, context)
  assert.deepEqual(calls, [['start', 'accelerometer'], ['stop', 30001]])
  assert.equal(JSON.stringify(context.samples), '[{"x":1,"y":2,"z":3}]')
})

test('provides Nuxt data composable shims and tracks destructured state', async () => {
  const result = await compilePageScript(`<script setup>
const { data, pending, error } = useAsyncData('demo', () => ({ ok: true }))
</script>`)

  assert.deepEqual(result.stateRefs, ['data', 'pending', 'error'])
  assert.match(result.code, /function useAsyncData\(/)
  assert.match(result.code, /function useFetch\(/)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { data: { ok: true }, pending: false, error: null })
})

test('deduplicates keyed useAsyncData state within a route runtime', async () => {
  const result = await compilePageScript(`<script setup>
let calls = 0
const first = useAsyncData('shared', () => { calls++; return { value: 1 } })
const second = useAsyncData('shared', () => { calls++; return { value: 2 } })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ first: first.data.value, second: second.data.value, calls })`, context)
  assert.deepEqual(JSON.parse(context.result), {
    first: { value: 1 },
    second: { value: 1 },
    calls: 1
  })
})

test('refreshes and clears keyed async data through Nuxt cache helpers', async () => {
  const result = await compilePageScript(`<script setup>
let calls = 0
const data = useAsyncData('refreshable', () => ({ value: ++calls }))
refreshNuxtData('refreshable')
clearNuxtData('refreshable')
const recreated = useAsyncData('refreshable', () => ({ value: ++calls }))
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ calls, original: data.data.value, recreated: recreated.data.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { calls: 3, original: { value: 2 }, recreated: { value: 3 } })
})

test('defers lazy async data until an explicit refresh', async () => {
  const result = await compilePageScript(`<script setup>
let calls = 0
const data = useLazyAsyncData('lazy', () => ({ value: ++calls }))
const fetchData = useLazyFetch('/api/lazy')
</script>`)
  const requests = []
  const context = {
    requests,
    __nuxtFetchAsync: { fetch(path) { requests.push(path); return 88 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ calls, pending: data.pending.value, requests })`, context)
  assert.deepEqual(JSON.parse(context.result), { calls: 0, pending: true, requests: [] })
  vm.runInNewContext(`data.refresh(); result = JSON.stringify({ calls, value: data.data.value, requests })`, context)
  assert.deepEqual(JSON.parse(context.result), { calls: 1, value: { value: 1 }, requests: [] })
})

test('does not mutate fetch options when creating lazy fetch data', async () => {
  const result = await compilePageScript(`<script setup>
const options = { default: () => ({ ready: false }) }
const lazy = useLazyFetch('/api/lazy', options)
const regular = useFetch('/api/regular', options)
</script>`)
  const calls = []
  const context = {
    __nuxtFetchAsync: { fetch(path) { calls.push(path); return calls.length } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ options, lazyPending: lazy.pending.value, regularPending: regular.pending.value })`, context)
  assert.deepEqual(JSON.parse(context.result), {
    options: {},
    lazyPending: true,
    regularPending: true
  })
  assert.deepEqual(calls, ['/api/regular'])
})

test('refreshes async data when watched refs change', async () => {
  const result = await compilePageScript(`<script setup>
const version = ref(0)
let calls = 0
const record = useAsyncData('watched', () => ({ version: version.value, calls: ++calls }), { watch: [version] })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ value: record.data.value, calls })`, context)
  assert.deepEqual(JSON.parse(context.result), { value: { version: 0, calls: 1 }, calls: 1 })
  vm.runInNewContext(`version.value = 1; result = JSON.stringify({ value: record.data.value, calls })`, context)
  assert.deepEqual(JSON.parse(context.result), { value: { version: 1, calls: 2 }, calls: 2 })
})

test('reruns watchEffect for tracked refs and supports cleanup', async () => {
  const result = await compilePageScript(`<script setup>
const count = ref(0)
const seen = ref('')
const stop = watchEffect(() => { seen.value = String(count.value) })
count.value = 1
stop()
count.value = 2
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ count: count.value, seen: seen.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 2, seen: '1' })
})

test('runs watchEffect cleanup before reruns and when stopped', async () => {
  const result = await compilePageScript(`<script setup>
const count = ref(0)
let cleanups = 0
const stop = watchEffect((onCleanup) => { count.value; onCleanup(() => { cleanups++ }) })
count.value = 1
stop()
const output = ref({ cleanups })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { cleanups: 2 })
})

test('reruns watchEffect for reactive object properties and supports cleanup', async () => {
  const result = await compilePageScript(`<script setup>
const state = reactive({ count: 0 })
const seen = ref('')
const stop = watchEffect(() => { seen.value = String(state.count) })
state.count = 1
stop()
state.count = 2
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ count: state.count, seen: seen.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 2, seen: '1' })
})

test('tracks nested deep reactive properties while preserving shallowReactive behavior', async () => {
  const result = await compilePageScript(`<script setup>
const deep = reactive({ user: { name: 'Ada' } })
const shallow = shallowReactive({ user: { name: 'Grace' } })
const seen = ref('')
const shallowSeen = ref('')
const stopDeep = watchEffect(() => { seen.value = deep.user.name })
const stopShallow = watchEffect(() => { shallowSeen.value = shallow.user.name })
deep.user.name = 'Lin'
shallow.user.name = 'Eve'
stopDeep()
stopShallow()
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ seen: seen.value, shallowSeen: shallowSeen.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { seen: 'Lin', shallowSeen: 'Grace' })
})

test('keeps readonly proxies deep, stable, and non-mutating', async () => {
  const result = await compilePageScript(`<script setup>
const source = { user: { name: 'Ada' } }
const view = readonly(source)
const nested = view.user
view.user.name = 'Lin'
delete view.user.name
const output = ref({ name: source.user.name, stable: nested === view.user, nestedName: view.user.name })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { name: 'Ada', stable: true, nestedName: 'Ada' })
})

test('supports immediate and array sources in watch', async () => {
  const result = await compilePageScript(`<script setup>
const first = ref(0)
const second = ref(0)
const events = ref([])
const stop = watch([first, second], (value, previous) => { events.value = events.value.concat([{ value, previous }]) }, { immediate: true })
first.value = 1
second.value = 2
stop()
first.value = 3
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(events.value)`, context)
  assert.deepEqual(JSON.parse(context.result), [
    { value: [0, 0] },
    { value: [1, 0], previous: [0, 0] },
    { value: [1, 2], previous: [1, 0] }
  ])
})

test('runs watch cleanup before the next callback and when stopped', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(0)
let cleanups = 0
const stop = watch(source, (value, previous, onCleanup) => { onCleanup(() => { cleanups++ }) }, { immediate: true })
source.value = 1
stop()
const output = ref({ cleanups })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { cleanups: 2 })
})

test('supports onWatcherCleanup inside watcher callbacks', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(0)
let cleanups = 0
watch(source, () => { onWatcherCleanup(() => { cleanups++ }) })
source.value = 1
source.value = 2
const output = ref({ cleanups })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { cleanups: 1 })
})

test('supports onWatcherCleanup inside watchEffect callbacks', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(0)
let cleanups = 0
watchEffect(() => { source.value; onWatcherCleanup(() => { cleanups++ }) })
source.value = 1
const output = ref({ cleanups })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { cleanups: 1 })
})

test('watches nested reactive object mutations by default', async () => {
  const result = await compilePageScript(`<script setup>
const state = reactive({ profile: { name: 'Ada' } })
let calls = 0
watch(state, () => { calls++ })
state.profile.name = 'Lin'
const output = ref({ calls })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { calls: 1 })
})

test('detects nested changes inside mixed watch source arrays', async () => {
  const result = await compilePageScript(`<script setup>
const state = reactive({ count: 0 })
const version = ref(0)
let calls = 0
watch([state, version], () => { calls++ })
state.count = 1
version.value = 1
const output = ref({ calls })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { calls: 2 })
})

test('supports writable computed refs and identifies computed values as refs', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(1)
const doubled = computed({ get: () => source.value * 2, set: value => { source.value = value / 2 } })
doubled.value = 8
const resultValue = ref({ value: doubled.value, isRef: isRef(doubled), unref: unref(doubled) })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(resultValue.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { value: 8, isRef: true, unref: 8 })
})

test('caches computed values until a dependency changes', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(1)
let reads = 0
const doubled = computed(() => { reads++; return source.value * 2 })
const first = doubled.value
const second = doubled.value
source.value = 3
const third = doubled.value
const output = ref({ first, second, third, reads })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { first: 2, second: 2, third: 6, reads: 2 })
})

test('provides and injects route-scoped values with defaults', async () => {
  const result = await compilePageScript(`<script setup>
const shared = ref('native')
provide('theme', shared)
const injected = inject('theme')
const fallback = inject('missing', () => 'fallback')
const output = ref({ value: injected.value, fallback })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { value: 'native', fallback: 'fallback' })
})

test('ignores stale async-data responses after a newer refresh', async () => {
  const result = await compilePageScript(`<script setup>
const record = useFetch('/api/race')
</script>`)
  const calls = []
  const context = {
    __nuxtFetchAsync: { fetch() { const id = calls.length + 1; calls.push(id); return id } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nrecord.refresh(); result = JSON.stringify({ pending: record.pending.value, data: record.data.value })`, context)
  assert.deepEqual(calls, [1, 2])
  assert.deepEqual(JSON.parse(context.result), { pending: true, data: null })
  vm.runInNewContext(`__nuxtResolveAsync(1, JSON.stringify({ value: 'old' }), ''); result = JSON.stringify({ pending: record.pending.value, data: record.data.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { pending: true, data: null })
  vm.runInNewContext(`__nuxtResolveAsync(2, JSON.stringify({ value: 'new' }), ''); result = JSON.stringify({ pending: record.pending.value, data: record.data.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { pending: false, data: { value: 'new' } })
})

test('applies async-data defaults, transforms, and picks', async () => {
  const result = await compilePageScript(`<script setup>
const shaped = useAsyncData('shaped', () => ({ first: 1, second: 2 }), {
  default: () => ({ loading: true }),
  transform: value => ({ first: value.first + 1, second: value.second }),
  pick: ['first']
})
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ data: shaped.data.value, pending: shaped.pending.value, error: shaped.error.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { data: { first: 2 }, pending: false, error: null })
})

test('snapshots non-ref setup bindings for native template expressions', async () => {
  const result = await compilePageScript(`<script setup>
const device = useNativeDevice()
const storage = useNativeStorage()
</script>`)
  const context = {
    __nuxtStateChanged: { changed() {} },
    __nuxtCapabilities: { current() { return JSON.stringify(['device', 'storage']) } },
    __nuxtNativeDevice: { current() { return JSON.stringify({ model: 'Pixel', sdkInt: 36 }) } },
    __nuxtNativeStorage: { get() { return null }, set() {}, remove() {} },
    __nuxtPlugins: { current() { return '{}' } },
    __nuxtRuntimeConfig: { current() { return '{}' } },
    __nuxtRoute: { current() { return '{}' } },
    __nuxtFetchAsync: { fetch() { return 1 } }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    device: { model: 'Pixel', sdkInt: 36 },
    storage: { available: true }
  })
})

test('exposes static app configuration separately from public runtime config', async () => {
  const result = await compilePageScript(`<script setup>
const appConfig = useAppConfig()
const runtimeConfig = useRuntimeConfig()
</script>`)
  const context = {
    __nuxtStateChanged: { changed() {} },
    __nuxtRuntimeConfig: { current() { return JSON.stringify({ appConfig: { brand: 'Native', featureFlags: { lab: true } }, public: { apiBase: '/api' } }) } }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    appConfig: { brand: 'Native', featureFlags: { lab: true } },
    runtimeConfig: { appConfig: { brand: 'Native', featureFlags: { lab: true } }, public: { apiBase: '/api' } }
  })
})

test('bridges Nuxt error state into the native route error surface', async () => {
  const result = await compilePageScript(`<script setup>
const error = useError()
const shown = showError({ statusCode: 404, statusMessage: 'Missing profile', data: { id: 7 } })
</script>`)
  const events = []
  const context = { __nuxtStateChanged: { changed(name, value) { events.push([name, value]) } } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ error: error.value, shown })`, context)
  const value = JSON.parse(context.result)
  assert.deepEqual(value.error, { statusCode: 404, statusMessage: 'Missing profile', message: 'Missing profile', data: { id: 7 } })
  assert.deepEqual(value.shown, value.error)
  assert.equal(events.at(-1)[0], '__nuxtShowError')
  vm.runInNewContext(`clearError(); cleared = error.value`, context)
  assert.equal(context.cleared, null)
  assert.equal(events.at(-1)[0], '__nuxtClearError')
})

test('provides keyed Nuxt state with native snapshot tracking', async () => {
  const result = await compilePageScript(`<script setup>
const count = useState('counter', () => 1)
count.value = count.value + 1
</script>`)
  assert.deepEqual(result.stateRefs, ['count'])
  const changes = []
  const context = { __nuxtStateChanged: { changed(name, value) { changes.push([name, value]) } } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 2 })
  assert.deepEqual(changes, [['counter', '2']])
})

test('keeps useRoute identity stable while reading current route fields', async () => {
  const result = await compilePageScript(`<script setup>
const first = useRoute()
const same = useRoute()
const before = first.path
const output = ref({ before, after: '', same: first === same })
</script>`)
  const context = {
    currentRoute: JSON.stringify({ path: '/', fullPath: '/', params: {}, query: {}, hash: '' }),
    __nuxtRoute: { current() { return context.currentRoute } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(output.value)`, context)
  assert.deepEqual(JSON.parse(context.result), { before: '/', after: '', same: true })
  context.currentRoute = JSON.stringify({ path: '/settings', fullPath: '/settings?compact=true', params: {}, query: { compact: 'true' }, hash: '' })
  vm.runInNewContext(`result = JSON.stringify({ before: first.path, after: first.fullPath, same: first === same })`, context)
  assert.deepEqual(JSON.parse(context.result), { before: '/settings', after: '/settings?compact=true', same: true })
})

test('restores keyed Nuxt state from native storage across route runtimes', async () => {
  const result = await compilePageScript(`<script setup>
const count = useState('persistent-counter', () => 1)
count.value = 7
</script>`)
  const restored = await compilePageScript(`<script setup>
const count = useState('persistent-counter', () => 99)
</script>`)
  const values = {}
  const createContext = () => ({
    values,
    __nuxtCapabilities: { current() { return JSON.stringify(['storage']) } },
    __nuxtNativeStorage: {
      get(key) { return values[key] || null },
      set(key, value) { values[key] = value },
      remove(key) { delete values[key] }
    },
    __nuxtStateChanged: { changed() {} }
  })
  const firstContext = createContext()
  const secondContext = createContext()
  vm.runInNewContext(`${result.code}\nresult = count.value`, firstContext)
  assert.equal(firstContext.result, 7)
  vm.runInNewContext(`${restored.code}\nresult = count.value`, secondContext)
  assert.equal(secondContext.result, 7)
})

test('provides a persistent Nuxt cookie ref over native storage', async () => {
  const result = await compilePageScript(`<script setup>
const session = useCookie('session', { default: () => ({ user: 'Ada' }) })
session.value = { user: 'Grace' }
</script>`)
  const values = {}
  const context = {
    values,
    __nuxtCapabilities: { current() { return JSON.stringify(['storage']) } },
    __nuxtNativeStorage: {
      get(key) { return values[key] || null },
      set(key, value) { values[key] = value },
      remove(key) { delete values[key] }
    },
    __nuxtStateChanged: { changed() {} }
  }
  assert.match(result.code, /function useCookie\(/)
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ value: session.value, stored: values.session })`, context)
  assert.deepEqual(JSON.parse(context.result), { value: { user: 'Grace' }, stored: '{"user":"Grace"}' })
  vm.runInNewContext(`session.value = null; removed = values.session === undefined`, context)
  assert.equal(context.removed, true)
})

test('bridges useHead and useSeoMeta metadata through the native state channel', async () => {
  const result = await compilePageScript(`<script setup>
useHead({ title: 'Native home', meta: [{ name: 'description', content: 'Native app' }] })
useSeoMeta({ title: 'SEO title' })
</script>`)
  const heads = []
  const context = { __nuxtStateChanged: { changed(name, value) { if (name === '__nuxtHead') heads.push(JSON.parse(value)) } } }
  vm.runInNewContext(result.code, context)
  assert.deepEqual(heads, [
    { title: 'Native home', meta: [{ name: 'description', content: 'Native app' }] },
    { title: 'SEO title' }
  ])
})

test('provides a native async bridge for useFetch', async () => {
  const result = await compilePageScript(`<script setup>
const { data, pending, error } = useFetch('/api/profile')
</script>`)
  const calls = []
  const context = {
    __nuxtFetchAsync: { fetch(path, method, body) { calls.push({ path, method, body }); return 42 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(calls, [{ path: '/api/profile', method: 'GET', body: 'null' }])
  assert.deepEqual(JSON.parse(context.result), { data: null, pending: true, error: null })
  vm.runInNewContext(`__nuxtResolveAsync(42, JSON.stringify({ ok: true }), ''); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { data: { ok: true }, pending: false, error: null })
})

test('passes fetch request headers through the native async bridge', async () => {
  const result = await compilePageScript(`<script setup>
const request = $fetch('/api/profile', { method: 'POST', body: { ok: true }, headers: { 'x-token': 'abc', accept: 'application/json' } })
</script>`)
  const calls = []
  const context = {
    __nuxtFetchAsync: { fetch(path, method, body, headers) { calls.push({ path, method, body, headers }); return 43 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(result.code, context)
  assert.deepEqual(calls, [{
    path: '/api/profile',
    method: 'POST',
    body: '{"ok":true}',
    headers: '{"x-token":"abc","accept":"application/json"}'
  }])
})

test('serializes fetch query and params options into the native request URL', async () => {
  const result = await compilePageScript(`<script setup>
const request = $fetch('/api/profile?source=app#result', { query: { q: 'Ada Lovelace', tag: ['native', 'nuxt'], empty: null } })
</script>`)
  const calls = []
  const context = {
    __nuxtFetchAsync: { fetch(path, method, body, headers) { calls.push({ path, method, body, headers }); return 44 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(result.code, context)
  assert.deepEqual(calls, [{
    path: '/api/profile?source=app&q=Ada%20Lovelace&tag=native&tag=nuxt&empty#result',
    method: 'GET',
    body: 'null',
    headers: '{}'
  }])
})

test('exposes raw native fetch response metadata without changing body fetches', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>')
  const context = {
    __nuxtFetchAsync: { fetch() { return 55 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nvar raw; $fetch.raw('/api/profile').then(value => { raw = value });`, context)
  vm.runInNewContext(`__nuxtResolveAsync(55, JSON.stringify({ __nuxtNativeResponse: true, body: { ok: true }, status: 201, statusMessage: 'Created', headers: { 'x-native': 'yes' } }), ''); result = JSON.stringify(raw)`, context)
  assert.deepEqual(JSON.parse(context.result), { body: { ok: true }, status: 201, statusMessage: 'Created', headers: { 'x-native': 'yes' } })
})

test('creates configured fetch clients with base URL and merged headers', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>')
  const context = {
    request: null,
    __nuxtFetchAsync: { fetch(path, method, body, headers) { context.request = { path, method, body, headers }; return 1 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nvar client = $fetch.create({ baseURL: 'https://api.test', headers: { 'x-base': 'yes' } }); client('/users', { headers: { 'x-request': 'yes' } });`, context)
  assert.deepEqual(context.request, {
    path: 'https://api.test/users',
    method: 'GET',
    body: 'null',
    headers: '{"x-base":"yes","x-request":"yes"}'
  })
})

test('preserves native fetch error metadata when a server response fails', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>')
  const context = {
    __nuxtFetchAsync: { fetch() { return 56 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nvar failure; $fetch('/api/profile').catch(error => { failure = { message: error.message, status: error.status, statusMessage: error.statusMessage, data: error.data, headers: error.headers } });`, context)
  vm.runInNewContext(`__nuxtResolveAsync(56, JSON.stringify({ __nuxtNativeError: true, body: { message: 'Unauthorized', statusMessage: 'Unauthorized', data: { reason: 'token' } }, status: 401, headers: { 'www-authenticate': 'Bearer' } }), ''); result = JSON.stringify(failure)`, context)
  assert.deepEqual(JSON.parse(context.result), {
    message: 'Unauthorized',
    status: 401,
    statusMessage: 'Unauthorized',
    data: { reason: 'token' },
    headers: { 'www-authenticate': 'Bearer' }
  })
})

test('preserves structured native error metadata in useFetch records', async () => {
  const result = await compilePageScript(`<script setup>
const { data, pending, error } = useFetch('/api/profile')
</script>`)
  const context = {
    __nuxtFetchAsync: { fetch() { return 57 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { data: null, pending: true, error: null })
  vm.runInNewContext(`__nuxtResolveAsync(57, JSON.stringify({ __nuxtNativeError: true, body: { message: 'Unauthorized', statusMessage: 'Unauthorized', data: { reason: 'token' } }, status: 401, headers: { 'www-authenticate': 'Bearer' } }), ''); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    data: null,
    pending: false,
    error: {
      message: 'Unauthorized',
      status: 401,
      statusMessage: 'Unauthorized',
      data: { reason: 'token' },
      headers: { 'www-authenticate': 'Bearer' }
    }
  })
})

test('resumes async functions when a native fetch promise resolves', async () => {
  const result = await compilePageScript(`<script setup>
const loaded = ref(false)
async function load() {
  const response = await $fetch('/api/profile')
  loaded.value = response.ready
}
</script>`)
  assert.deepEqual(result.stateRefs, ['loaded'])
  const context = {
    __nuxtFetchAsync: { fetch() { return 7 } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nload(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { loaded: false })
  vm.runInNewContext(`__nuxtResolveAsync(7, JSON.stringify({ ready: true }), ''); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { loaded: true })
})

test('registers lifecycle callbacks for the native route host', async () => {
  const result = await compilePageScript(`<script setup>
const mounted = ref(false)
onMounted(() => { mounted.value = true })
onUnmounted(() => { mounted.value = false })
</script>`)
  const mountedContext = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); result = __nuxtSnapshot()`, mountedContext)
  assert.deepEqual(JSON.parse(mountedContext.result), { mounted: true })
  const unmountedContext = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); __nuxtRunUnmounted(); result = __nuxtSnapshot()`, unmountedContext)
  assert.deepEqual(JSON.parse(unmountedContext.result), { mounted: false })
})

test('runs before-mount and before-unmount callbacks in lifecycle order', async () => {
  const result = await compilePageScript(`<script setup>
const events = ref([])
onBeforeMount(() => { events.value = events.value.concat('before-mount') })
onMounted(() => { events.value = events.value.concat('mounted') })
onBeforeUnmount(() => { events.value = events.value.concat('before-unmount') })
onUnmounted(() => { events.value = events.value.concat('unmounted') })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); __nuxtRunUnmounted(); result = JSON.stringify(events.value)`, context)
  assert.deepEqual(JSON.parse(context.result), ['before-mount', 'mounted', 'before-unmount', 'unmounted'])
})

test('runs page route guards before native navigation', async () => {
  const result = await compilePageScript(`<script setup>
onBeforeRouteLeave((to) => to.path === '/blocked' ? false : undefined)
onBeforeRouteUpdate((to) => to.path === '/login' ? navigateTo('/signin') : undefined)
</script>`)
  const calls = []
  const context = { __nuxtNavigate: { call(path) { calls.push(path) } }, __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nleave = __nuxtRunRouteGuards('leave', JSON.stringify({ path: '/blocked' }), JSON.stringify({ path: '/' })); update = __nuxtRunRouteGuards('update', JSON.stringify({ path: '/login' }), JSON.stringify({ path: '/users' }))`, context)
  assert.equal(context.leave, '__nuxt_abort__')
  assert.equal(context.update, '__nuxt_redirect__:/signin')
  assert.deepEqual(calls, [])
})

test('resumes asynchronous page route guards through the native continuation bridge', async () => {
  const result = await compilePageScript(`<script setup>
let release
onBeforeRouteLeave(() => new Promise(resolve => { release = resolve }))
</script>`)
  const outcomes = []
  const context = { __nuxtStateChanged: { changed() {} }, __nuxtRouteGuardComplete: { complete(value) { outcomes.push(value) } } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); __nuxtRunRouteGuardsAsync('leave', JSON.stringify({ path: '/next' }), JSON.stringify({ path: '/' })); __nuxtFlushJobs(); globalThis.releaseGuard = release`, context)
  assert.deepEqual(outcomes, [])
  context.releaseGuard(false)
  vm.runInNewContext(`__nuxtFlushJobs()`, context)
  assert.deepEqual(outcomes, ['__nuxt_abort__'])
})

test('exposes Nuxt router history traversal', async () => {
  const result = await compilePageScript(`<script setup>const router = useRouter()</script>`)
  const calls = []
  const context = {
    __nuxtNavigate: { call() {} },
    __nuxtReplace: { call() {} },
    __nuxtGo: { call(delta) { calls.push(delta) } },
    __nuxtBack: { call() { calls.push('back') } },
    __nuxtForward: { call() { calls.push('forward') } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nrouter.go(-2); router.go(3)`, context)
  assert.deepEqual(calls, [-2, 3])
})

test('normalizes object route locations for Nuxt navigation helpers', async () => {
  const result = await compilePageScript(`<script setup>const router = useRouter()</script>`)
  const calls = []
  const context = {
    __nuxtNavigate: { call(path) { calls.push(['push', path]) } },
    __nuxtReplace: { call(path) { calls.push(['replace', path]) } },
    __nuxtGo: { call() {} },
    __nuxtBack: { call() {} },
    __nuxtForward: { call() {} },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nnavigateTo({ path: '/users', query: { q: 'Ada Lovelace', tag: ['native', 'nuxt'] }, hash: 'details' }); router.replace({ path: '/settings', query: { compact: true } })`, context)
  assert.deepEqual(calls, [
    ['push', '/users?q=Ada%20Lovelace&tag=native&tag=nuxt#details'],
    ['replace', '/settings?compact=true']
  ])
})

test('resolves named route locations with params, query, and hash', async () => {
  const result = await compilePageScript(`<script setup>const router = useRouter()</script>`)
  const calls = []
  const context = {
    __nuxtRouteNames: { names() { return JSON.stringify({ profile: '/users/:id', docs: '/docs/*path' }) } },
    __nuxtNavigate: { call(path) { calls.push(path) } },
    __nuxtReplace: { call() {} },
    __nuxtGo: { call() {} },
    __nuxtBack: { call() {} },
    __nuxtForward: { call() {} },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nrouter.push({ name: 'profile', params: { id: 'Ada Lovelace' }, query: { tab: 'bio' }, hash: 'details' }); router.push({ name: 'docs', params: { path: 'guide/api' } })`, context)
  assert.deepEqual(calls, [
    '/users/Ada%20Lovelace?tab=bio#details',
    '/docs/guide%2Fapi'
  ])
})

test('runs computed values and ref watchers in the generated runtime', async () => {
  const result = await compilePageScript(`<script setup>
const count = ref(1)
const doubled = computed(() => count.value * 2)
let observed = 0
watch(count, value => { observed = value })
function update() { count.value = 3 }
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nupdate(); result = JSON.stringify({ doubled: doubled.value, observed })`, context)
  assert.deepEqual(JSON.parse(context.result), { doubled: 6, observed: 3 })
})

test('queues Promise handlers until the native job queue is drained', async () => {
  const result = await compilePageScript(`<script setup>
const phase = ref('waiting')
let complete
const task = new Promise(resolve => { complete = resolve })
task.then(() => { phase.value = 'resolved' })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\ncomplete(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { phase: 'waiting' })
  vm.runInNewContext(`__nuxtFlushJobs(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { phase: 'resolved' })
})

test('exposes scheduler queue helpers through the native continuation layer', async () => {
  const result = await compilePageScript('<script setup>const calls = ref(0)</script>')
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nvar job = function() { calls.value++ }; queueJob(job); queueJob(job); queuePostFlushCb(function() { calls.value++ }); result = calls.value; flushPostFlushCbs(); after = calls.value`, context)
  assert.equal(context.result, 0)
  assert.equal(context.after, 2)
})

test('runs post-flush callbacks after jobs and drains jobs queued by them', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>')
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nvar order = []; queueJob(function() { order.push('job') }); queuePostFlushCb(function() { order.push('post'); queueJob(function() { order.push('nested') }) }); flushPostFlushCbs(); result = order.join(',')`, context)
  assert.equal(context.result, 'job,post,nested')
})

test('runs pre-flush callbacks before main jobs', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>')
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nvar order = []; queueJob(function() { order.push('job') }); queuePreFlushCb(function() { order.push('pre') }); flushPostFlushCbs(); result = order.join(',')`, context)
  assert.equal(context.result, 'pre,job')
})

test('schedules pre-flush watchers before post-flush watchers', async () => {
  const result = await compilePageScript(`<script setup>
const count = ref(0)
const order = []
watch(count, () => order.push('pre'), { flush: 'pre' })
watch(count, () => order.push('post'), { flush: 'post' })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\ncount.value = 1; before = order.join(','); __nuxtFlushJobs(); after = order.join(',')`, context)
  assert.equal(context.before, '')
  assert.equal(context.after, 'pre,post')
})

test('drains nested native Promise continuations in one flush', async () => {
  const result = await compilePageScript(`<script setup>
const phase = ref('waiting')
Promise.resolve().then(() => Promise.resolve().then(() => { phase.value = 'resolved' }))
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtFlushJobs(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { phase: 'resolved' })
})

test('compiles component setup state into scoped native actions', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const count = ref(0)\nfunction increment() { count.value++ }',
      language: 'js'
    }]
  })
  assert.deepEqual(result.actions, ['__nuxtComponent0_increment'])
  assert.deepEqual(result.stateRefs, ['ready', '__nuxtComponent0_count'])
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtComponent0_increment(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { ready: false, __nuxtComponent0_count: 1 })
})

test('compiles inline template expressions into declared native actions', async () => {
  const result = await compilePageScript('<script setup>const count = ref(0)</script>', {
    inlineActions: [{ name: '__nuxtInlineAction0', expression: 'count.value += $event.value' }]
  })
  assert.ok(result.actions.includes('__nuxtInlineAction0'))
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtInlineAction0({ value: 3 }); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 3 })
})

test('unwraps refs for inline template mutations', async () => {
  const result = await compilePageScript('<script setup>const count = ref(0)</script>', {
    inlineActions: [{ name: '__nuxtInlineAction0', expression: 'count++' }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtInlineAction0(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 1 })
})

test('snapshots non-ref component bindings for native component templates', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const device = useNativeDevice()',
      language: 'js'
    }]
  })
  const context = {
    __nuxtStateChanged: { changed() {} },
    __nuxtCapabilities: { current() { return JSON.stringify(['device']) } },
    __nuxtNativeDevice: { current() { return JSON.stringify({ model: 'Pixel' }) } },
    __nuxtPlugins: { current() { return '{}' } },
    __nuxtRuntimeConfig: { current() { return '{}' } },
    __nuxtRoute: { current() { return '{}' } },
    __nuxtFetchAsync: { fetch() { return 1 } }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    ready: false,
    __nuxtComponent0_device: { model: 'Pixel' }
  })
})

test('lowers component defineProps and defineEmits macros', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const props = defineProps<{ label: string }>()\nconst emit = defineEmits<[change: string]>()\nemit("change", props.label)',
      props: { label: 'Native label' },
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtComponent0.props.label`, context)
  assert.equal(context.result, 'Native label')
})

test('applies object-style defineProps defaults at runtime', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const props = defineProps({ label: { type: String, default: "Fallback" }, count: { type: Number, default: () => 3 } })',
      props: {},
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ label: __nuxtComponent0.props.label, count: __nuxtComponent0.props.count })`, context)
  assert.deepEqual(JSON.parse(context.result), { label: 'Fallback', count: 3 })
})

test('evaluates bound component props in the child setup scope', async () => {
  const result = await compilePageScript('<script setup>const parent = ref("Dynamic label")</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const props = defineProps<{ label: string }>()\nconst seen = ref(props.label)',
      props: { ':label': 'parent' },
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot(); parent.value = 'Updated label'; updated = __nuxtComponent0.props.label`, context)
  const snapshot = JSON.parse(context.result)
  assert.equal(snapshot.parent, 'Dynamic label')
  assert.equal(snapshot.__nuxtComponent0_seen, 'Dynamic label')
  assert.equal(snapshot.__nuxtComponent0_props.label, 'Dynamic label')
  assert.equal(context.updated, 'Updated label')
})

test('supports destructured component props with aliases and defaults', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const { label, count: amount = 2 } = defineProps<{ label: string, count?: number }>()',
      props: { label: 'Native' },
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    ready: false,
    __nuxtComponent0_label: 'Native',
    __nuxtComponent0_amount: 2
  })
})

test('supports withDefaults around destructured component props', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const { label, count: amount } = withDefaults(defineProps<{ label?: string, count?: number }>(), { label: "Fallback", count: 3 })',
      props: { count: 7 },
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    ready: false,
    __nuxtComponent0_label: 'Fallback',
    __nuxtComponent0_amount: 7
  })
})

test('lowers component slots, expose, and options macros', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const slots = defineSlots<{ default?: unknown }>()\ndefineExpose({ ready: true })\ndefineOptions({ inheritAttrs: false })',
      props: {},
      language: 'ts'
    }]
  })
  assert.doesNotMatch(result.code, /defineSlots<|defineExpose\(\{|defineOptions\(\{/)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtComponent0.slots)`, context)
  assert.equal(context.result, '{}')
})

test('lowers component defineModel into a parent-synchronized ref', async () => {
  const result = await compilePageScript('<script setup>const parent = ref("initial")</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const model = defineModel<string>()\nfunction update() { model.value = "next" }',
      props: { 'v-model': 'parent' },
      language: 'ts'
    }]
  })
  assert.ok(result.stateRefs.includes('__nuxtComponent0_model'))
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); __nuxtComponent0_update(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { parent: 'next', __nuxtComponent0_model: 'next' })
})

test('preserves a named component model binding', async () => {
  const result = await compilePageScript('<script setup>const parent = ref("initial")</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const title = defineModel<string>("title")\nfunction update() { title.value = "Native" }',
      props: { 'v-model:title': 'parent' },
      language: 'ts'
    }]
  })
  assert.ok(result.stateRefs.includes('__nuxtComponent0_title'))
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); __nuxtComponent0_update(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { parent: 'Native', __nuxtComponent0_title: 'Native' })
})

test('honors a component model default when no parent value is supplied', async () => {
  const result = await compilePageScript('<template></template>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const title = defineModel<string>({ default: "Untitled" })',
      props: {},
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.equal(JSON.parse(context.result).__nuxtComponent0_title, 'Untitled')
})

test('preserves factory functions in component model options', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(false)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const title = defineModel({ default: () => "Factory" })',
      props: {},
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.equal(JSON.parse(context.result).__nuxtComponent0_title, 'Factory')
})

test('applies component model get and set transforms', async () => {
  const result = await compilePageScript('<script setup>const parent = ref("initial")</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const title = defineModel<string>({ get: value => String(value).toUpperCase(), set: value => String(value).trim() })\nfunction update() { title.value = " Native " }',
      props: { 'v-model': 'parent' },
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); before = __nuxtSnapshot(); __nuxtComponent0_update(); result = __nuxtSnapshot()`, context)
  assert.equal(JSON.parse(context.before).__nuxtComponent0_title, 'INITIAL')
  assert.equal(JSON.parse(context.result).parent, 'Native')
})

test('delivers component emits to the parent handler binding', async () => {
  const result = await compilePageScript(`<script setup>
const received = ref('')
function handleChange(value) { received.value = value }
</script>`, {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const emit = defineEmits<[change: string]>()\nemit("change", "from-child")',
      props: { '@change': 'handleChange' },
      language: 'ts'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { received: 'from-child' })
})

test('bundles convention-directory auto-imports before page setup', async () => {
  const result = await compilePageScript('<script setup>const value = useNativeValue()</script>', {
    autoImports: [{ filename: 'app/composables/useNativeValue.ts', language: 'ts', source: 'export function useNativeValue(): string { return "native" }' }]
  })
  assert.match(result.code, /function useNativeValue\(\)/)
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = value`, context)
  assert.equal(context.result, 'native')
})

test('bundles relative JavaScript and TypeScript imports in page setup', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-client-import-test-'))
  try {
    const filename = join(root, 'index.vue')
    await writeFile(join(root, 'format.ts'), 'export function formatName(value: string): string { return value.toUpperCase() }')
    const result = await compilePageScript(`<script setup lang="ts">\nimport { formatName } from './format.ts'\nconst label = formatName('native')\n</script>`, { filename })
    const context = {}
    vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
    assert.deepEqual(JSON.parse(context.result), { label: 'NATIVE' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bundles relative imports inside component setup', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-component-import-test-'))
  try {
    const filename = join(root, 'Badge.vue')
    await writeFile(join(root, 'label.ts'), 'export const label = "component-native"')
    const result = await compilePageScript('<script setup></script>', {
      componentScripts: [{
        id: '__nuxtComponent0',
        prefix: '__nuxtComponent0',
        filename,
        source: 'import { label } from "./label.ts"\nconst text = label',
        language: 'ts'
      }]
    })
    const context = { __nuxtStateChanged: { changed() {} } }
    vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
    assert.deepEqual(JSON.parse(context.result), {
      __nuxtComponent0_label: 'component-native',
      __nuxtComponent0_text: 'component-native'
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolves Nuxt project aliases in page setup imports', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-alias-import-test-'))
  try {
    const filename = join(root, 'app', 'pages', 'index.vue')
    await writeFile(join(root, 'format.ts'), 'export const label = "aliased-native"')
    const result = await compilePageScript('<script setup lang="ts">\nimport { label } from "~/format.ts"\nconst value = label\n</script>', { filename, projectRoot: root })
    const context = {}
    vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
    assert.deepEqual(JSON.parse(context.result), { label: 'aliased-native', value: 'aliased-native' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bundles an installed JavaScript npm module into page setup', async () => {
  const result = await compilePageScript(`<script setup>
import clsx from 'clsx'
const label = clsx('native', false, 'module')
</script>`, {
    filename: join(process.cwd(), 'app', 'pages', 'npm-module.vue'),
    projectRoot: process.cwd()
  })
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { label: 'native module' })
})

test('tree-shakes unused auto-import modules and keeps transitive helpers', async () => {
  const result = await compilePageScript('<script setup>const value = useVisible()</script>', {
    autoImports: [
      { filename: 'app/composables/useVisible.ts', language: 'ts', source: 'export function useVisible(): string { return useHelper() }' },
      { filename: 'shared/utils/useHelper.ts', language: 'ts', source: 'export function useHelper(): string { return "visible" }' },
      { filename: 'app/composables/useUnused.ts', language: 'ts', source: 'export function useUnused(): string { return "unused" }' }
    ]
  })
  assert.match(result.code, /function useVisible\(\)/)
  assert.match(result.code, /function useHelper\(\)/)
  assert.doesNotMatch(result.code, /function useUnused\(\)/)
})

test('reports deterministic auto-import symbol collisions', async () => {
  const result = await compilePageScript('<script setup>const value = useSharedValue()</script>', {
    autoImports: [
      { filename: 'app/composables/useSharedValue.ts', language: 'ts', source: 'export function useSharedValue(): string { return "a" }' },
      { filename: 'shared/utils/useSharedValue.ts', language: 'ts', source: 'export function useSharedValue(): string { return "b" }' }
    ]
  })
  assert.deepEqual(result.diagnostics, [{
    level: 'error',
    code: 'AUTO_IMPORT_COLLISION',
    symbol: 'useSharedValue',
    files: ['app/composables/useSharedValue.ts', 'shared/utils/useSharedValue.ts'],
    message: 'Auto-import "useSharedValue" is declared by both app/composables/useSharedValue.ts and shared/utils/useSharedValue.ts'
  }])
})

test('scopes component async composable state per instance', async () => {
  const result = await compilePageScript('<script setup></script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: "const { data, pending, error } = useAsyncData('component', () => ({ ok: true }))",
      language: 'js'
    }]
  })
  assert.deepEqual(result.stateRefs, ['__nuxtComponent0_data', '__nuxtComponent0_pending', '__nuxtComponent0_error'])
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), {
    __nuxtComponent0_data: { ok: true },
    __nuxtComponent0_pending: false,
    __nuxtComponent0_error: null
  })
})

test('forwards async-data options through component wrappers', async () => {
  const result = await compilePageScript('<script setup>const ready = ref(true)</script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: "const { data, pending } = useAsyncData('profile', () => ({ value: 1 }), { default: () => ({ value: 0 }), pick: ['value'], immediate: false })",
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify({ data: __nuxtComponent0.data.value, pending: __nuxtComponent0.pending.value })`, context)
  assert.deepEqual(JSON.parse(context.result), { data: { value: 0 }, pending: true })
  assert.match(result.code, /__nuxtComponent0_useAsyncData\(key, handler, options\)/)
})

test('routes native state updates back into component-local refs', async () => {
  const result = await compilePageScript('<script setup></script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const value = ref(\'initial\')',
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtSetState('__nuxtComponent0_value', 'updated'); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { __nuxtComponent0_value: 'updated' })
})

test('writes nested native model bindings through reactive objects', async () => {
  const result = await compilePageScript('<script setup>const profile = reactive({ name: \'Ada\' })</script>')
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtSetModel('profile.name', 'Grace'); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { profile: { name: 'Grace' } })
})

test('preserves numeric values when the native model bridge supplies numbers', async () => {
  const result = await compilePageScript('<script setup>const count = ref(0)</script>')
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtSetModel('count', 42); result = __nuxtSnapshot()`, context)
  assert.deepEqual(JSON.parse(context.result), { count: 42 })
})

test('keeps component lifecycle hooks scoped to the component runtime', async () => {
  const result = await compilePageScript(`<script setup>const ready = ref(false)</script>`, {
    componentScripts: [{
      id: 'NativeCard',
      prefix: '__nuxtComponent0',
      language: 'js',
      source: `<script setup>onMounted(() => { mounted = true }); onUnmounted(() => { unmounted = true })</script><template><span>Card</span></template>`
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunMounted(); mountedResult = mounted; __nuxtRunUnmounted(); unmountedResult = unmounted`, context)
  assert.equal(context.mountedResult, true)
  assert.equal(context.unmountedResult, true)
})

test('disposes component watchers when the native component unmounts', async () => {
  const result = await compilePageScript('<script setup></script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const source = ref(0)\nconst calls = ref(0)\nwatch(source, () => { calls.value++ })',
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtSetState('__nuxtComponent0_source', 1); before = JSON.parse(__nuxtSnapshot()); __nuxtRunUnmounted(); __nuxtSetState('__nuxtComponent0_source', 2); after = JSON.parse(__nuxtSnapshot())`, context)
  assert.equal(context.before.__nuxtComponent0_calls, 1)
  assert.equal(context.after.__nuxtComponent0_calls, 1)
})

test('disposes component watch effects when the native component unmounts', async () => {
  const result = await compilePageScript('<script setup></script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const source = ref(0)\nconst runs = ref(0)\nwatchEffect(() => { source.value; runs.value++ })',
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtSetState('__nuxtComponent0_source', 1); before = JSON.parse(__nuxtSnapshot()); __nuxtRunUnmounted(); __nuxtSetState('__nuxtComponent0_source', 2); after = JSON.parse(__nuxtSnapshot())`, context)
  assert.equal(context.before.__nuxtComponent0_runs, 2)
  assert.equal(context.after.__nuxtComponent0_runs, 2)
})

test('disposes component app-lifecycle listeners when the native component unmounts', async () => {
  const result = await compilePageScript('<script setup></script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: 'const lifecycle = useNativeAppLifecycle()\nconst changes = ref(0)\nlifecycle.onChange(() => { changes.value++ })',
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtRunAppState('background'); before = JSON.parse(__nuxtSnapshot()); __nuxtRunUnmounted(); __nuxtRunAppState('active'); after = JSON.parse(__nuxtSnapshot())`, context)
  assert.equal(context.before.__nuxtComponent0_changes, 1)
  assert.equal(context.after.__nuxtComponent0_changes, 1)
})

test('supports explicit effect scopes and scope disposal', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(0)
const calls = ref(0)
const scope = effectScope()
scope.run(() => {
  watch(source, () => { calls.value++ })
  onScopeDispose(() => { calls.value += 10 })
})
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\n__nuxtSetState('source', 1); before = JSON.parse(__nuxtSnapshot()); scope.stop(); disposed = JSON.parse(__nuxtSnapshot()); __nuxtSetState('source', 2); after = JSON.parse(__nuxtSnapshot())`, context)
  assert.equal(context.before.calls, 1)
  assert.equal(context.disposed.calls, 11)
  assert.equal(context.after.calls, 11)
})

test('supports one-shot watchers with immediate and delayed changes', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(0)
const immediate = ref(0)
const delayed = ref(0)
watch(source, () => { immediate.value++ }, { once: true, immediate: true })
watch(source, () => { delayed.value++ }, { once: true })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\ninitial = JSON.parse(__nuxtSnapshot()); __nuxtSetState('source', 1); first = JSON.parse(__nuxtSnapshot()); __nuxtSetState('source', 2); second = JSON.parse(__nuxtSnapshot())`, context)
  assert.equal(context.initial.immediate, 1)
  assert.equal(context.initial.delayed, 0)
  assert.equal(context.first.immediate, 1)
  assert.equal(context.first.delayed, 1)
  assert.equal(context.second.immediate, 1)
  assert.equal(context.second.delayed, 1)
})

test('supports synchronous and post-flush watcher scheduling', async () => {
  const result = await compilePageScript(`<script setup>
const source = ref(0)
const syncCalls = ref(0)
const postCalls = ref(0)
const postEffectRuns = ref(0)
watch(source, () => { syncCalls.value++ })
watch(source, () => { postCalls.value++ }, { flush: 'post' })
watchPostEffect(() => { source.value; postEffectRuns.value++ })
watchSyncEffect(() => { source.value })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}
initial = JSON.parse(__nuxtSnapshot()); __nuxtSetState('source', 1); before = JSON.parse(__nuxtSnapshot()); __nuxtFlushJobs(); after = JSON.parse(__nuxtSnapshot())`, context)
  assert.equal(context.initial.syncCalls, 0)
  assert.equal(context.initial.postCalls, 0)
  assert.equal(context.initial.postEffectRuns, 1)
  assert.equal(context.before.syncCalls, 1)
  assert.equal(context.before.postCalls, 0)
  assert.equal(context.before.postEffectRuns, 1)
  assert.equal(context.after.postCalls, 1)
  assert.equal(context.after.postEffectRuns, 2)
})

test('registers component route guards in the owning route runtime', async () => {
  const result = await compilePageScript('<script setup></script>', {
    componentScripts: [{
      id: '__nuxtComponent0',
      prefix: '__nuxtComponent0',
      source: "onBeforeRouteLeave((to) => to.path === '/blocked' ? false : undefined)",
      language: 'js'
    }]
  })
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nresult = __nuxtRunRouteGuards('leave', JSON.stringify({ path: '/blocked' }), JSON.stringify({ path: '/' }))`, context)
  assert.equal(context.result, '__nuxt_abort__')
})

test('allows page error handlers to recover action failures', async () => {
  const result = await compilePageScript(`<script setup>
const recovered = ref(false)
onErrorCaptured((error) => { recovered.value = error.message === 'failed'; return false })
</script>`)
  const context = { __nuxtStateChanged: { changed() {} } }
  vm.runInNewContext(`${result.code}\nhandled = __nuxtCaptureError('failed'); result = __nuxtSnapshot()`, context)
  assert.equal(context.handled, true)
  assert.deepEqual(JSON.parse(context.result), { recovered: true })
})
