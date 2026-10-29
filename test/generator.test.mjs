import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import test from 'node:test'
import { componentName } from '../src/framework/components.mjs'

test('names nested auto-imported components deterministically', () => {
  assert.equal(componentName('app/components/forms/Button.vue', 'app/components'), 'FormsButton')
  assert.equal(componentName('app/components/forms/index.vue', 'app/components'), 'Forms')
  assert.equal(componentName('app/components/user-card.vue', 'app/components'), 'UserCard')
})

test('discovers nested components and rejects auto-import name collisions', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-components-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'app/components/forms'), { recursive: true })
    await mkdir(join(root, 'app/components/forms/Button'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<template><main><FormsButton /></main></template>')
    await writeFile(join(root, 'app/components/forms/Button.vue'), '<template><button>Nested button</button></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    assert.match(await readFile(join(output, 'index.ir.json'), 'utf8'), /Nested button/)

    await writeFile(join(root, 'app/components/forms/Button/index.vue'), '<template><button>Other button</button></template>')
    await assert.rejects(
      run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, join(root, 'collision-assets')], { cwd: process.cwd() }),
      /Duplicate auto-imported component "FormsButton"/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('supports established Nuxt root directories alongside app directories', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-root-contract-test-'))
  try {
    await mkdir(join(root, 'pages'), { recursive: true })
    await mkdir(join(root, 'components'), { recursive: true })
    await mkdir(join(root, 'composables'), { recursive: true })
    await mkdir(join(root, 'layouts'), { recursive: true })
    await mkdir(join(root, 'middleware'), { recursive: true })
    await mkdir(join(root, 'plugins'), { recursive: true })
    await writeFile(join(root, 'pages/index.vue'), '<script setup>const label = useRootLabel()</script><template><RootButton :label="label" /></template>')
    await writeFile(join(root, 'components/RootButton.vue'), '<template><button>{{ label }}</button></template><script setup>const props = defineProps({ label: String })</script>')
    await writeFile(join(root, 'composables/useRootLabel.ts'), 'export function useRootLabel(): string { return "Root contract" }')
    await writeFile(join(root, 'layouts/default.vue'), '<template><section class="root-layout"><slot /></section></template>')
    await writeFile(join(root, 'middleware/auth.global.ts'), 'export default defineNuxtRouteMiddleware(() => true)')
    await writeFile(join(root, 'plugins/boot.ts'), 'export default defineNuxtPlugin(() => ({ provide: { rootBoot: true } }))')
    await writeFile(join(root, 'app.vue'), '<template><NuxtLayout><NuxtPage /></NuxtLayout></template>')
    await writeFile(join(root, 'error.vue'), '<script setup>const error = useError()</script><template><p>{{ error.message }}</p></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    assert.match(await readFile(join(output, 'index.ir.json'), 'utf8'), /RootButton/)
    assert.match(await readFile(join(output, 'index.script.js'), 'utf8'), /Root contract/)
    assert.match(await readFile(join(output, 'routes.json'), 'utf8'), /auth/)
    assert.match(await readFile(join(output, 'plugins.json'), 'utf8'), /boot/)
    assert.match(await readFile(join(output, 'error.ir.json'), 'utf8'), /error.message/)
    assert.match(await readFile(join(output, 'error.script.js'), 'utf8'), /function useError\(/)
    assert.match(await readFile(join(output, 'error.script.json'), 'utf8'), /actions/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const run = promisify(execFile)

test('selects named layouts and supports layout false during fixture generation', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-layout-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'app/layouts'), { recursive: true })
    await writeFile(join(root, 'app/layouts/default.vue'), '<template><section class="default-shell"><slot /></section></template>')
    await writeFile(join(root, 'app/layouts/account.vue'), '<template><section class="account-shell"><slot /></section></template>')
    await writeFile(join(root, 'app/error.vue'), '<template><section><h1>{{ error.statusCode }}</h1><p>{{ error.message }}</p></section></template>')
    await writeFile(join(root, 'app/pages/index.vue'), `<script setup>definePageMeta({ layout: 'account' })</script><template><p>Account page</p></template>`)
    await writeFile(join(root, 'app/pages/plain.vue'), `<script setup>definePageMeta({ layout: false })</script><template><p>Plain page</p></template>`)
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const account = JSON.parse(await readFile(join(output, 'index.ir.json'), 'utf8'))
    const plain = JSON.parse(await readFile(join(output, 'plain.ir.json'), 'utf8'))
    const error = JSON.parse(await readFile(join(output, 'error.ir.json'), 'utf8'))
    const accountText = JSON.stringify(account)
    const plainText = JSON.stringify(plain)
    assert.match(accountText, /account-shell/)
    assert.match(accountText, /Account page/)
    assert.doesNotMatch(accountText, /default-shell/)
    assert.match(plainText, /Plain page/)
    assert.doesNotMatch(plainText, /default-shell|account-shell/)
    assert.match(JSON.stringify(error), /statusCode/)
    assert.match(JSON.stringify(error), /message/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('wraps generated route roots in a native screen host for device scrolling', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-scroll-host-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<template><main><section><p>Above the fold</p><p>Below the fold</p></section></main></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const ir = JSON.parse(await readFile(join(output, 'index.ir.json'), 'utf8'))
    assert.equal(ir.nodes[0].type, 'screen')
    assert.equal(ir.nodes[0].tag, 'main')
    assert.match(JSON.stringify(ir), /Below the fold/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('passes project theme colors through normal fixture generation', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-theme-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await writeFile(join(root, 'nuxt-native.config.json'), JSON.stringify({ appConfig: { productName: 'Fixture' }, theme: { colors: { brand: '#123456' } } }))
    await writeFile(join(root, 'app/pages/index.vue'), '<template><p :class="tone">Brand</p></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const ir = JSON.parse(await readFile(join(output, 'index.ir.json'), 'utf8'))
    assert.equal(ir.styleTokens.brand, '#123456')
    const nativeConfig = JSON.parse(await readFile(join(output, 'native-config.json'), 'utf8'))
    assert.deepEqual(nativeConfig.theme.colors, { brand: '#123456' })
    assert.deepEqual(nativeConfig.appConfig, { productName: 'Fixture' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loads conventional app.config files and lets native config override them', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-app-config-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await writeFile(join(root, 'app.config.ts'), 'export default defineAppConfig({ productName: "Nuxt source", accent: "violet" })')
    await writeFile(join(root, 'nuxt-native.config.json'), JSON.stringify({ appConfig: { accent: 'teal' } }))
    await writeFile(join(root, 'app/pages/index.vue'), '<template><p>App config</p></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const nativeConfig = JSON.parse(await readFile(join(output, 'native-config.json'), 'utf8'))
    assert.deepEqual(nativeConfig.appConfig, { productName: 'Nuxt source', accent: 'teal' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loads public runtime config and app config from nuxt.config files', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-nuxt-config-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await writeFile(join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({ runtimeConfig: { public: { apiBase: "https://api.example.test" } }, appConfig: { fromNuxt: true } })')
    await writeFile(join(root, 'app/pages/index.vue'), '<template><p>Nuxt config</p></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const nativeConfig = JSON.parse(await readFile(join(output, 'native-config.json'), 'utf8'))
    assert.deepEqual(nativeConfig.runtimeConfig.public, { apiBase: 'https://api.example.test' })
    assert.deepEqual(nativeConfig.appConfig, { fromNuxt: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('declares inline template event expressions for the native action bridge', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-inline-action-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<script setup>const count = ref(0)</script><template><button @click="count++">Increment</button></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const ir = await readFile(join(output, 'index.ir.json'), 'utf8')
    const manifest = JSON.parse(await readFile(join(output, 'index.script.json'), 'utf8'))
    const script = await readFile(join(output, 'index.script.js'), 'utf8')
    assert.match(ir, /__nuxtInlineAction0/)
    assert.ok(manifest.actions.includes('__nuxtInlineAction0'))
    assert.match(script, /function __nuxtInlineAction0\(\$event\)/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('compiles app and layout script setup into the native shell runtime', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-shell-script-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'app/layouts'), { recursive: true })
    await writeFile(join(root, 'app/app.vue'), `<script setup lang="ts">const appLabel = ref('App shell')</script><template><NuxtLayout><NuxtPage /></NuxtLayout><p>{{ appLabel }}</p></template>`)
    await writeFile(join(root, 'app/layouts/default.vue'), `<script setup>const layoutLabel = ref('Layout shell')</script><template><section><p>{{ layoutLabel }}</p><slot /></section></template>`)
    await writeFile(join(root, 'app/pages/index.vue'), '<template><p>Page</p></template>')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const ir = await readFile(join(output, 'index.ir.json'), 'utf8')
    const script = await readFile(join(output, 'index.script.js'), 'utf8')
    assert.match(ir, /__nuxtApp_appLabel/)
    assert.match(ir, /__nuxtLayout_default_layoutLabel/)
    assert.match(script, /__nuxtApp_setup|__nuxtLayout_default_setup/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('copies Nuxt public assets into the generated native asset bundle', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-public-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'public/images'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<template><img src="/images/logo.txt" /></template>')
    await writeFile(join(root, 'public/images/logo.txt'), 'native-public-asset')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    assert.equal(await readFile(join(output, 'public/images/logo.txt'), 'utf8'), 'native-public-asset')
    const manifest = JSON.parse(await readFile(join(output, 'public-assets.json'), 'utf8'))
    assert.deepEqual(manifest.files, ['images/logo.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preserves nested server asset paths for same-named handlers', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-server-assets-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'server/api'), { recursive: true })
    await mkdir(join(root, 'server/admin'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<template><main>Server asset test</main></template>')
    await writeFile(join(root, 'server/api/profile.get.ts'), 'export default defineEventHandler(() => ({ scope: "api" }))')
    await writeFile(join(root, 'server/admin/profile.get.ts'), 'export default defineEventHandler(() => ({ scope: "admin" }))')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const manifest = JSON.parse(await readFile(join(output, 'server-routes.json'), 'utf8'))
    assert.deepEqual(manifest.routes.map(route => route.asset).sort(), ['server/admin/profile.get.js', 'server/api/profile.get.js'])
    assert.match(await readFile(join(output, 'server/api/profile.get.js'), 'utf8'), /scope: "api"/)
    assert.match(await readFile(join(output, 'server/admin/profile.get.js'), 'utf8'), /scope: "admin"/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('packages server plugins separately from request routes', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-server-plugin-assets-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'server/plugins'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<template><main>Server plugin test</main></template>')
    await writeFile(join(root, 'server/plugins/request.ts'), 'export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook("request", (event) => { event.context.ready = true }) })')
    const output = join(root, 'assets')
    await run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, output], { cwd: process.cwd() })
    const manifest = JSON.parse(await readFile(join(output, 'server-plugins.json'), 'utf8'))
    assert.deepEqual(manifest.plugins, [{ name: 'request', asset: 'server/plugins/request.js', handler: '__nuxtServerHandler' }])
    assert.match(await readFile(join(output, 'server/plugins/request.js'), 'utf8'), /__nuxtRegisterServerHook/)
    const routes = JSON.parse(await readFile(join(output, 'server-routes.json'), 'utf8'))
    assert.equal(routes.routes.some(route => route.asset.includes('/plugins/')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects duplicate server method and path definitions', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-server-collision-test-'))
  try {
    await mkdir(join(root, 'app/pages'), { recursive: true })
    await mkdir(join(root, 'server/profile'), { recursive: true })
    await writeFile(join(root, 'app/pages/index.vue'), '<template><main>Server collision test</main></template>')
    await writeFile(join(root, 'server/profile.get.ts'), 'export default defineEventHandler(() => ({ scope: "root" }))')
    await writeFile(join(root, 'server/profile/index.get.ts'), 'export default defineEventHandler(() => ({ scope: "nested" }))')
    await assert.rejects(
      run(process.execPath, [join(process.cwd(), 'src/generate-fixtures.mjs'), root, join(root, 'assets')], { cwd: process.cwd() }),
      /Duplicate server route "GET \/profile".*(?:profile\.get\.ts|profile[\\/]index\.get\.ts).*(?:profile\.get\.ts|profile[\\/]index\.get\.ts)/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
