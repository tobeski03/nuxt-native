import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultActivity, findAndroidSdk, findAndroidTool, findGradleTool, parseDevices, selectDevice } from '../src/android-tools.mjs'

test('selects authorized Android devices deterministically', () => {
  const output = 'List of devices attached\nphone-1\tdevice\nphone-2\toffline\n'
  assert.deepEqual(parseDevices(output), ['phone-1'])
  assert.equal(selectDevice(output), 'phone-1')
  assert.equal(selectDevice(output, 'phone-1'), 'phone-1')
  assert.throws(() => selectDevice(output, 'phone-2'), /not connected/)
})

test('requires an explicit serial when multiple devices are ready', () => {
  const output = 'List of devices attached\nphone-1\tdevice\nphone-2\tdevice\n'
  assert.throws(() => selectDevice(output), /Multiple Android devices/)
})

test('builds the default native activity component', () => {
  assert.equal(defaultActivity(), 'com.nuxtnative.prototype/.MainActivity')
  assert.equal(defaultActivity('com.example.app'), 'com.example.app/com.nuxtnative.prototype.MainActivity')
})

test('exposes SDK discovery without requiring a project-local path', () => {
  assert.ok(findAndroidSdk() === null || typeof findAndroidSdk() === 'string')
})

test('honors an explicit Gradle launcher path', async () => {
  assert.equal(await findGradleTool('C:/project/android', process.execPath), process.execPath)
})

test('honors machine-level Nuxt-native tool overrides', async () => {
  const previous = {
    sdk: process.env.NUXT_NATIVE_ANDROID_SDK,
    adb: process.env.NUXT_NATIVE_ADB,
    gradle: process.env.NUXT_NATIVE_GRADLE
  }
  try {
    process.env.NUXT_NATIVE_ANDROID_SDK = 'C:/configured/android-sdk'
    process.env.NUXT_NATIVE_ADB = process.execPath
    process.env.NUXT_NATIVE_GRADLE = process.execPath
    assert.equal(findAndroidSdk(), 'C:/configured/android-sdk')
    assert.equal(await findAndroidTool('adb'), process.execPath)
    assert.equal(await findGradleTool('C:/project/android'), process.execPath)
  } finally {
    for (const [name, value] of Object.entries({
      NUXT_NATIVE_ANDROID_SDK: previous.sdk,
      NUXT_NATIVE_ADB: previous.adb,
      NUXT_NATIVE_GRADLE: previous.gradle
    })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
