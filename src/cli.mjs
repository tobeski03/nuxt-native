#!/usr/bin/env node
import { access, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
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

async function buildProject(values) {
  const androidFlag = values.indexOf('--android-output')
  const androidOutputArg = androidFlag >= 0 ? values[androidFlag + 1] : null
  if (androidFlag >= 0 && !androidOutputArg) throw new Error('--android-output requires a directory')
  const positional = androidFlag >= 0 ? values.slice(0, androidFlag) : values
  const projectRoot = resolve(positional[0] ?? process.cwd())
  const androidOutput = androidOutputArg ? resolve(androidOutputArg) : null
  if (androidOutput) {
    const templateRoot = fileURLToPath(new URL('../android/', import.meta.url))
    await createAndroidProject({ templateRoot, outputRoot: androidOutput })
  }
  const outputDir = resolve(positional[1] ?? (androidOutput ? join(androidOutput, 'app/src/main/assets') : join(projectRoot, 'android/app/src/main/assets')))
  const generator = fileURLToPath(new URL('./generate-fixtures.mjs', import.meta.url))
  runProcess(process.execPath, [generator, projectRoot, outputDir, androidOutput ?? projectRoot], { stdio: 'inherit' })
  return { projectRoot, androidOutput: androidOutput ?? resolve(projectRoot, 'android'), outputDir }
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
  console.log(`Next: cd ${result.root} && nuxt-native build .`)
} else if (command === 'dev') {
  const projectRoot = resolve(args[0] ?? process.cwd())
  const androidOutputArg = optionValue(args, '--android-output')
  const androidOutput = androidOutputArg ? resolve(androidOutputArg) : null
  const buildArgs = androidOutput ? [projectRoot, '--android-output', androidOutput] : [projectRoot]
  await buildProject(buildArgs)
  if (args.includes('--once')) process.exit(0)
  const stop = watchProject(projectRoot, () => buildProject(buildArgs))
  console.log(`[nuxt-native] watching ${projectRoot}`)
  const shutdown = () => { stop(); process.exit(0) }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await new Promise(() => {})
} else if (command === 'run') {
  const projectRoot = resolve(args[0] ?? process.cwd())
  const androidOutputArg = optionValue(args, '--android-output')
  const androidOutput = resolve(androidOutputArg ?? join(projectRoot, 'android'))
  const serial = optionValue(args, '--serial')
  const gradlePath = optionValue(args, '--gradle')
  const adbPath = await findAndroidTool('adb', optionValue(args, '--adb'))
  await buildProject(androidOutputArg ? [projectRoot, '--android-output', androidOutput] : [projectRoot])
  const androidSdk = findAndroidSdk()
  if (androidSdk) await writeFile(join(androidOutput, 'local.properties'), `sdk.dir=${androidSdk.replaceAll('\\', '/')}\n`, 'utf8')
  const gradle = await findGradleTool(androidOutput, gradlePath)
  runProcess(gradle, ['--no-daemon', '--console=plain', ':app:assembleDebug'], { cwd: androidOutput, stdio: 'inherit' })
  const apk = join(androidOutput, 'app/build/outputs/apk/debug/app-debug.apk')
  runProcess(adbPath, ['start-server'], { stdio: 'inherit' })
  const devices = spawnSync(adbPath, ['devices'], { encoding: 'utf8' })
  if (devices.error) throw devices.error
  const selected = selectDevice(devices.stdout ?? '', serial)
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
  console.log('  nuxt-native dev [project-root] [--android-output <directory>] [--once]')
  console.log('  nuxt-native run [project-root] [--android-output <directory>] [--serial <id>] [--gradle <path>] [--adb <path>]')
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
