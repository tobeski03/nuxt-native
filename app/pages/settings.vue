<script setup lang="ts">
const router = useRouter()
const profileFetch = useFetch('/api/profile')
const profileData = profileFetch.data
const serverStatus = ref('Embedded server is starting...')
const nativeReady = ref(false)
const lifecycleState = ref('active')
const lifecycle = useNativeAppLifecycle()
const device = useNativeDevice()
const notifications = useNativeNotifications()
const clipboard = useNativeClipboard()
const compactMode = useCookie('compact-mode', { default: false })
const contactEmail = ref('')
const formStatus = ref('Waiting for a native form submission.')
const fieldState = ref('Email field idle')
const lastKey = ref('No key event yet')
const appIdentifier = ref('com.nuxtnative.prototype')
const clipboardValue = ref('Clipboard not read yet')
const clipboardStatus = ref(clipboard.available ? 'Clipboard capability available' : 'Clipboard capability unavailable')

watch(profileData, (value) => {
  serverStatus.value = value && value.name ? 'Embedded server says: ' + value.name : 'Embedded server is ready.'
})

onMounted(() => {
  nativeReady.value = Boolean(useNuxtApp().$nativeReady)
  lifecycleState.value = lifecycle.state.value || 'active'
})

function returnHome() {
  router.push('/')
}

function savePreference() {
  notifications.show('Preference saved', 'Native storage is available to this app.')
}

function submitNativeForm() {
  formStatus.value = 'Validated natively: ' + contactEmail.value
}

function markFieldFocused() {
  fieldState.value = 'Email field focused'
}

function markFieldBlurred() {
  fieldState.value = 'Email field blurred'
}

function recordKey(event: any) {
  lastKey.value = event?.key ?? 'Unknown key'
}

function copyAppIdentifier() {
  clipboardStatus.value = clipboard.writeText(appIdentifier.value) ? 'Application identifier copied natively' : 'Clipboard write unavailable'
}

function readClipboard() {
  clipboardValue.value = clipboard.readText('Clipboard is empty')
  clipboardStatus.value = 'Clipboard read through Android'
}

function demonstrateErrorSurface() {
  showError({ statusCode: 418, statusMessage: 'Native error boundary is active', data: { source: 'showcase' } })
}
</script>

<template>
  <main class="min-h-screen bg-[#f5f7fb] px-4 py-5">
    <section class="gap-5">
      <header class="gap-3 rounded-2xl bg-[#101828] p-6 shadow-lg">
        <p class="text-xs font-bold text-[#60a5fa]">NATIVE LAB  /  SETTINGS</p>
        <h1 class="text-3xl font-bold text-white">Platform surface</h1>
        <p class="text-base text-[#cbd5e1]">A second native route with device services behind Nuxt composables.</p>
      </header>

      <NativeCard title="Bridge health">
        <p class="text-sm text-gray-700">{{ nativeReady ? 'Plugin bridge ready' : 'Plugin bridge unavailable' }}</p>
        <p class="text-sm text-gray-500 mt-3">App state: {{ lifecycleState }}</p>
        <p class="text-sm text-gray-500 mt-3">Device: {{ device?.model ?? 'unavailable' }}</p>
      </NativeCard>

      <NativeCard title="A real native preference">
        <label class="flex-row items-center gap-4">
          <input v-model="compactMode" type="checkbox" />
          <span class="text-sm text-gray-700">Use compact presentation</span>
        </label>
        <button class="w-full rounded-xl bg-[#101828] py-4 mt-4 text-base font-bold text-white" @click="savePreference">Save preference</button>
      </NativeCard>

      <NativeCard title="Native clipboard">
        <p class="text-sm text-gray-700">{{ clipboardValue }}</p>
        <p class="text-xs text-gray-500 mt-2">{{ clipboardStatus }}</p>
        <section class="flex-row gap-3 mt-4">
          <button class="flex-1 rounded-xl bg-[#101828] py-3 text-sm font-bold text-white" @click="copyAppIdentifier">Copy app ID</button>
          <button class="flex-1 rounded-xl bg-blue-100 py-3 text-sm font-bold text-blue-700" @click="readClipboard">Read clipboard</button>
        </section>
      </NativeCard>

      <NativeCard title="Native error boundary">
        <p class="text-sm text-gray-700">Trigger the framework-owned error surface, then recover through <span class="font-bold">clearError()</span>.</p>
        <button class="w-full rounded-xl bg-red-100 py-4 mt-4 text-sm font-bold text-red-700" @click="demonstrateErrorSurface">Test native error surface</button>
      </NativeCard>

      <NativeCard title="Native form boundary">
        <form class="gap-3" @submit.prevent="submitNativeForm">
          <label class="text-xs font-bold text-gray-700">Contact email</label>
          <input v-model.trim="contactEmail" type="email" required placeholder="you@example.com" class="rounded-xl bg-gray-100 px-4 py-4 text-sm text-gray-900" @focus="markFieldFocused" @blur="markFieldBlurred" @keydown="recordKey" />
          <label class="text-xs font-bold text-gray-700 mt-2">Application identifier</label>
          <input v-model="appIdentifier" readonly class="rounded-xl bg-gray-100 px-4 py-4 text-sm text-gray-500" />
          <button type="submit" class="w-full rounded-xl bg-blue-600 py-4 text-sm font-bold text-white">Submit native form</button>
        </form>
        <p class="text-sm text-blue-700 mt-3">{{ formStatus }}</p>
        <p class="text-xs text-gray-500 mt-2">{{ fieldState }} · {{ lastKey }}</p>
      </NativeCard>

      <p class="text-xs text-gray-500">{{ serverStatus }}</p>
      <section class="flex-row gap-3 pb-3">
        <a href="/" class="flex-1 rounded-2xl bg-blue-600 py-4 text-center text-sm font-bold text-white shadow-md">Back home</a>
        <button class="flex-1 rounded-2xl bg-white py-4 text-sm font-bold text-blue-600 shadow-sm" @click="returnHome">useRouter()</button>
      </section>
    </section>
  </main>
</template>
