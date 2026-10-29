/**
 * The Nuxt-native framework surface. This is intentionally data-first so the
 * compiler, auto-import scanner, and Android runtime can share one contract.
 */
export const DIRECTORY_CONTRACT = {
  app: {
    pages: 'file-based routes',
    components: 'auto-imported Vue/native components',
    composables: 'auto-imported stateful helpers',
    layouts: 'reusable page shells',
    middleware: 'navigation guards',
    plugins: 'runtime initialization',
    utils: 'auto-imported client utilities'
  },
  server: {
    api: 'Nitro API routes',
    routes: 'server-rendered routes',
    middleware: 'server request middleware',
    plugins: 'Nitro initialization',
    utils: 'server-only utilities'
  },
  shared: {
    types: 'client/server-safe types',
    utils: 'client/server-safe utilities'
  },
  legacyRoot: {
    pages: 'file-based routes',
    components: 'auto-imported Vue/native components',
    composables: 'auto-imported stateful helpers',
    layouts: 'reusable page shells',
    middleware: 'navigation guards',
    plugins: 'runtime initialization',
    utils: 'auto-imported client utilities',
    app: 'application shell',
    error: 'route-error surface'
  },
  public: 'unprocessed static assets',
  modules: 'framework/module extensions'
}

export const BUILTIN_COMPONENTS = {
  NuxtPage: { type: 'router-outlet', native: 'screen-host' },
  NuxtLayout: { type: 'layout-host', native: 'layout-host' },
  Head: { type: 'head', native: 'native-head-metadata' },
  Title: { type: 'head-title', native: 'native-activity-title' },
  Meta: { type: 'head-meta', native: 'native-head-metadata' },
  Link: { type: 'head-link', native: 'native-head-metadata' },
  NuxtLink: { type: 'link', native: 'native-navigation-link' },
  NuxtImg: { type: 'image', native: 'native-image-view' },
  NuxtPicture: { type: 'image', native: 'native-image-view' },
  NuxtIsland: { type: 'island', native: 'native-island-boundary' },
  NuxtRouteAnnouncer: { type: 'route-announcer', native: 'native-accessibility-announcer' },
  NuxtLoadingIndicator: { type: 'loading-indicator', native: 'native-progress-indicator' },
  ClientOnly: { type: 'client-only', native: 'client-only' },
  NuxtClientFallback: { type: 'client-only', native: 'client-only' },
  NuxtErrorBoundary: { type: 'error-boundary', native: 'error-boundary' },
  KeepAlive: { type: 'keep-alive', native: 'native-keep-alive' },
  Transition: { type: 'transition', native: 'native-transition' },
  Teleport: { type: 'portal', native: 'native-portal' },
  Suspense: { type: 'suspense', native: 'native-suspense' }
}

export const AUTO_IMPORT_CONTRACT = {
  vue: ['ref', 'shallowRef', 'reactive', 'shallowReactive', 'readonly', 'computed', 'isRef', 'unref', 'toRef', 'toRefs', 'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect', 'effectScope', 'getCurrentScope', 'onScopeDispose', 'nextTick', 'provide', 'inject', 'onBeforeMount', 'onMounted', 'onBeforeUnmount', 'onUnmounted', 'onBeforeRouteLeave', 'onBeforeRouteUpdate', 'onErrorCaptured'],
  nuxt: ['useState', 'useCookie', 'useFetch', 'useLazyFetch', 'useAsyncData', 'useLazyAsyncData', 'refreshNuxtData', 'clearNuxtData', 'useRoute', 'useRouter', 'useRuntimeConfig', 'useAppConfig', 'useError', 'showError', 'clearError', 'useHead', 'useSeoMeta', 'useNuxtApp', 'useNativeCapability', 'useNativeDevice', 'useNativeStorage', 'useNativeClipboard', 'useNativePermissions', 'useNativeFileSystem', 'useNativeNotifications', 'useNativeMedia', 'useNativeDialog', 'useNativeGesture', 'useNativeAppLifecycle', 'useNativeSensors', 'navigateTo', 'definePageMeta'],
  directories: ['app/components', 'components', 'app/composables', 'composables', 'app/utils', 'utils', 'server/utils', 'shared/utils']
}

export function resolveBuiltinComponent(name) {
  return BUILTIN_COMPONENTS[name]
}

export function isBuiltinComponent(name) {
  return Object.hasOwn(BUILTIN_COMPONENTS, name)
}
