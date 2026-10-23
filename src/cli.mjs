import { readFile } from 'node:fs/promises'
import { compileTemplate } from './compiler.mjs'

const file = process.argv[2]
if (!file) throw new Error('Usage: npm run compile:example -- examples/profile.vue')

const source = await readFile(file, 'utf8')
const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1]
if (!template) throw new Error(`No <template> found in ${file}`)

console.log(JSON.stringify(compileTemplate(template), null, 2))
