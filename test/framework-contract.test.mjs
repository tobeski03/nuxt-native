import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_IMPORT_CONTRACT, DIRECTORY_CONTRACT, resolveBuiltinComponent } from '../src/framework/contract.mjs'

test('defines the Nuxt-shaped directory contract', () => {
  assert.equal(DIRECTORY_CONTRACT.app.pages, 'file-based routes')
  assert.equal(DIRECTORY_CONTRACT.server.api, 'Nitro API routes')
  assert.equal(DIRECTORY_CONTRACT.shared.types, 'client/server-safe types')
})

test('resolves framework components to native responsibilities', () => {
  assert.deepEqual(resolveBuiltinComponent('NuxtPage'), {
    type: 'router-outlet',
    native: 'screen-host'
  })
  assert.equal(resolveBuiltinComponent('UnknownComponent'), undefined)
  assert.equal(resolveBuiltinComponent('KeepAlive').native, 'native-keep-alive')
})

test('keeps the auto-import surface explicit and tree-shakeable', () => {
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('ref'))
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('provide'))
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('inject'))
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('effectScope'))
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('onScopeDispose'))
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('watchPostEffect'))
  assert.ok(AUTO_IMPORT_CONTRACT.vue.includes('watchSyncEffect'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useState'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useHead'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useAppConfig'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useError'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('showError'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('clearError'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useFetch'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useCookie'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useNativeClipboard'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('refreshNuxtData'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('clearNuxtData'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useLazyAsyncData'))
  assert.ok(AUTO_IMPORT_CONTRACT.nuxt.includes('useLazyFetch'))
  assert.ok(AUTO_IMPORT_CONTRACT.directories.includes('shared/utils'))
})

test('maps common Nuxt media and client fallback components to native responsibilities', () => {
  assert.deepEqual(resolveBuiltinComponent('NuxtImg'), { type: 'image', native: 'native-image-view' })
  assert.deepEqual(resolveBuiltinComponent('NuxtPicture'), { type: 'image', native: 'native-image-view' })
  assert.deepEqual(resolveBuiltinComponent('NuxtIsland'), { type: 'island', native: 'native-island-boundary' })
  assert.deepEqual(resolveBuiltinComponent('NuxtClientFallback'), { type: 'client-only', native: 'client-only' })
})

test('exposes Nuxt head metadata as native framework primitives', () => {
  assert.equal(resolveBuiltinComponent('Head').native, 'native-head-metadata')
  assert.equal(resolveBuiltinComponent('Title').native, 'native-activity-title')
  assert.equal(resolveBuiltinComponent('Meta').type, 'head-meta')
})
