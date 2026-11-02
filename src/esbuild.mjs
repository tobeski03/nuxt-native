import { copyFile, mkdtemp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

if (process.platform === 'win32' && !process.env.ESBUILD_BINARY_PATH) {
  const mainFile = require.resolve('esbuild')
  const packageRoot = dirname(dirname(mainFile))
  const binaryName = 'esbuild.exe'
  const candidates = [
    join(packageRoot, '@esbuild', 'win32-x64', binaryName),
    join(dirname(packageRoot), '@esbuild', 'win32-x64', binaryName)
  ]
  const source = candidates.find(candidate => {
    try { require('node:fs').accessSync(candidate) ; return true } catch { return false }
  })
  if (source) {
    const directory = await mkdtemp(join(tmpdir(), 'nuxt-native-esbuild-'))
    const copy = join(directory, binaryName)
    await copyFile(source, copy)
    process.env.ESBUILD_BINARY_PATH = copy
  }
}

const esbuild = await import('esbuild')
export const { build, transform, transformSync, analyzeMetafile, version } = esbuild
