import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { generateAndroidResources, normalizeAndroidResources } from '../src/android-resources.mjs'

test('generates theme, adaptive icon, and splash resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuxt-native-res-'))
  try {
    const result = await generateAndroidResources({
      projectRoot: root,
      hostRoot: root,
      android: { theme: { primary: '#123456' } }
    })
    assert.equal(result.iconResource, '@mipmap/ic_launcher')
    assert.match(await readFile(join(root, 'app/src/main/res/values/colors.xml'), 'utf8'), /#123456/)
    assert.match(await readFile(join(root, 'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'), 'utf8'), /adaptive-icon/)
    assert.match(await readFile(join(root, 'app/src/main/res/values-v31/styles.xml'), 'utf8'), /windowSplashScreenBackground/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects invalid Android theme colors', () => {
  assert.throws(() => normalizeAndroidResources({ theme: { primary: 'blue' } }), /must be a #RRGGBB/)
})
