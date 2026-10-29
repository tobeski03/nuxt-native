<script setup lang="ts">
import clsx from 'clsx'

const name = ref('')
const saving = ref(false)
const saved = ref(false)
const intensity = ref('72')
const selectedMode = ref('Native')
const runtimeConfig = useRuntimeConfig()
const remoteApi = Boolean(runtimeConfig.public && runtimeConfig.public.apiBase)
const profileFetch = useFetch(remoteApi ? '/users/1' : '/api/profile')
const profileData = profileFetch.data
const profilePending = profileFetch.pending
const profileError = profileFetch.error
const profileName = ref('Loading profile from the embedded server...')
const pluginStatus = ref('Checking server plugin...')
const nativeReady = ref(false)
const apiRuntime = ref(remoteApi ? 'Remote API' : 'Embedded server')
const storage = useNativeStorage()
const dialog = useNativeDialog()
const notifications = useNativeNotifications()
const modeDescription = ref('Production behavior: native views, live server data, and native actions are enabled.')
const appConfig = useAppConfig()
const npmModuleLabel = clsx('native', false, 'npm module')

function updateModeDescription() {
  if (selectedMode.value === 'Debug') modeDescription.value = 'Diagnostics visible: bridge state and server timing stay on screen.'
  else if (selectedMode.value === 'Preview') modeDescription.value = 'Preview behavior: profile edits stay local and do not call the server.'
  else modeDescription.value = 'Production behavior: native views, live server data, and native actions are enabled.'
}

watch([profileData, profileError], (values) => {
  const value = values[0]
  const error = values[1]
  const remoteName = value && value.firstName ? `${value.firstName} ${value.lastName || ''}`.trim() : ''
  profileName.value = error ? `${remoteApi ? 'External API' : 'Embedded server'} error: ${error.message || error}` : remoteName || value && value.name || (remoteApi ? 'External API is ready.' : 'Embedded server is ready.')
  pluginStatus.value = error ? `${remoteApi ? 'External API' : 'Server plugin'} check failed` : value && value.serverPlugin ? 'Server plugin: active' : remoteApi ? 'External API: connected' : 'Server plugin: not detected'
})

async function saveProfile() {
  saving.value = true
  saved.value = false
  try {
    if (selectedMode.value !== 'Preview') {
      await $fetch('/api/profile', { method: 'PUT', body: { name: name.value } })
    }
    saved.value = true
    notifications.show('Nuxt Native', selectedMode.value === 'Preview' ? 'Preview edit kept local to this screen.' : 'Profile saved on the native runtime.')
  } finally {
    saving.value = false
  }
}

function applyMode() {
  storage.set('showcase-mode', selectedMode.value)
  updateModeDescription()
  notifications.show('Runtime mode', `${selectedMode.value} mode is active.`)
}

async function explainRuntime() {
  await dialog.show({
    title: 'Native by design',
    message: 'This page is authored with Nuxt conventions, compiled to native Android views, and runs JavaScript without a WebView.',
    confirmText: 'Got it'
  })
}

onMounted(() => {
  const savedMode = storage.get('showcase-mode', 'Native')
  if (savedMode === 'Native' || savedMode === 'Debug' || savedMode === 'Preview') selectedMode.value = savedMode
  updateModeDescription()
  nativeReady.value = Boolean(useNuxtApp().$nativeReady)
})
</script>

