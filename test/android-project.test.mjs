import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAndroidProject } from '../src/android-project.mjs'

test('creates a clean Android host without copying build state', async () => {
  const output = await mkdtemp(join(tmpdir(), 'nuxt-native-host-'))
  const generated = join(output, 'android')
  try {
    await createAndroidProject({
      templateRoot: join(process.cwd(), 'android'),
      outputRoot: generated
    })
    assert.match(await readFile(join(generated, '.nuxt-native-host.json'), 'utf8'), /nuxt-native/)
    assert.equal(await readFile(join(generated, 'settings.gradle'), 'utf8').then(Boolean), true)
    assert.equal(await readFile(join(generated, 'gradlew.bat')).then(Boolean), true)
    assert.equal(await readFile(join(generated, 'gradle/wrapper/gradle-wrapper.properties')).then(Boolean), true)
    await assert.rejects(readFile(join(generated, 'local.properties')))
    await assert.rejects(readFile(join(generated, 'app/build', 'missing.txt')))
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('uses the Android API-compatible weighted Typeface overload', async () => {
  const renderer = await readFile(join(process.cwd(), 'android/app/src/main/java/com/nuxtnative/prototype/NativeRenderer.java'), 'utf8')
  assert.match(renderer, /Typeface base = Typeface\.create\("sans-serif", Typeface\.NORMAL\)/)
  assert.match(renderer, /Typeface\.create\(base, Math\.max\(100, Math\.min\(900, weight\)\), false\)/)
  assert.doesNotMatch(renderer, /Typeface\.create\("sans-serif", Math\.max\(100, Math\.min\(900, weight\)\), false\)/)
})
