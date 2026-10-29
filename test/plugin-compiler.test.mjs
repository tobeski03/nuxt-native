import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'
import { compilePlugin } from '../src/plugin-compiler.mjs'

test('compiles native plugins with capability checks and provides', async () => {
  const result = await compilePlugin(`
    export default defineNuxtPlugin((nuxtApp) => {
      if (useNativeCapability('core')) nuxtApp.provide('ready', true)
    })
  `, { filename: 'app/plugins/native-runtime.ts' })

  assert.equal(result.name, 'native-runtime')
  assert.match(result.code, /__nuxtRunPlugin/)
  assert.match(result.code, /__nuxtPluginProvide\.provide/)
  assert.match(result.code, /__nuxtCapabilities\.current/)
  assert.match(result.code, /__nuxtRegisterPluginHook/)
  assert.match(result.code, /__nuxtDisposePlugin/)
})

test('supports object-style plugin setup and lifecycle hooks', async () => {
  const result = await compilePlugin(`
    export default defineNuxtPlugin({
      setup(nuxtApp) { nuxtApp.provide('ready', true) },
      hooks: { 'app:state': (state) => state, 'app:dispose': () => true }
    })
  `, { filename: 'app/plugins/lifecycle.ts' })
  assert.match(result.code, /plugin\.setup\(app\)/)
  assert.match(result.code, /plugin\.hooks/)
})

test('exposes declared host capabilities and disposes plugin cleanup in reverse order', async () => {
  const result = await compilePlugin(`
    export default defineNuxtPlugin({
      capabilities: ['device', 'camera'],
      setup(nuxtApp) {
        nuxtApp.provide('capabilities', nuxtApp.capabilities)
        nuxtApp.provide('hasDevice', nuxtApp.hasCapability('device'))
        nuxtApp.onDispose(() => { disposed.push('registered') })
        return () => { disposed.push('returned') }
      }
    })
  `, { filename: 'app/plugins/permissions.ts' })
  const provided = {}
  const context = {
    JSON,
    disposed: [],
    __nuxtCapabilities: { current: () => JSON.stringify(['core', 'device']) },
    __nuxtRuntimeConfig: { current: () => '{}' },
    __nuxtPluginProvide: { provide: (key, value) => { provided[key] = JSON.parse(value) } }
  }
  vm.runInNewContext(`${result.code}\n__nuxtRunPlugin(); __nuxtDisposePlugin();`, context)
  assert.deepEqual(provided.capabilities, ['device'])
  assert.equal(provided.hasDevice, true)
  assert.deepEqual(context.disposed, ['returned', 'registered'])
})

test('bundles relative imports in plugin setup', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-plugin-import-test-'))
  try {
    const filename = join(root, 'runtime.ts')
    await writeFile(join(root, 'value.ts'), 'export const value = "bundled-plugin"')
    const result = await compilePlugin('import { value } from "./value.ts"\nexport default defineNuxtPlugin((nuxtApp) => nuxtApp.provide("value", value))', { filename })
    assert.match(result.code, /bundled-plugin/)
    assert.match(result.code, /var __nuxtPlugin/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
