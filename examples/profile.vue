<script setup lang="ts">
const name = ref('')
const saving = ref(false)

async function saveProfile() {
  saving.value = true
  try {
    await $fetch('/api/profile', {
      method: 'PUT',
      body: { name: name.value }
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="min-h-screen bg-gray-50 px-5 py-6">
    <section class="gap-5">
      <h1 class="text-2xl font-bold text-gray-900">Your profile</h1>
      <p class="text-sm text-gray-500">A native Android page authored with Nuxt conventions.</p>
      <input v-model="name" class="w-full" placeholder="Your name" />
      <button
        class="w-full rounded-xl bg-blue-600 py-4 text-white"
        :disabled="saving"
        @click="saveProfile"
      >
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </section>
  </main>
</template>
