import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultNativeCapabilities, normalizeNativeConfig, renderAndroidPermissionBlock, updateAndroidGradle, updateAndroidManifest, updateAndroidSettings } from '../src/native-config.mjs'

test('normalizes top-level and android-scoped native configuration', () => {
  assert.deepEqual(normalizeNativeConfig({ runtimeConfig: { public: { apiBase: 'https://api.example.test', featureFlag: true }, privateKey: 'never-bundle' }, android: { capabilities: ['camera'], permissions: ['android.permission.CAMERA'] } }), {
    capabilities: ['camera'],
    permissions: ['android.permission.CAMERA'],
    runtimeConfig: { public: { apiBase: 'https://api.example.test', featureFlag: true } },
    appConfig: {},
    theme: { colors: {} },
    android: {
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
    },
    manifestPath: 'android/app/src/main/AndroidManifest.xml'
  })
  assert.equal(normalizeNativeConfig({ android: { manifest: false } }).manifestPath, null)
})

test('preserves project theme colors for compiler/runtime styling', () => {
  const config = normalizeNativeConfig({ theme: { colors: { brand: { primary: '#123456' } } } })
  assert.deepEqual(config.theme.colors, { brand: { primary: '#123456' } })
})

test('keeps the non-sensitive dialog bridge available by default', () => {
  assert.deepEqual(defaultNativeCapabilities, ['core', 'network', 'dialog'])
  assert.deepEqual(normalizeNativeConfig({}).capabilities, ['core', 'network', 'dialog'])
})

test('normalizes Android deep-link declarations', () => {
  const config = normalizeNativeConfig({ android: { deepLinks: [{ scheme: ' myapp ', host: 'open', pathPrefix: '/' }, { host: 'ignored' }] } })
  assert.deepEqual(config.android.deepLinks, [{ scheme: 'myapp', host: 'open', pathPrefix: '/' }])
})

test('updates only the managed Android permission block', () => {
  const source = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="App">\n    </application>\n</manifest>\n`
  const updated = updateAndroidManifest(source, ['android.permission.CAMERA', 'android.permission.CAMERA'])
  assert.match(updated, /nuxt-native:permissions:start/)
  assert.equal((updated.match(/android.permission.CAMERA/g) ?? []).length, 1)
  const replaced = updateAndroidManifest(updated, ['android.permission.INTERNET'])
  assert.doesNotMatch(replaced, /android.permission.CAMERA/)
  assert.match(replaced, /android.permission.INTERNET/)
  assert.match(renderAndroidPermissionBlock([]), /nuxt-native:permissions:start/)
})

test('writes managed Android deep-link intent filters', () => {
  const source = '<manifest>\n    <application>\n        <activity android:name=".MainActivity">\n        </activity>\n    </application>\n</manifest>\n'
  const updated = updateAndroidManifest(source, [], { label: 'App', iconResource: '@mipmap/ic_launcher', deepLinks: [{ scheme: 'myapp', host: 'open', pathPrefix: '/' }] })
  assert.match(updated, /android:scheme="myapp"/)
  assert.match(updated, /android:pathPrefix="\/"/)
  assert.equal((updated.match(/nuxt-native:deep-links:start/g) ?? []).length, 1)
})

test('applies Android identity metadata to the generated host', () => {
  const android = normalizeNativeConfig({ android: { applicationId: 'com.example.demo', label: 'Demo App', versionCode: 7, versionName: '2.1.0', minSdk: 28, targetSdk: 35 } }).android
  const manifest = updateAndroidManifest('<manifest>\n    <application android:label="Old" />\n</manifest>', [], android)
  assert.match(manifest, /android:label="Demo App"/)
  const gradle = updateAndroidGradle("applicationId 'old.app'\nminSdk 26\ntargetSdk 36\nversionCode 1\nversionName '0.1.0'", android)
  assert.match(gradle, /applicationId 'com.example.demo'/)
  assert.match(gradle, /versionCode 7/)
  assert.match(gradle, /versionName '2.1.0'/)
  assert.match(updateAndroidSettings("rootProject.name = 'Old'", android), /rootProject.name = 'Demo-App'/)
})
