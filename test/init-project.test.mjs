import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { initProject } from '../src/init-project.mjs'

test('initializes a project with the default non-sensitive capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuxt-native-init-'))
  try {
    const result = await initProject(root)
    const config = JSON.parse(await readFile(join(root, 'nuxt-native.config.json'), 'utf8'))
    assert.equal(result.root, root)
    assert.deepEqual(config.capabilities, ['core', 'network', 'dialog'])
    assert.ok(result.files.includes('app/pages/index.vue'))
    assert.ok(result.files.includes('app.config.ts'))
    assert.match(await readFile(join(root, 'app.config.ts'), 'utf8'), /defineAppConfig/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
