import test from 'node:test'
import assert from 'node:assert/strict'
import { compileTemplate } from '../src/compiler.mjs'

test('maps familiar Vue elements to native node types', () => {
  const result = compileTemplate(`
    <main class="min-h-screen bg-gray-50">
      <h1 class="text-2xl font-bold">Welcome</h1>
      <input class="w-full" placeholder="Your name" />
      <button class="rounded-xl bg-blue-600 text-white">Save</button>
    </main>
  `)

  assert.equal(result.renderer, 'android-native')
  const children = result.nodes[0].children[0].children
  assert.deepEqual(children.map(node => node.type), ['text', 'text-input', 'button'])
  assert.equal(result.nodes[0].style.minHeight, 'screen')
  assert.equal(children[2].style.backgroundColor, '#2563eb')
})

test('preserves Vue-facing attributes for the native renderer', () => {
  const [node] = compileTemplate('<button @click="save" :disabled="saving">Save</button>').nodes
  assert.equal(node.props['@click'], 'save')
  assert.equal(node.props[':disabled'], 'saving')
})

test('reports unsupported utilities instead of silently dropping them', () => {
  const result = compileTemplate('<button class="bg-blue-600 hover:bg-blue-700 p-4 unknown-class">Save</button>')
  assert.equal(result.nodes[0].style.backgroundColor, '#2563eb')
  assert.deepEqual(result.diagnostics.map(item => item.message), [
    'Unsupported native variant: hover:bg-blue-700',
    'Unsupported native utility: unknown-class'
  ])
})
