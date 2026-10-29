import { join, resolve } from 'node:path'

// Keep non-sensitive framework services available in a fresh project. Device,
// storage, media, notifications, and permissions remain explicit opt-ins.
export const defaultNativeCapabilities = ['core', 'network', 'dialog']

const defaultAndroidConfig = {
  applicationId: 'com.nuxtnative.prototype',
  label: 'Nuxt-native',
  versionCode: 1,
  versionName: '0.1.0',
  minSdk: 26,
  targetSdk: 36,
  manifestPath: 'android/app/src/main/AndroidManifest.xml',
  gradlePath: 'android/app/build.gradle',
  settingsPath: 'android/settings.gradle',
  iconResource: '@mipmap/ic_launcher',
  deepLinks: [],
  release: { minifyEnabled: false, shrinkResources: false }
}

export function normalizeNativeConfig(configured = {}) {
  const android = configured.android && typeof configured.android === 'object'
    ? configured.android
    : {}
  const { capabilities: _capabilities, permissions: _permissions, manifest: _manifest, gradle: _gradle, settings: _settings, ...androidIdentity } = android
  const androidConfig = {
    ...defaultAndroidConfig,
    ...androidIdentity,
    manifestPath: android.manifest === false
      ? null
      : (typeof android.manifest === 'string' ? android.manifest : defaultAndroidConfig.manifestPath),
    gradlePath: typeof android.gradle === 'string' ? android.gradle : defaultAndroidConfig.gradlePath,
    settingsPath: typeof android.settings === 'string' ? android.settings : defaultAndroidConfig.settingsPath
  }
  androidConfig.deepLinks = Array.isArray(android.deepLinks)
    ? android.deepLinks.filter(link => link && typeof link === 'object' && typeof link.scheme === 'string' && link.scheme.trim()).map(link => ({
      scheme: link.scheme.trim(),
      ...(typeof link.host === 'string' && link.host.trim() ? { host: link.host.trim() } : {}),
      ...(typeof link.pathPrefix === 'string' && link.pathPrefix.trim() ? { pathPrefix: link.pathPrefix.trim() } : {})
    }))
    : []
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(androidConfig.applicationId)) {
    throw new Error(`Invalid Android applicationId: ${androidConfig.applicationId}`)
  }
  for (const field of ['versionCode', 'minSdk', 'targetSdk']) {
    if (!Number.isInteger(androidConfig[field]) || androidConfig[field] < 1) throw new Error(`Android ${field} must be a positive integer`)
  }
  const runtimeConfig = configured.runtimeConfig && typeof configured.runtimeConfig === 'object'
    ? configured.runtimeConfig
    : {}
  const publicRuntimeConfig = runtimeConfig.public && typeof runtimeConfig.public === 'object' && !Array.isArray(runtimeConfig.public)
    ? runtimeConfig.public
    : {}
  const theme = configured.theme && typeof configured.theme === 'object' && !Array.isArray(configured.theme)
    ? configured.theme
    : {}
  const themeColors = theme.colors && typeof theme.colors === 'object' && !Array.isArray(theme.colors)
    ? theme.colors
    : {}
  const appConfig = configured.appConfig && typeof configured.appConfig === 'object' && !Array.isArray(configured.appConfig)
    ? configured.appConfig
    : {}
  return {
    capabilities: Array.isArray(configured.capabilities)
      ? configured.capabilities
      : (Array.isArray(android.capabilities) ? android.capabilities : defaultNativeCapabilities),
    permissions: Array.isArray(configured.permissions)
      ? configured.permissions
      : (Array.isArray(android.permissions) ? android.permissions : []),
    runtimeConfig: { public: publicRuntimeConfig },
    appConfig,
    theme: { colors: themeColors },
    android: androidConfig,
    manifestPath: androidConfig.manifestPath
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function renderAndroidPermissionBlock(permissions) {
  const names = [...new Set(permissions.filter(permission => typeof permission === 'string' && permission.trim()))]
  const entries = names.map(permission => `    <uses-permission android:name="${escapeXml(permission)}" />`).join('\n')
  return [
    '    <!-- nuxt-native:permissions:start -->',
    entries,
    '    <!-- nuxt-native:permissions:end -->'
  ].filter(Boolean).join('\n')
}

export function updateAndroidManifest(source, permissions, android = defaultAndroidConfig) {
  const block = renderAndroidPermissionBlock(permissions)
  const markedBlock = /    <!-- nuxt-native:permissions:start -->[\s\S]*?    <!-- nuxt-native:permissions:end -->/
  let updated = markedBlock.test(source) ? source.replace(markedBlock, block) : source

  if (!markedBlock.test(source)) {
    const application = /    <application\b/
    if (!application.test(source)) throw new Error('AndroidManifest.xml must contain an <application> element')
    updated = source.replace(application, `${block}\n    <application`)
  }
  const escapedLabel = escapeXml(android.label)
  const applicationTag = /    <application\b[^>]*>/
  if (!applicationTag.test(updated)) throw new Error('AndroidManifest.xml must contain an <application> element')
  updated = updated.replace(applicationTag, tag => {
    const attributes = [
      ['android:label', escapedLabel],
      ['android:icon', android.iconResource ?? '@mipmap/ic_launcher'],
      ['android:roundIcon', android.iconResource ?? '@mipmap/ic_launcher']
    ]
    let next = tag
    for (const [name, value] of attributes) {
      const attribute = new RegExp(`(${name}=")[^"]*(")`)
      if (attribute.test(next)) next = next.replace(attribute, `$1${value}$2`)
      else next = next.replace(/(\s*>)$/, `\n        ${name}="${value}"$1`)
    }
    return next
  })
  const deepLinkMarker = /        <!-- nuxt-native:deep-links:start -->[\s\S]*?        <!-- nuxt-native:deep-links:end -->\n?/g
  const deepLinks = Array.isArray(android.deepLinks) ? android.deepLinks : []
  if (deepLinks.length) {
    const entries = deepLinks.map(link => [
      '            <intent-filter>',
      '                <action android:name="android.intent.action.VIEW" />',
      '                <category android:name="android.intent.category.DEFAULT" />',
      '                <category android:name="android.intent.category.BROWSABLE" />',
      `                <data android:scheme="${escapeXml(link.scheme)}"${link.host ? ` android:host="${escapeXml(link.host)}"` : ''}${link.pathPrefix ? ` android:pathPrefix="${escapeXml(link.pathPrefix)}"` : ''} />`,
      '            </intent-filter>'
    ].join('\n')).join('\n')
    const block = `        <!-- nuxt-native:deep-links:start -->\n${entries}\n        <!-- nuxt-native:deep-links:end -->`
    if (deepLinkMarker.test(updated)) updated = updated.replace(deepLinkMarker, `${block}\n`)
    else updated = updated.replace(/(        <\/activity>)/, `${block}\n$1`)
  } else {
    updated = updated.replace(deepLinkMarker, '')
  }
  return updated
}

export function updateAndroidGradle(source, android = defaultAndroidConfig) {
  return source
    .replace(/(applicationId\s+['"]).*?(['"])/, `$1${android.applicationId}$2`)
    .replace(/(versionCode\s+)\d+/, `$1${android.versionCode}`)
    .replace(/(versionName\s+['"]).*?(['"])/, `$1${escapeXml(android.versionName)}$2`)
    .replace(/(minSdk\s+)\d+/, `$1${android.minSdk}`)
    .replace(/(targetSdk\s+)\d+/, `$1${android.targetSdk}`)
    .replace(/(release\s*\{[\s\S]*?minifyEnabled\s+)\w+/, `$1${android.release?.minifyEnabled === true}`)
    .replace(/(release\s*\{[\s\S]*?shrinkResources\s+)\w+/, `$1${android.release?.shrinkResources === true}`)
}

export function updateAndroidSettings(source, android = defaultAndroidConfig) {
  const rootName = String(android.label).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'NuxtNative'
  return source.replace(/rootProject\.name\s*=\s*['"][^'"]*['"]/, `rootProject.name = '${rootName}'`)
}

export function resolveManifestPath(projectRoot, manifestPath, options = {}) {
  if (!manifestPath) return null
  const normalized = manifestPath.replaceAll('\\', '/')
  const relativePath = options.stripAndroidPrefix && normalized.startsWith('android/')
    ? normalized.slice('android/'.length)
    : manifestPath
  return resolve(projectRoot, relativePath)
}

export function resolveHostPath(projectRoot, path, options = {}) {
  if (!path) return null
  const normalized = path.replaceAll('\\', '/')
  const relativePath = options.stripAndroidPrefix && normalized.startsWith('android/')
    ? normalized.slice('android/'.length)
    : path
  return resolve(projectRoot, relativePath)
}

export function defaultManifestPath(projectRoot) {
  return join(projectRoot, 'android/app/src/main/AndroidManifest.xml')
}
