import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function findAndroidTool(name, explicitPath = null) {
  const candidates = []
  if (explicitPath) candidates.push(explicitPath)
  if (name === 'adb' && process.env.NUXT_NATIVE_ADB) candidates.push(process.env.NUXT_NATIVE_ADB)
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (sdk && name === 'adb') candidates.push(join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
  if (name === 'adb' && process.platform === 'win32' && process.env.USERPROFILE) {
    candidates.push(join(process.env.USERPROFILE, 'AppData/Local/Android/Sdk/platform-tools/adb.exe'))
  }
  for (const candidate of candidates) if (await isFile(candidate)) return candidate
  return name
}

async function findNamedFile(root, filename, depth = 5) {
  if (!root || depth < 0) return null
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    return null
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return path
  }
  if (depth === 0) return null
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const match = await findNamedFile(join(root, entry.name), filename, depth - 1)
    if (match) return match
  }
  return null
}

/** Resolve a Gradle launcher without requiring a project-local wrapper. */
export async function findGradleTool(projectRoot = null, explicitPath = null) {
  if (explicitPath) return explicitPath
  const executable = process.platform === 'win32' ? 'gradle.bat' : 'gradle'
  const candidates = []
  if (process.env.NUXT_NATIVE_GRADLE) candidates.push(process.env.NUXT_NATIVE_GRADLE)
  if (projectRoot) {
    candidates.push(join(projectRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
  }
  const gradleHome = process.env.GRADLE_HOME
  if (gradleHome) candidates.push(join(gradleHome, 'bin', executable))
  const pathValue = process.env.Path ?? process.env.PATH ?? ''
  for (const directory of pathValue.split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    candidates.push(join(directory, executable))
  }
  if (process.platform === 'win32') {
    const userRoot = process.env.GRADLE_USER_HOME ?? (process.env.USERPROFILE ? join(process.env.USERPROFILE, '.gradle') : null)
    const cached = await findNamedFile(userRoot ? join(userRoot, 'wrapper', 'dists') : null, executable)
    if (cached) candidates.push(cached)
  }
  for (const candidate of candidates) if (await isFile(candidate)) return candidate
  return executable
}

export function findAndroidSdk() {
  if (process.env.NUXT_NATIVE_ANDROID_SDK) return process.env.NUXT_NATIVE_ANDROID_SDK
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME
  if (process.env.ANDROID_SDK_ROOT) return process.env.ANDROID_SDK_ROOT
  if (process.platform === 'win32' && process.env.USERPROFILE) return join(process.env.USERPROFILE, 'AppData/Local/Android/Sdk')
  return null
}

export function parseDevices(output) {
  return output.split(/\r?\n/)
    .slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(parts => parts.length >= 2 && parts[1] === 'device')
    .map(parts => parts[0])
}

export function selectDevice(output, requestedSerial = null) {
  const devices = parseDevices(output)
  if (requestedSerial) {
    if (!devices.includes(requestedSerial)) throw new Error(`Android device ${requestedSerial} is not connected or not authorized`)
    return requestedSerial
  }
  if (devices.length === 0) throw new Error('No authorized Android device or emulator is connected')
  if (devices.length > 1) throw new Error(`Multiple Android devices are connected (${devices.join(', ')}); pass --serial <id>`)
  return devices[0]
}

export function defaultActivity(applicationId = 'com.nuxtnative.prototype', activityPackage = 'com.nuxtnative.prototype') {
  const activityName = activityPackage === applicationId ? '.MainActivity' : `${activityPackage}.MainActivity`
  return `${applicationId}/${activityName}`
}
