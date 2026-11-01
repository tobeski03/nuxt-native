#!/usr/bin/env node
import { access, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import QRCode from 'qrcode'
import { compileTemplate } from './compiler.mjs'
import { createAndroidProject } from './android-project.mjs'
import { defaultActivity, findAndroidSdk, findAndroidTool, findGradleTool, selectDevice } from './android-tools.mjs'
import { packageArtifact, packageTask, signingEnvironmentPresent } from './android-package.mjs'
import { initProject } from './init-project.mjs'

const [command, ...args] = process.argv.slice(2)

function runProcess(command, commandArgs, options = {}) {
  const isBatch = process.platform === 'win32' && /\.bat$/i.test(command)
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: isBatch ? (process.env.ComSpec ?? 'cmd.exe') : false, ...options })
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
  return result
}

function optionValue(values, name) {
  const index = values.indexOf(name)
  if (index < 0) return null
  if (!values[index + 1]) throw new Error(`${name} requires a value`)
  return values[index + 1]
}

function localNetworkAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  throw new Error('No local network address found. Connect this computer to Wi-Fi or Ethernet first.')
}

function startDevServer(root, port, { wireless = false } = {}) {
  let version = 0
  const token = wireless ? randomBytes(18).toString('base64url') : ''
  const host = wireless ? '0.0.0.0' : '127.0.0.1'
  const address = wireless ? localNetworkAddress() : '127.0.0.1'
  const url = `http://${address}:${port}`
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${address}:${port}`)
      if (token && requestUrl.searchParams.get('token') !== token) {
        response.writeHead(401)
        response.end('Unauthorized')
        return
      }
      const pathname = decodeURIComponent(requestUrl.pathname)
      if (pathname === '/__nuxt_native_hmr') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ version }))
        return
      }
      const relative = pathname.replace(/^\/+/, '')
      if (!relative || relative.includes('..') || relative.includes('\\')) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      const file = resolve(root, relative)
      if (!file.startsWith(resolve(root) + '\\') && !file.startsWith(resolve(root) + '/')) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': relative.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end(body)
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500)
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Dev server error')
    }
  })
  server.listen(port, host)
  return {
    url,
    token,
    connectUrlFor(applicationId = 'com.nuxtnative.prototype') {
      if (!wireless) return ''
      return `intent://connect?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}#Intent;scheme=nuxtnative;package=${encodeURIComponent(applicationId)};end`
    },
    bump() { version += 1 },
    close() { server.close() }
  }
}

async function showWirelessQr(server, applicationId) {
  console.log(`\n[nuxt-native] Scan this QR code with your phone camera to connect HMR:\n`)
  console.log(await QRCode.toString(server.connectUrlFor(applicationId), { type: 'terminal', small: true }))
  console.log(`[nuxt-native] Wireless HMR: ${server.url}\n`)
}

