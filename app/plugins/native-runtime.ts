export default defineNuxtPlugin((nuxtApp) => {
  if (useNativeCapability('core')) nuxtApp.provide('nativeReady', true)
})
