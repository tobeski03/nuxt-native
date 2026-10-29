import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouteManifest, createRouter, matchRoute, pageFileToRoute } from '../src/framework/router.mjs'

test('converts Nuxt page files into native routes', () => {
  assert.equal(pageFileToRoute('app/pages/index.vue').path, '/')
  assert.equal(pageFileToRoute('app/pages/settings.vue').path, '/settings')
  assert.equal(pageFileToRoute('app/pages/posts/[id].vue').path, '/posts/:id')
  assert.equal(pageFileToRoute('app/pages/docs/[...path].vue').path, '/docs/*path')
})

test('matches static routes before dynamic routes', () => {
  const manifest = createRouteManifest([
    'app/pages/posts/[id].vue',
    'app/pages/posts/new.vue',
    'app/pages/index.vue'
  ])
  assert.equal(matchRoute(manifest, '/posts/new').route.file, 'app/pages/posts/new.vue')
  assert.deepEqual(matchRoute(manifest, '/posts/42').params, { id: '42' })
})

test('supports native back and forward history', () => {
  const router = createRouter(createRouteManifest(['app/pages/index.vue', 'app/pages/settings.vue', 'app/pages/profile.vue']))
  router.push('/settings')
  router.push('/profile')
  assert.equal(router.current().path, '/profile')
  assert.equal(router.back().path, '/settings')
  assert.equal(router.forward().path, '/profile')
})