async function applicationIdFor(projectRoot) {
  try {
    const config = JSON.parse(await readFile(join(projectRoot, 'nuxt-native.config.json'), 'utf8'))
    return config.android?.applicationId ?? 'com.nuxtnative.prototype'
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid nuxt-native.config.json: ${error.message}`)
    return 'com.nuxtnative.prototype'
  }
}

async function buildProject(values, options = {}) {
  const androidFlag = values.indexOf('--android-output')
  const androidOutputArg = androidFlag >= 0 ? values[androidFlag + 1] : null
  if (androidFlag >= 0 && !androidOutputArg) throw new Error('--android-output requires a directory')
  const positional = androidFlag >= 0 ? values.slice(0, androidFlag) : values
  const projectRoot = resolve(positional[0] ?? process.cwd())
  const androidOutput = resolve(androidOutputArg ?? join(projectRoot, 'android'))
  const templateRoot = fileURLToPath(new URL('../android/', import.meta.url))
  await createAndroidProject({ templateRoot, outputRoot: androidOutput })
  const outputDir = resolve(positional[1] ?? join(androidOutput, 'app/src/main/assets'))
  const generator = fileURLToPath(new URL('./generate-fixtures.mjs', import.meta.url))
  runProcess(process.execPath, [generator, projectRoot, outputDir, androidOutput ?? projectRoot], { stdio: 'inherit' })
  if (options.devServer) {
    const configFile = join(outputDir, 'native-config.json')
    const config = JSON.parse(await readFile(configFile, 'utf8'))
    config.devServer = options.devServer
    await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }
  return { projectRoot, androidOutput, outputDir }
}

function watchProject(projectRoot, onChange) {
  const watchedPaths = ['app', 'server', 'middleware', 'plugins', 'shared', 'app.config.ts', 'app.config.js', 'app.config.mjs', 'nuxt-native.config.json']
    .map(path => resolve(projectRoot, path))
  const watchers = []
  let timer = null
  let building = false
  let queued = false

  const rebuild = async () => {
    if (building) {
      queued = true
      return
    }
    building = true
    try {
      await onChange()
    } catch (error) {
      console.error(`[nuxt-native] rebuild failed: ${error.message}`)
    } finally {
      building = false
      if (queued) {
        queued = false
        schedule()
      }
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void rebuild() }, 120)
  }

  for (const path of watchedPaths) {
    stat(path).then(info => {
      const watcher = watch(path, { recursive: info.isDirectory() }, (_event, filename) => {
        console.log(`[nuxt-native] changed ${filename ?? path}`)
        schedule()
      })
      watchers.push(watcher)
    }).catch(() => {})
  }
  return () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}

if (command === 'build') {
  await buildProject(args)
} else if (command === 'init') {
  const directory = args[0] ?? 'nuxt-native-app'
  const result = await initProject(directory)
  const templateRoot = fileURLToPath(new URL('../android/', import.meta.url))
  await createAndroidProject({ templateRoot, outputRoot: join(result.root, 'android') })
  console.log(`Created Nuxt-native project in ${result.root}`)
  console.log(`Next: cd ${result.root} && npm install && npm run android`)
} else if (command === 'dev') {
  const projectRoot = resolve(args[0] ?? process.cwd())
  const androidOutputArg = optionValue(args, '--android-output')
  const androidOutput = androidOutputArg ? resolve(androidOutputArg) : null
  const buildArgs = androidOutput ? [projectRoot, '--android-output', androidOutput] : [projectRoot]
  const wireless = args.includes('--qr') || args.includes('--wireless')
  const hmr = args.includes('--hmr') || wireless
  const hmrPort = Number(optionValue(args, '--hmr-port') ?? '38765')
  const hmrServer = hmr ? startDevServer(resolve(androidOutput ?? join(projectRoot, 'android'), 'app/src/main/assets'), hmrPort, { wireless }) : null
  await buildProject(buildArgs, hmrServer ? { devServer: { url: hmrServer.url, token: hmrServer.token } } : {})
  if (wireless) await showWirelessQr(hmrServer, await applicationIdFor(projectRoot))
  if (args.includes('--once')) process.exit(0)
  const stop = watchProject(projectRoot, async () => {
    await buildProject(buildArgs, hmrServer ? { devServer: { url: hmrServer.url, token: hmrServer.token } } : {})
    hmrServer?.bump()
  })
  console.log(`[nuxt-native] watching ${projectRoot}${hmr ? ` with HMR on ${hmrServer.url}` : ''}`)
  const shutdown = () => { stop(); hmrServer?.close(); process.exit(0) }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await new Promise(() => {})
} else if (command === 'run') {
  const projectRoot = resolve(args[0] ?? process.cwd())
  const androidOutputArg = optionValue(args, '--android-output')
  const androidOutput = resolve(androidOutputArg ?? join(projectRoot, 'android'))
  const serial = optionValue(args, '--serial')
  const gradlePath = optionValue(args, '--gradle')
  const wireless = args.includes('--qr') || args.includes('--wireless')
  const hmr = args.includes('--hmr') || wireless
  const hmrPort = Number(optionValue(args, '--hmr-port') ?? '38765')
  const hmrServer = hmr ? startDevServer(join(androidOutput, 'app/src/main/assets'), hmrPort, { wireless }) : null
  const adbPath = await findAndroidTool('adb', optionValue(args, '--adb'))
  const buildArgs = androidOutputArg ? [projectRoot, '--android-output', androidOutput] : [projectRoot]
  await buildProject(buildArgs, hmrServer ? { devServer: { url: hmrServer.url, token: hmrServer.token } } : {})
  const androidSdk = findAndroidSdk()
  if (androidSdk) await writeFile(join(androidOutput, 'local.properties'), `sdk.dir=${androidSdk.replaceAll('\\', '/')}\n`, 'utf8')
  const gradle = await findGradleTool(androidOutput, gradlePath)
  runProcess(gradle, ['--no-daemon', '--console=plain', ':app:assembleDebug'], { cwd: androidOutput, stdio: 'inherit' })
  const apk = join(androidOutput, 'app/build/outputs/apk/debug/app-debug.apk')
  runProcess(adbPath, ['start-server'], { stdio: 'inherit' })
  const devices = spawnSync(adbPath, ['devices'], { encoding: 'utf8' })
  if (devices.error) throw devices.error
  const selected = selectDevice(devices.stdout ?? '', serial)
  if (hmrServer && !wireless) runProcess(adbPath, ['-s', selected, 'reverse', `tcp:${hmrPort}`, `tcp:${hmrPort}`], { stdio: 'inherit' })
  runProcess(adbPath, ['-s', selected, 'install', '-r', apk], { stdio: 'inherit' })
  let applicationId = 'com.nuxtnative.prototype'
  try {
    const config = JSON.parse(await readFile(join(projectRoot, 'nuxt-native.config.json'), 'utf8'))
    applicationId = config.android?.applicationId ?? applicationId
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid nuxt-native.config.json: ${error.message}`)
  }
  runProcess(adbPath, ['-s', selected, 'shell', 'am', 'force-stop', applicationId], { stdio: 'inherit' })
  runProcess(adbPath, ['-s', selected, 'shell', 'am', 'start', '-W', '-n', defaultActivity(applicationId)], { stdio: 'inherit' })
  if (hmrServer) {
    if (wireless) await showWirelessQr(hmrServer, applicationId)
    const stop = watchProject(projectRoot, async () => {
      await buildProject(buildArgs, { devServer: { url: hmrServer.url, token: hmrServer.token } })
      hmrServer.bump()
    })
    console.log(`[nuxt-native] running ${applicationId} with HMR on ${hmrServer.url}`)
    const shutdown = () => { stop(); hmrServer.close(); process.exit(0) }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    await new Promise(() => {})
  }
} else if (command === 'package') {
  const projectRoot = resolve(args[0] ?? process.cwd())
  const androidOutputArg = optionValue(args, '--android-output')
  const androidOutput = resolve(androidOutputArg ?? join(projectRoot, 'android'))
  const gradlePath = optionValue(args, '--gradle')
  const profile = optionValue(args, '--profile') ?? 'release'
  const format = optionValue(args, '--format') ?? 'apk'
  const requireSigning = args.includes('--require-signing')
  if (requireSigning && profile === 'release' && !signingEnvironmentPresent()) throw new Error('Release signing is required but the NUXT_NATIVE_RELEASE_* environment variables are incomplete')
  await buildProject(androidOutputArg ? [projectRoot, '--android-output', androidOutput] : [projectRoot])
  const androidSdk = findAndroidSdk()
  if (androidSdk) await writeFile(join(androidOutput, 'local.properties'), `sdk.dir=${androidSdk.replaceAll('\\', '/')}\n`, 'utf8')
  const gradle = await findGradleTool(androidOutput, gradlePath)
  const gradleArgs = ['--no-daemon', '--console=plain']
  if (profile.toLowerCase() === 'release') gradleArgs.push('-x', 'lintVitalRelease', '-x', 'lintVitalAnalyzeRelease', '-x', 'lintVitalReportRelease')
  gradleArgs.push(packageTask(profile, format))
  runProcess(gradle, gradleArgs, { cwd: androidOutput, stdio: 'inherit' })
  console.log(`Generated ${packageArtifact(androidOutput, profile, format)}`)
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log('Usage:')
  console.log('  nuxt-native init [directory]')
  console.log('  nuxt-native build [project-root] [android-assets-output]')
  console.log('  nuxt-native build [project-root] --android-output <directory>')
  console.log('  nuxt-native dev [project-root] [--android-output <directory>] [--hmr|--qr] [--hmr-port <port>] [--once]')
  console.log('  nuxt-native run [project-root] [--android-output <directory>] [--serial <id>] [--gradle <path>] [--adb <path>] [--hmr|--qr] [--hmr-port <port>]')
  console.log('  nuxt-native package [project-root] [--android-output <directory>] [--profile debug|release] [--format apk|aab] [--gradle <path>] [--require-signing]')
  console.log('  npm run compile:example -- <component.vue>')
} else {
  const file = command
  if (!file) throw new Error('Usage: nuxt-native build [project-root] [android-assets-output]')

  const source = await readFile(file, 'utf8')
  const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1]
  if (!template) throw new Error(`No <template> found in ${file}`)

  console.log(JSON.stringify(compileTemplate(template), null, 2))
}
