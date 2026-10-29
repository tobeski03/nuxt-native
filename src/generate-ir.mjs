import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { compileTemplate } from './compiler.mjs'

const [sourceFile, outputFile] = process.argv.slice(2)
if (!sourceFile || !outputFile) throw new Error('Usage: npm run generate:ir -- <page.vue> <output.ir.json>')

const source = await readFile(sourceFile, 'utf8')
const template = source.match(/<template>([\s\S]*?)<\/template>/)?.[1]
if (!template) throw new Error(`No <template> found in ${sourceFile}`)

const document = compileTemplate(template, { strict: true })
await mkdir(dirname(outputFile), { recursive: true })
await writeFile(outputFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
console.log(`Generated ${outputFile} from ${sourceFile}`)
