import { cp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { compileScopedTemplate, compileTemplate } from './compiler.mjs'
import { componentName } from './framework/components.mjs'
import { compilePageScript } from './script-compiler.mjs'
import { compileServerDirectory, compileServerRoute, discoverServerMiddleware, discoverServerPlugins, discoverServerUtils } from './server-compiler.mjs'
import { compileRouteMiddleware, middlewareName } from './middleware-compiler.mjs'
import { compilePlugin, pluginName } from './plugin-compiler.mjs'
import { createRouteManifest } from './framework/router.mjs'
import { normalizeNativeConfig, resolveHostPath, resolveManifestPath, updateAndroidGradle, updateAndroidManifest, updateAndroidSettings } from './native-config.mjs'
import { generateAndroidResources } from './android-resources.mjs'

async function findPages(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory()) files.push(...await findPages(path))
    else if (/\.(vue|js|ts|jsx|tsx)$/.test(entry.name)) files.push(path)
  }
  return files
}


const projectRoot = resolve(process.argv[2] ?? process.cwd())
const outputDir = resolve(process.argv[3] ?? join(projectRoot, 'android/app/src/main/assets'))
const manifestRoot = resolve(process.argv[4] ?? projectRoot)
const pageRoots = [join(projectRoot, 'app/pages'), join(projectRoot, 'pages')]
const pageFiles = (await Promise.all(pageRoots.map(findPages))).flat()
const routeManifest = createRouteManifest(pageFiles.map(file => file.replace(/\\/g, '/')))
if (!routeManifest.length) throw new Error(`No pages found under ${pageRoots.join(' or ')}`)
const routePaths = new Map()
for (const route of routeManifest) {
  const previous = routePaths.get(route.path)
  if (previous) throw new Error(`Duplicate page route "${route.path}" from ${previous} and ${route.file}`)
  routePaths.set(route.path, route.file)
}
const fixtures = routeManifest.map(route => ({
  source: route.file,
  name: route.name,
  path: route.path,
  asset: `${route.name || 'index'}.ir.json`
}))
const serverOutputDir = join(outputDir, 'server')
const serverMiddlewareOutputDir = join(serverOutputDir, 'middleware')
const serverPluginOutputDir = join(serverOutputDir, 'plugins')
const middlewareOutputDir = join(outputDir, 'middleware')
const pluginOutputDir = join(outputDir, 'plugins')
let nativeConfig = normalizeNativeConfig()
let configuredNative = {}
try {
  configuredNative = JSON.parse(await readFile(join(projectRoot, 'nuxt-native.config.json'), 'utf8'))
  nativeConfig = normalizeNativeConfig(configuredNative)
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error(`Invalid nuxt-native.config.json: ${error.message}`)
}

