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
    await assert.rejects(readFile(join(generated, 'local.properties')))
    await assert.rejects(readFile(join(generated, 'app/build', 'missing.txt')))
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
