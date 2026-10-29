import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const hostMarker = '.nuxt-native-host.json'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function createAndroidProject({ templateRoot, outputRoot }) {
  const template = resolve(templateRoot)
  const output = resolve(outputRoot)
  const marker = join(output, hostMarker)
  const outputExists = await exists(output)
  if (outputExists) {
    const entries = await readdir(output)
    if (entries.length && !(await exists(marker))) {
      throw new Error(`Refusing to overwrite non-generated Android directory: ${output}`)
    }
  } else {
    await mkdir(output, { recursive: true })
  }

  await cp(template, output, {
    recursive: true,
    force: true,
    filter(source) {
      const path = relative(template, source).replaceAll('\\', '/')
      return path === '' || (path !== '.gradle' && path !== 'build' && path !== 'app/build' && path !== 'local.properties' && !path.startsWith('.gradle/') && !path.startsWith('build/') && !path.startsWith('app/build/'))
    }
  })
  await writeFile(marker, `${JSON.stringify({ generatedBy: 'nuxt-native', template: 'android' }, null, 2)}\n`, 'utf8')
  return output
}
