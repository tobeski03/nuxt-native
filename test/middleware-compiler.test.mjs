import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compileRouteMiddleware } from '../src/middleware-compiler.mjs'

test('compiles Nuxt route middleware with redirects and aborts', async () => {
  const result = await compileRouteMiddleware(`
    import { navigateTo } from '#app'
    export default defineNuxtRouteMiddleware((to) => {
      if (to.path === '/private') return navigateTo('/login')
      if (to.path === '/blocked') return false
    })
  `, { filename: 'app/middleware/auth.global.ts' })

  assert.equal(result.name, 'auth')
  assert.equal(result.global, true)
  assert.match(result.code, /__nuxtRunMiddleware/)
  assert.match(result.code, /__nuxt_redirect__/)
})

test('normalizes object redirects returned by middleware', async () => {
  const result = await compileRouteMiddleware(`
    export default defineNuxtRouteMiddleware(() => navigateTo({ path: '/login', query: { reason: 'expired', tag: ['auth', 'native'] }, hash: 'notice' }))
  `, { filename: 'app/middleware/redirect.ts' })
  const context = {
    __nuxtRoute: { current() { return '{}' } },
    __nuxtRuntimeConfig: { current() { return '{}' } },
    __nuxtStateChanged: { changed() {} }
  }
  vm.runInNewContext(`${result.code}\nresult = __nuxtRunMiddleware('{}', '{}')`, context)
  assert.equal(context.result, '__nuxt_redirect__:/login?reason=expired&tag=auth&tag=native#notice')
})

test('compiles asynchronous middleware with the native fetch continuation bridge', async () => {
  const result = await compileRouteMiddleware(`
    export default defineNuxtRouteMiddleware(async () => {
      const response = await $fetch('/api/session')
      if (!response.authenticated) return false
    })
  `, { filename: 'auth.ts' })
  const outcomes = []
  const context = {
    __nuxtRoute: { current() { return JSON.stringify({ path: '/' }) } },
    __nuxtRuntimeConfig: { current() { return JSON.stringify({ public: {} }) } },
    __nuxtFetchAsync: { fetch() { return 7 } },
    __nuxtMiddlewareComplete: { complete(value) { outcomes.push(value) } }
  }
  vm.runInNewContext(`${result.code}\n__nuxtRunMiddlewareAsync(JSON.stringify({ path: '/private' }), JSON.stringify({ path: '/' }))`, context)
  assert.deepEqual(outcomes, [])
  vm.runInNewContext(`__nuxtResolveAsync(7, JSON.stringify({ authenticated: false }), ''); __nuxtFlushJobs()`, context)
  assert.deepEqual(outcomes, ['__nuxt_abort__'])
})

test('bundles relative imports in route middleware', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-middleware-import-test-'))
  try {
    const filename = join(root, 'auth.ts')
    await writeFile(join(root, 'paths.ts'), 'export const target = "/login"')
    const result = await compileRouteMiddleware('import { target } from "./paths.ts"\nexport default defineNuxtRouteMiddleware(() => navigateTo(target))', { filename })
    const context = {
      __nuxtRoute: { current() { return '{}' } },
      __nuxtRuntimeConfig: { current() { return '{}' } },
      __nuxtStateChanged: { changed() {} }
    }
    vm.runInNewContext(`${result.code}\nresult = __nuxtRunMiddleware('{}', '{}')`, context)
    assert.equal(context.result, '__nuxt_redirect__:/login')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
