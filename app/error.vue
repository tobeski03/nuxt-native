<script setup lang="ts">
const error = useError()

function recover() {
  clearError()
}
</script>

<template>
  <main class="min-h-screen bg-[#f5f7fb] px-4 py-5">
    <section class="gap-5">
      <header class="gap-3 rounded-2xl bg-[#101828] p-6 shadow-lg">
        <p class="text-xs font-bold text-[#fca5a5]">NATIVE ERROR SURFACE</p>
        <h1 class="text-3xl font-bold text-white">{{ error?.statusCode || 500 }}</h1>
        <p class="text-base text-[#cbd5e1]">{{ error?.statusMessage || error?.message || 'Something went wrong.' }}</p>
      </header>
      <NativeCard title="Recover without a WebView">
        <p class="text-sm text-gray-700">This error page is a native route surface. Recovery returns to the last requested route through the Nuxt error API.</p>
        <button class="w-full rounded-xl bg-blue-600 py-4 mt-4 text-base font-bold text-white" @click="recover">Clear error and retry</button>
      </NativeCard>
    </section>
  </main>
</template>