<template>
  <main class="min-h-screen bg-[#f5f7fb] px-4 py-5">
    <section class="gap-5">
      <header class="gap-4 rounded-2xl bg-gradient-to-br from-[#101828] via-[#172554] to-[#1d4ed8] p-6 shadow-lg">
        <p class="text-xs font-bold text-[#60a5fa]">{{ appConfig.showcaseLabel || 'THE NATIVE EDGE' }}  /  {{ appConfig.showcaseVersion || '01' }}</p>
        <h1 class="text-3xl font-bold text-white">Nuxt Native</h1>
        <p class="text-base text-[#cbd5e1]">The Nuxt developer experience, translated into a real Android surface.</p>
        <NativeBadge />
      </header>

      <section class="grid grid-cols-2 gap-3">
        <article class="flex-1 rounded-2xl bg-blue-600 p-5 shadow-md">
          <p class="text-xs font-bold text-[#bfdbfe]">RUNTIME</p>
          <strong class="text-2xl font-bold text-white">Native</strong>
          <p class="text-xs text-[#dbeafe]">WebViews used: 0</p>
        </article>
        <article class="flex-1 rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-xs font-bold text-gray-500">DATA LAYER</p>
          <strong class="text-2xl font-bold text-blue-600">{{ profilePending ? '...' : 'Ready' }}</strong>
          <p class="text-xs text-gray-500">Server data ready</p>
        </article>
      </section>

      <NativeCard title="Live native state">
        <p class="text-sm text-gray-500 mb-4">{{ profileName }}</p>
        <p class="text-xs text-blue-600 mb-4">{{ pluginStatus }}</p>
        <p class="text-xs text-gray-500 mb-4">npm module: {{ npmModuleLabel }}</p>
        <input v-model="name" class="w-full rounded-xl bg-gray-50 px-4 py-4 text-gray-900" placeholder="Enter your name" />
        <button class="w-full rounded-xl bg-[#101828] py-4 mt-4 text-base font-bold text-white" :disabled="saving" @click="saveProfile">
          {{ saving ? 'Saving...' : saved ? 'Saved on device' : 'Save profile' }}
        </button>
      </NativeCard>

      <NativeCard title="Native controls, familiar syntax">
        <label class="text-sm font-bold text-gray-900">Showcase mode: {{ selectedMode }}</label>
        <select v-model="selectedMode" class="w-full mt-3 rounded-xl bg-gray-50 px-4 py-4 text-gray-900" @change="applyMode">
          <option>Native</option>
          <option>Debug</option>
          <option>Preview</option>
        </select>
        <p class="text-sm text-gray-500 mt-3">{{ modeDescription }}</p>
        <p class="text-xs text-blue-600 mt-3">API runtime: {{ apiRuntime }}</p>
        <label class="text-sm font-bold text-gray-900 mt-4">Interaction intensity: {{ intensity }}%</label>
        <input v-model="intensity" type="range" class="w-full mt-3" />
      </NativeCard>

      <NativeCard v-if="selectedMode === 'Debug'" title="Runtime diagnostics">
        <p class="text-sm text-gray-700">Native bridge: {{ nativeReady ? 'ready' : 'starting' }}</p>
        <p class="text-sm text-gray-500 mt-3">Embedded server: {{ profilePending ? 'loading' : 'responding' }}</p>
        <p class="text-xs text-gray-500 mt-3">Showcase mode changes this demo surface; it does not turn the app into a WebView.</p>
      </NativeCard>

      <NativeCard title="What is actually native?">
        <p class="text-sm text-gray-700">Native views  -  Reactive JavaScript  -  Embedded Nuxt server</p>
        <p class="text-xs text-gray-500 mt-3">One app surface, three platform boundaries, zero WebView.</p>
      </NativeCard>

      <NativeCard title="Native runtime map">
        <p class="text-sm font-bold text-gray-900">1. Nuxt page authoring</p>
        <p class="text-xs text-gray-500 mt-2">Vue templates, JavaScript or TypeScript setup, composables, layouts, and file-based routes.</p>
        <p class="text-sm font-bold text-gray-900 mt-4">2. Embedded server boundary</p>
        <p class="text-xs text-gray-500 mt-2">Server handlers run inside the packaged app and serve the same page through native fetch calls.</p>
        <p class="text-sm font-bold text-gray-900 mt-4">3. Android view surface</p>
        <p class="text-xs text-gray-500 mt-2">The renderer creates Android widgets and connects them to reactive state without a browser document.</p>
      </NativeCard>

      <NativeCard title="What you can build next">
        <section class="gap-3">
          <article class="rounded-xl bg-blue-50 p-4">
            <p class="text-sm font-bold text-blue-900">Device-first experiences</p>
            <p class="text-xs text-blue-700 mt-2">Use sensors, permissions, storage, notifications, and media through composables that map to Android services.</p>
          </article>
          <article class="rounded-xl bg-slate-100 p-4">
            <p class="text-sm font-bold text-slate-900">Nuxt application structure</p>
            <p class="text-xs text-slate-600 mt-2">Keep pages, layouts, middleware, server handlers, and shared utilities in the familiar Nuxt locations.</p>
          </article>
          <article class="rounded-xl bg-emerald-50 p-4">
            <p class="text-sm font-bold text-emerald-900">One packaged runtime</p>
            <p class="text-xs text-emerald-700 mt-2">The JavaScript runtime, embedded server, and native view layer ship together in the application package.</p>
          </article>
        </section>
        <p class="text-xs font-bold text-blue-600 mt-5">Swipe the native capability rail</p>
        <section class="flex-row overflow-x-auto gap-3 mt-3 pb-2">
          <article class="flex-none w-[240px] rounded-xl bg-[#101828] p-4">
            <p class="text-sm font-bold text-white">Sensors</p>
            <p class="text-xs text-[#cbd5e1] mt-2">Accelerometer, gyroscope, and motion streams.</p>
          </article>
          <article class="flex-none w-[240px] rounded-xl bg-blue-600 p-4">
            <p class="text-sm font-bold text-white">Media</p>
            <p class="text-xs text-[#dbeafe] mt-2">Native files, photos, and camera capture.</p>
          </article>
          <article class="flex-none w-[240px] rounded-xl bg-emerald-600 p-4">
            <p class="text-sm font-bold text-white">Notifications</p>
            <p class="text-xs text-[#d1fae5] mt-2">Platform notifications from Nuxt composables.</p>
          </article>
        </section>
      </NativeCard>

      <NativeCard title="Built for real screens">
        <p class="text-sm text-gray-700">This lower section is intentional: it demonstrates that ordinary Nuxt content can extend beyond the first viewport and remain reachable with native scrolling.</p>
        <p class="text-xs text-gray-500 mt-3">Swipe upward to explore the rest of the showcase, then use Open lab to continue into the second route.</p>
      </NativeCard>

      <NativeCard title="Native API matrix">
        <p class="text-sm text-gray-700">Each capability keeps a Nuxt-shaped API while crossing into a real Android service.</p>
        <section class="gap-3 mt-4">
          <article class="rounded-xl bg-white p-4">
            <p class="text-sm font-bold text-gray-900">useNativeDevice()</p>
            <p class="text-xs text-gray-500 mt-2">Reads model, manufacturer, Android version, and package identity.</p>
          </article>
          <article class="rounded-xl bg-white p-4">
            <p class="text-sm font-bold text-gray-900">useNativeStorage()</p>
            <p class="text-xs text-gray-500 mt-2">Persists preferences through app-private Android storage.</p>
          </article>
          <article class="rounded-xl bg-white p-4">
            <p class="text-sm font-bold text-gray-900">useNativeClipboard()</p>
            <p class="text-xs text-gray-500 mt-2">Reads and writes the platform clipboard without a browser document.</p>
          </article>
        </section>
      </NativeCard>

      <section class="flex-row gap-3 pb-3">
        <button class="flex-1 rounded-2xl bg-[#101828] py-4 text-sm font-bold text-white shadow-md" @click="explainRuntime">Why native?</button>
        <a href="/settings" class="flex-1 rounded-2xl bg-white py-4 text-center text-sm font-bold text-blue-600 shadow-sm">Open lab</a>
      </section>
    </section>
  </main>
</template>