async function readProjectStaticConfig(root, candidates, name) {
  let filename
  for (const candidate of candidates) {
    try {
      filename = join(root, candidate)
      const source = await readFile(filename, 'utf8')
      const compiled = await transform(source, { loader: filename.endsWith('.ts') ? 'ts' : 'js', format: 'cjs', platform: 'node', target: 'es2020', sourcefile: filename })
      const module = { exports: {} }
      const context = {
        module,
        exports: module.exports,
        defineAppConfig: value => value,
        defineNuxtConfig: value => value
      }
      vm.runInNewContext(compiled.code, context, { filename, timeout: 1000 })
      const value = module.exports?.default ?? module.exports
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must export an object`)
      return value
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw new Error(`Invalid ${filename}: ${error.message}`)
    }
  }
  return {}
}

const projectNuxtConfig = await readProjectStaticConfig(projectRoot, ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'], 'nuxt config')
const projectAppConfig = await readProjectStaticConfig(projectRoot, ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app/app.config.ts', 'app/app.config.js', 'app/app.config.mjs'], 'app config')
const mergedRuntimeConfig = {
  ...(projectNuxtConfig.runtimeConfig ?? {}),
  ...(configuredNative.runtimeConfig ?? {}),
  public: {
    ...(projectNuxtConfig.runtimeConfig?.public ?? {}),
    ...(configuredNative.runtimeConfig?.public ?? {})
  }
}
const mergedAppConfig = {
  ...(projectNuxtConfig.appConfig ?? {}),
  ...projectAppConfig,
  ...(configuredNative.appConfig ?? {})
}
if (Object.keys(mergedAppConfig).length || Object.keys(mergedRuntimeConfig.public).length || Object.keys(configuredNative.appConfig ?? {}).length) {
  nativeConfig = normalizeNativeConfig({
    ...configuredNative,
    runtimeConfig: mergedRuntimeConfig,
    appConfig: mergedAppConfig
  })
}

await mkdir(outputDir, { recursive: true })
await mkdir(serverOutputDir, { recursive: true })
await mkdir(serverMiddlewareOutputDir, { recursive: true })
await mkdir(serverPluginOutputDir, { recursive: true })
await mkdir(middlewareOutputDir, { recursive: true })
await mkdir(pluginOutputDir, { recursive: true })

async function removeManifestAssets(manifestPath, key) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const entry of manifest[key] ?? []) {
      if (typeof entry?.asset !== 'string' || entry.asset.includes('..') || entry.asset.startsWith('/') || entry.asset.startsWith('\\')) continue
      try { await unlink(join(outputDir, entry.asset)) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

await removeManifestAssets(join(outputDir, 'server-routes.json'), 'routes')
await removeManifestAssets(join(outputDir, 'server-middleware.json'), 'middleware')
await removeManifestAssets(join(outputDir, 'server-plugins.json'), 'plugins')
for (const entry of await readdir(outputDir)) {
  if (/\.(?:ir\.json|script\.js|script\.json)$/.test(entry) || entry === 'routes.json' || entry === 'server-routes.json' || entry === 'server-middleware.json' || entry === 'server-plugins.json' || entry === 'middleware.json' || entry === 'plugins.json' || entry === 'native-config.json') {
    await unlink(join(outputDir, entry))
  }
}
for (const entry of await readdir(serverMiddlewareOutputDir)) await unlink(`${serverMiddlewareOutputDir}/${entry}`)
for (const entry of await readdir(serverPluginOutputDir)) await unlink(join(serverPluginOutputDir, entry))
for (const entry of await readdir(middlewareOutputDir)) await unlink(join(middlewareOutputDir, entry))
for (const entry of await readdir(pluginOutputDir)) await unlink(join(pluginOutputDir, entry))

// Nuxt's public directory is copied into the Android assets bundle. Keep a
// manifest so rebuilding removes files that no longer exist without touching
// unrelated generated assets.
const publicOutputDir = join(outputDir, 'public')
const publicManifestPath = join(outputDir, 'public-assets.json')
let previousPublicAssets = []
try {
  previousPublicAssets = JSON.parse(await readFile(publicManifestPath, 'utf8')).files ?? []
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
for (const file of previousPublicAssets) {
  if (typeof file !== 'string' || file.includes('..') || file.startsWith('/') || file.startsWith('\\')) continue
  await rm(join(publicOutputDir, file), { force: true })
}

async function findPublicFiles(root, relative = '') {
  const files = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return files
    throw error
  }
  for (const entry of entries) {
    const current = join(root, entry.name)
    const publicPath = relative ? join(relative, entry.name) : entry.name
    if (entry.isDirectory()) files.push(...await findPublicFiles(current, publicPath))
    else if (entry.isFile()) files.push({ source: current, path: publicPath.replace(/\\/g, '/') })
  }
  return files
}

const publicFiles = await findPublicFiles(join(projectRoot, 'public'))
for (const file of publicFiles) {
  const destination = join(publicOutputDir, file.path)
  await mkdir(resolve(destination, '..'), { recursive: true })
  await cp(file.source, destination)
}
await writeFile(publicManifestPath, `${JSON.stringify({ files: publicFiles.map(file => file.path) }, null, 2)}\n`, 'utf8')

async function readTemplate(file) {
  const source = await readFile(file, 'utf8')
  const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1]
  if (!template) throw new Error(`No <template> found in ${file}`)
  return template
}

async function readVueDescriptor(file) {
  const source = await readFile(file, 'utf8')
  const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1]
  if (!template) throw new Error(`No <template> found in ${file}`)
  const scriptTag = source.match(/<script setup([^>]*)>/)?.[1] ?? ''
  return {
    template,
    script: source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '',
    language: /\blang=["']ts["']/i.test(scriptTag) ? 'ts' : 'js'
  }
}

const componentTemplates = {}
for (const componentRoot of [join(projectRoot, 'app/components'), join(projectRoot, 'components')]) {
  for (const file of (await findPages(componentRoot)).filter(file => file.endsWith('.vue'))) {
    const source = await readFile(file, 'utf8')
    const scriptTag = source.match(/<script setup([^>]*)>/)?.[1] ?? ''
    const name = componentName(file, componentRoot)
    if (componentTemplates[name]) throw new Error(`Duplicate auto-imported component "${name}" from ${file}`)
    componentTemplates[name] = {
      filename: file,
      template: source.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? '',
      script: source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '',
      language: /\blang=["']ts["']/i.test(scriptTag) ? 'ts' : 'js'
    }
  }
}
const templateOptions = { strict: true, components: componentTemplates, colors: nativeConfig.theme?.colors ?? {}, projectRoot }

const autoImportSources = []
for (const root of ['app/composables', 'composables', 'app/utils', 'utils', 'shared/utils'].map(directory => join(projectRoot, directory))) {
  for (const file of (await findPages(root)).filter(file => /\.(?:js|ts|mjs|cjs)$/.test(file))) {
    const source = await readFile(file, 'utf8')
    autoImportSources.push({
      filename: file,
      projectRoot,
      source,
      language: /\.ts$/.test(file) ? 'ts' : 'js'
    })
  }
}

const middlewareFiles = []
for (const root of [join(projectRoot, 'app/middleware'), join(projectRoot, 'middleware')]) {
  middlewareFiles.push(...(await findPages(root)).filter(file => !file.endsWith('.d.ts')))
}
const middlewareManifest = []
for (const file of middlewareFiles) {
  const source = await readFile(file, 'utf8')
  const compiled = await compileRouteMiddleware(source, { filename: file, name: middlewareName(file) })
  const asset = `middleware/${compiled.name}.js`
  await writeFile(join(outputDir, asset), `${compiled.code}\n`, 'utf8')
  middlewareManifest.push({ name: compiled.name, asset, global: compiled.global })
}
const middlewareByName = new Map(middlewareManifest.map(entry => [entry.name, entry]))

function pageMiddleware(source) {
  const match = source.match(/definePageMeta\s*\(\s*\{([\s\S]*?)\}\s*\)/)
  if (!match) return []
  const value = match[1].match(/middleware\s*:\s*\[([^\]]*)\]/)?.[1]
  if (!value) return []
  return [...value.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]).filter(name => middlewareByName.has(name))
}

function pageLayoutName(source) {
  const match = source.match(/definePageMeta\s*\(\s*\{[\s\S]*?\blayout\s*:\s*(false|['"]([^'"]+)['"])/)
  if (!match) return 'default'
  return match[1] === 'false' ? false : match[2]
}

function composeLayout(layout, page) {
  if (!layout) return page
  const instance = JSON.parse(JSON.stringify(layout))
  const replaceSlot = node => {
    if (!node || typeof node !== 'object') return node
    if (node.type === 'slot') return page.nodes[0]
    if (Array.isArray(node.children)) node.children = node.children.map(replaceSlot)
    return node
  }
  return {
    ...instance,
    nodes: instance.nodes.map(replaceSlot),
    componentScripts: [...(layout.componentScripts ?? []), ...(page.componentScripts ?? [])]
  }
}

function composeAppShell(app, layout, page) {
  if (!app) return layout ?? page
  const instance = JSON.parse(JSON.stringify(app))
  const replaceHosts = node => {
    if (!node || typeof node !== 'object') return node
    if (node.type === 'router-outlet') return page.nodes[0]
    if (node.type === 'layout-host' && layout) return layout.nodes[0]
    if (Array.isArray(node.children)) node.children = node.children.map(replaceHosts)
    return node
  }
  return {
    ...instance,
    nodes: instance.nodes.map(replaceHosts),
    componentScripts: [
      ...(layout?.componentScripts ?? []),
      ...(app.componentScripts ?? [])
    ]
  }
}

function collectInlineActions(document) {
  const actions = []
  let next = 0
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value.props && typeof value.props === 'object') {
      for (const [key, expression] of Object.entries(value.props)) {
        if (!key.startsWith('@') || typeof expression !== 'string') continue
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expression)) continue
        const name = `__nuxtInlineAction${next++}`
        value.props[key] = name
        actions.push({ name, expression })
      }
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(document)
  return actions
}

const layouts = new Map()
const shellContext = { next: 0, scripts: [], scopeNext: 0 }
for (const layoutRoot of [join(projectRoot, 'app/layouts'), join(projectRoot, 'layouts')]) {
  for (const file of (await findPages(layoutRoot)).filter(file => file.endsWith('.vue'))) {
    const descriptor = await readVueDescriptor(file)
    const layoutName = basename(file, '.vue')
    if (layouts.has(layoutName)) throw new Error(`Duplicate layout "${layoutName}" from ${file}`)
    layouts.set(layoutName, compileScopedTemplate(descriptor.template, descriptor.script, {
      ...templateOptions,
      componentContext: shellContext,
      scopePrefix: `__nuxtLayout_${layoutName}`,
      filename: file,
      language: descriptor.language
    }))
  }
}

let appShell
for (const appFile of [join(projectRoot, 'app/app.vue'), join(projectRoot, 'app.vue')]) {
  try {
    const descriptor = await readVueDescriptor(appFile)
    if (appShell) throw new Error(`Duplicate app shell definitions: ${appFile}`)
  appShell = compileScopedTemplate(descriptor.template, descriptor.script, {
    ...templateOptions,
    componentContext: shellContext,
    scopePrefix: '__nuxtApp',
    filename: appFile,
    language: descriptor.language
  })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

let errorFile
for (const candidate of [join(projectRoot, 'app/error.vue'), join(projectRoot, 'error.vue')]) {
  try {
    await readFile(candidate, 'utf8')
    if (errorFile) throw new Error(`Duplicate error surfaces: ${candidate}`)
    errorFile = candidate
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
if (errorFile) {
  const errorSource = await readFile(errorFile, 'utf8')
  const errorDocument = compileTemplate(await readTemplate(errorFile), { ...templateOptions, componentContext: shellContext })
  await writeFile(join(outputDir, 'error.ir.json'), `${JSON.stringify(errorDocument, null, 2)}\n`, 'utf8')
  const errorScript = await compilePageScript(errorSource, {
    filename: errorFile,
    projectRoot,
    componentScripts: errorDocument.componentScripts ?? [],
    autoImports: autoImportSources,
    inlineActions: collectInlineActions(errorDocument)
  })
  if (errorScript) {
    const errors = (errorScript.diagnostics ?? []).filter(diagnostic => diagnostic.level === 'error')
    if (errors.length) throw new Error(errors.map(diagnostic => diagnostic.message).join('; '))
    await writeFile(join(outputDir, 'error.script.js'), `${errorScript.code}\n`, 'utf8')
    await writeFile(join(outputDir, 'error.script.json'), `${JSON.stringify({ actions: errorScript.actions, stateRefs: errorScript.stateRefs, language: errorScript.language }, null, 2)}\n`, 'utf8')
  }
}

for (const fixture of fixtures) {
  const source = await readFile(fixture.source, 'utf8')
  fixture.middleware = [
    ...middlewareManifest.filter(entry => entry.global).map(entry => entry.name),
    ...pageMiddleware(source)
  ]
  const pageDocument = compileTemplate(await readTemplate(fixture.source), { ...templateOptions, componentContext: shellContext })
  const layoutName = pageLayoutName(source)
  const selectedLayout = layoutName === false ? null : layouts.get(layoutName)
  if (layoutName !== false && layoutName !== 'default' && !selectedLayout) {
    throw new Error(`Unknown app layout "${layoutName}" requested by ${fixture.source}`)
  }
  const layoutDocument = composeLayout(selectedLayout, pageDocument)
  const document = composeAppShell(appShell, layoutDocument, pageDocument)
  const inlineActions = collectInlineActions(document)
  await writeFile(`${outputDir}/${fixture.asset}`, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  const script = await compilePageScript(source, {
    filename: fixture.source,
    projectRoot,
    componentScripts: document.componentScripts ?? [],
    autoImports: autoImportSources,
    inlineActions
  })
  if (script) {
    const errors = (script.diagnostics ?? []).filter(diagnostic => diagnostic.level === 'error')
    if (errors.length) throw new Error(errors.map(diagnostic => diagnostic.message).join('; '))
    const scriptAsset = fixture.asset.replace('.ir.json', '.script.js')
    await writeFile(`${outputDir}/${scriptAsset}`, `${script.code}\n`, 'utf8')
    await writeFile(`${outputDir}/${scriptAsset.replace('.js', '.json')}`, `${JSON.stringify({ actions: script.actions, stateRefs: script.stateRefs, language: script.language }, null, 2)}\n`, 'utf8')
  }
}

await writeFile(`${outputDir}/routes.json`, `${JSON.stringify({ routes: fixtures.map(({ name, path, asset, middleware }) => ({ name, path, asset, middleware })) }, null, 2)}\n`, 'utf8')
await writeFile(`${outputDir}/middleware.json`, `${JSON.stringify({ middleware: middlewareManifest }, null, 2)}\n`, 'utf8')

const pluginFiles = []
for (const root of [join(projectRoot, 'app/plugins'), join(projectRoot, 'plugins')]) {
  pluginFiles.push(...(await findPages(root)).filter(file => !file.endsWith('.d.ts')))
}
const pluginManifest = []
for (const file of pluginFiles) {
  const source = await readFile(file, 'utf8')
  const compiled = await compilePlugin(source, { filename: file, name: pluginName(file) })
  const asset = `plugins/${compiled.name}.js`
  await writeFile(`${outputDir}/${asset}`, `${compiled.code}\n`, 'utf8')
  pluginManifest.push({ name: compiled.name, asset })
}
await writeFile(`${outputDir}/plugins.json`, `${JSON.stringify({ plugins: pluginManifest }, null, 2)}\n`, 'utf8')

const serverUtilityFiles = await discoverServerUtils(join(projectRoot, 'server/utils'))
const serverUtilities = await Promise.all(serverUtilityFiles.map(async filename => ({ filename, source: await readFile(filename, 'utf8') })))
const serverRoutes = await compileServerDirectory(join(projectRoot, 'server'), { utilities: serverUtilities })
const serverManifest = []
for (const route of serverRoutes) {
  const asset = `server/${route.file.replace(/\.(?:[cm]?[jt]s|tsx?)$/i, '.js')}`
  await mkdir(dirname(join(outputDir, asset)), { recursive: true })
  await writeFile(`${outputDir}/${asset}`, `${route.compiled.code}\n`, 'utf8')
  serverManifest.push({ path: route.path, method: route.method, asset, handler: route.compiled.handler, mode: route.compiled.mode })
}
await writeFile(`${outputDir}/server-routes.json`, `${JSON.stringify({ routes: serverManifest }, null, 2)}\n`, 'utf8')

const serverMiddlewareManifest = []
try {
  for (const middleware of await discoverServerMiddleware(join(projectRoot, 'server/middleware'))) {
    const source = await readFile(middleware.file, 'utf8')
    const compiled = await compileServerRoute(source, { filename: middleware.file, utilities: serverUtilities })
    const relativeMiddleware = relative(join(projectRoot, 'server/middleware'), middleware.file).replace(/\\/g, '/')
    const asset = `server/middleware/${relativeMiddleware.replace(/\.(?:[cm]?[jt]s|tsx?)$/i, '.js')}`
    await mkdir(dirname(join(outputDir, asset)), { recursive: true })
    await writeFile(`${outputDir}/${asset}`, `${compiled.code}\n`, 'utf8')
    serverMiddlewareManifest.push({ name: relativeMiddleware.replace(/\.(?:[cm]?[jt]s|tsx?)$/i, ''), asset, handler: compiled.handler })
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await writeFile(`${outputDir}/server-middleware.json`, `${JSON.stringify({ middleware: serverMiddlewareManifest }, null, 2)}\n`, 'utf8')

const serverPluginManifest = []
try {
  for (const plugin of await discoverServerPlugins(join(projectRoot, 'server/plugins'))) {
    const source = await readFile(plugin.file, 'utf8')
    const compiled = await compileServerRoute(source, { filename: plugin.file, utilities: serverUtilities })
    const asset = `server/plugins/${plugin.name}.js`
    await mkdir(dirname(join(outputDir, asset)), { recursive: true })
    await writeFile(join(outputDir, asset), `${compiled.code}\n`, 'utf8')
    serverPluginManifest.push({ name: plugin.name, asset, handler: compiled.handler })
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await writeFile(`${outputDir}/server-plugins.json`, `${JSON.stringify({ plugins: serverPluginManifest }, null, 2)}\n`, 'utf8')
if (nativeConfig.manifestPath) {
  const resourceHostRoot = manifestRoot === projectRoot ? join(projectRoot, 'android') : manifestRoot
  const generatedResources = await generateAndroidResources({ projectRoot, hostRoot: resourceHostRoot, android: nativeConfig.android })
  nativeConfig.android = { ...nativeConfig.android, ...generatedResources }
}
await writeFile(join(outputDir, 'native-config.json'), `${JSON.stringify({ capabilities: nativeConfig.capabilities, permissions: nativeConfig.permissions, runtimeConfig: nativeConfig.runtimeConfig, appConfig: nativeConfig.appConfig, theme: nativeConfig.theme, android: nativeConfig.android }, null, 2)}\n`, 'utf8')
if (nativeConfig.manifestPath) {
  const manifestPath = resolveManifestPath(manifestRoot, nativeConfig.manifestPath, { stripAndroidPrefix: manifestRoot !== projectRoot })
  try {
    const manifest = await readFile(manifestPath, 'utf8')
    await writeFile(manifestPath, updateAndroidManifest(manifest, nativeConfig.permissions, nativeConfig.android), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.warn(`Android manifest not found at ${manifestPath}; skipped generated permission declarations.`)
  }
}
const hostPathOptions = { stripAndroidPrefix: manifestRoot !== projectRoot }
for (const [pathKey, updater] of [
  ['gradlePath', updateAndroidGradle],
  ['settingsPath', updateAndroidSettings]
]) {
  const path = resolveHostPath(manifestRoot, nativeConfig.android[pathKey], hostPathOptions)
  try {
    const source = await readFile(path, 'utf8')
    await writeFile(path, updater(source, nativeConfig.android), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.warn(`Android host file not found at ${path}; skipped generated identity metadata.`)
  }
}
console.log(`Generated ${fixtures.length} native route fixtures in ${outputDir}`)
