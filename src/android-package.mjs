import { join } from 'node:path'

export function packageTask(profile = 'release', format = 'apk') {
  const normalizedProfile = profile.toLowerCase()
  if (!['debug', 'release'].includes(normalizedProfile)) throw new Error(`Unsupported Android profile: ${profile}`)
  if (!['apk', 'aab'].includes(format)) throw new Error(`Unsupported Android package format: ${format}`)
  return format === 'aab' ? `:app:bundle${normalizedProfile[0].toUpperCase()}${normalizedProfile.slice(1)}` : `:app:assemble${normalizedProfile[0].toUpperCase()}${normalizedProfile.slice(1)}`
}

export function packageArtifact(root, profile = 'release', format = 'apk') {
  const normalizedProfile = profile.toLowerCase()
  return format === 'aab'
    ? join(root, `app/build/outputs/bundle/${normalizedProfile}/app-${normalizedProfile}.aab`)
    : join(root, `app/build/outputs/apk/${normalizedProfile}/app-${normalizedProfile}.apk`)
}

export function signingEnvironmentPresent(env = process.env) {
  return ['NUXT_NATIVE_RELEASE_STORE_FILE', 'NUXT_NATIVE_RELEASE_STORE_PASSWORD', 'NUXT_NATIVE_RELEASE_KEY_ALIAS', 'NUXT_NATIVE_RELEASE_KEY_PASSWORD'].every(name => Boolean(env[name]))
}
