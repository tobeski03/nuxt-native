import assert from 'node:assert/strict'
import test from 'node:test'
import { packageArtifact, packageTask, signingEnvironmentPresent } from '../src/android-package.mjs'

test('maps Android package profiles and formats to Gradle tasks', () => {
  assert.equal(packageTask('release', 'apk'), ':app:assembleRelease')
  assert.equal(packageTask('release', 'aab'), ':app:bundleRelease')
  assert.equal(packageTask('debug', 'apk'), ':app:assembleDebug')
  assert.match(packageArtifact('dist/android', 'release', 'aab'), /bundle\\release\\app-release\.aab$/)
  assert.throws(() => packageTask('profile', 'apk'), /Unsupported Android profile/)
})

test('detects complete release signing environment', () => {
  const keys = {
    NUXT_NATIVE_RELEASE_STORE_FILE: 'release.jks',
    NUXT_NATIVE_RELEASE_STORE_PASSWORD: 'store-password',
    NUXT_NATIVE_RELEASE_KEY_ALIAS: 'app',
    NUXT_NATIVE_RELEASE_KEY_PASSWORD: 'key-password'
  }
  assert.equal(signingEnvironmentPresent(keys), true)
  assert.equal(signingEnvironmentPresent({ ...keys, NUXT_NATIVE_RELEASE_KEY_PASSWORD: '' }), false)
})
