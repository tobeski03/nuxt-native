import test from 'node:test'
import assert from 'node:assert/strict'
import { compileClasses, compileTemplate } from '../src/compiler.mjs'

test('maps familiar Vue elements to native node types', () => {
  const result = compileTemplate(`
    <main class="min-h-screen bg-gray-50">
      <h1 class="text-2xl font-bold">Welcome</h1>
      <input class="w-full" placeholder="Your name" />
      <button class="rounded-xl bg-blue-600 text-white">Save</button>
    </main>
  `)

  assert.equal(result.renderer, 'android-native')
  const children = result.nodes[0].children
  assert.deepEqual(children.map(node => node.type), ['text', 'text-input', 'button'])
  assert.equal(result.nodes[0].style.minHeight, 'screen')
  assert.equal(children[2].style.backgroundColor, '#2563eb')
})

test('accepts common semantic HTML and table structure in strict mode', () => {
  const result = compileTemplate('<article><header><h1>Report</h1></header><blockquote>Quote</blockquote><figure><img src="/chart.png" /><figcaption>Chart</figcaption></figure><hr /><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table></article>', { strict: true })
  const children = result.nodes[0].children
  assert.equal(children[1].type, 'text')
  assert.equal(children[2].type, 'container')
  assert.equal(children[3].type, 'divider')
  assert.equal(children[4].type, 'table')
  assert.equal(children[4].children[0].type, 'table-section')
  assert.equal(children[4].children[0].children[0].type, 'table-row')
  assert.equal(children[4].children[0].children[0].children[0].type, 'table-cell')
})

test('maps common native form controls and layout direction', () => {
  const result = compileTemplate('<main class="flex flex-row"><input type="checkbox" v-model="enabled" /><input type="range" min="0" max="10" step="2" v-model="amount" /><textarea placeholder="Notes" /><select v-model="choice" disabled aria-label="Choice"><option value="a">A</option></select></main>', { strict: true })
  const children = result.nodes[0].children
  assert.equal(result.nodes[0].style.flexDirection, 'row')
  assert.equal(children[0].type, 'checkbox')
  assert.equal(children[1].type, 'seekbar')
  assert.equal(children[1].props.min, '0')
  assert.equal(children[1].props.max, '10')
  assert.equal(children[1].props.step, '2')
  assert.equal(children[2].type, 'text-input')
  assert.equal(children[3].type, 'select')
  assert.equal(children[3].props.disabled, true)
  assert.equal(children[3].props['aria-label'], 'Choice')
  assert.equal(children[3].children[0].type, 'option')
})

test('preserves v-model modifiers for native control coercion', () => {
  const [text, amount, lazy] = compileTemplate('<main><input v-model.trim="name" /><input type="range" v-model.number="count" /><input v-model.lazy="draft" /></main>', { strict: true }).nodes[0].children
  assert.equal(text.props['v-model.trim'], 'name')
  assert.equal(amount.props['v-model.number'], 'count')
  assert.equal(lazy.props['v-model.lazy'], 'draft')
})

test('preserves native form submission handlers and submit controls', () => {
  const [form] = compileTemplate('<form @submit.prevent="save"><input /><button type="submit">Save</button></form>', { strict: true }).nodes
  assert.equal(form.type, 'form')
  assert.equal(form.props['@submit.prevent'], 'save')
  assert.equal(form.children[1].props.type, 'submit')
})

test('preserves native input, change, focus, and keyboard handlers', () => {
  const [node] = compileTemplate('<input type="range" @input="changed" @change="committed" @focus="focused" @blur="blurred" @keydown="pressed" @keyup="released" @keydown.ctrl.enter="combo" />').nodes
  assert.equal(node.props['@input'], 'changed')
  assert.equal(node.props['@change'], 'committed')
  assert.equal(node.props['@focus'], 'focused')
  assert.equal(node.props['@blur'], 'blurred')
  assert.equal(node.props['@keydown'], 'pressed')
  assert.equal(node.props['@keyup'], 'released')
  assert.equal(node.props['@keydown.ctrl.enter'], 'combo')
})

test('preserves native touch interaction handlers', () => {
  const [node] = compileTemplate('<div @long-press="hold" @touchstart="press" @touchend="release" @swipeleft="previous">Touch me</div>').nodes
  assert.equal(node.props['@long-press'], 'hold')
  assert.equal(node.props['@touchstart'], 'press')
  assert.equal(node.props['@touchend'], 'release')
  assert.equal(node.props['@swipeleft'], 'previous')
})

test('preserves native image sources and internal links', () => {
  const result = compileTemplate('<main><img src="https://example.com/image.png" alt="Example" /><a href="/settings">Settings</a></main>', { strict: true })
  const [image, link] = result.nodes[0].children
  assert.equal(image.type, 'image')
  assert.equal(image.props.src, 'https://example.com/image.png')
  assert.equal(link.type, 'link')
  assert.equal(link.props.href, '/settings')
})

test('preserves packaged, content, and data image sources for native loading', () => {
  const result = compileTemplate('<main><img src="/images/logo.png" /><img src="content://picked/avatar" /><img src="data:image/png;base64,AAAA" /></main>', { strict: true })
  const [packaged, content, data] = result.nodes[0].children
  assert.equal(packaged.props.src, '/images/logo.png')
  assert.equal(content.props.src, 'content://picked/avatar')
  assert.equal(data.props.src, 'data:image/png;base64,AAAA')
})

test('preserves reactive native link destinations', () => {
  const [link] = compileTemplate('<NuxtLink :to="destination">Open</NuxtLink>').nodes
  assert.equal(link.type, 'link')
  assert.equal(link.props[':to'], 'destination')
})

test('preserves optional-chain and nullish text expressions for native evaluation', () => {
  const [text] = compileTemplate('<p>{{ device?.model ?? \'Native device\' }}</p>').nodes[0].children
  assert.equal(text.content.expression, "device?.model ?? 'Native device'")
})

test('preserves accessibility semantics for the native renderer', () => {
  const result = compileTemplate(`<main aria-label="Profile" role="main"><h1 aria-live="polite">Welcome</h1><button :aria-label="buttonLabel" aria-disabled="false">Save</button><img alt="Avatar" aria-hidden="true" src="content://avatar" /></main>`)
  const root = result.nodes[0]
  assert.equal(root.props['aria-label'], 'Profile')
  assert.equal(root.props.role, 'main')
  assert.equal(root.children[0].props['aria-live'], 'polite')
  assert.equal(root.children[1].props[':aria-label'], 'buttonLabel')
  assert.equal(root.children[2].props.alt, 'Avatar')
  assert.equal(root.children[2].props['aria-hidden'], 'true')
})

test('preserves native form control attributes', () => {
  const result = compileTemplate('<form><input type="email" maxlength="80" minlength="5" pattern=".+@.+" required disabled /><textarea rows="4" maxlength="240" /></form>', { strict: true })
  const [input, textarea] = result.nodes[0].children
  assert.equal(input.props.type, 'email')
  assert.equal(input.props.maxlength, '80')
  assert.equal(input.props.minlength, '5')
  assert.equal(input.props.pattern, '.+@.+')
  assert.equal(input.props.required, true)
  assert.equal(input.props.disabled, true)
  assert.equal(textarea.props.rows, '4')
  assert.equal(textarea.props.maxlength, '240')
})

test('maps framework loading indicator to a native loading node', () => {
  const [node] = compileTemplate('<NuxtLoadingIndicator />').nodes
  assert.equal(node.type, 'loading-indicator')
})

test('maps Nuxt route announcer to a native accessibility node', () => {
  const [node] = compileTemplate('<NuxtRouteAnnouncer />', { strict: true }).nodes
  assert.equal(node.type, 'route-announcer')
})

test('maps Nuxt media components to native image nodes', () => {
  const result = compileTemplate('<main><NuxtImg src="/logo.png" alt="Logo" /><NuxtPicture src="/hero.png" /></main>', { strict: true })
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.nodes[0].children[0].type, 'image')
  assert.equal(result.nodes[0].children[1].type, 'image')
})

test('maps NuxtIsland to a native boundary with default and fallback slots', () => {
  const result = compileTemplate('<NuxtIsland name="profile"><template #fallback><p>Loading profile</p></template><p>Profile</p></NuxtIsland>', { strict: true })
  const node = result.nodes[0]
  assert.equal(node.type, 'island')
  assert.equal(node.props.name, 'profile')
  assert.equal(node.children[0].children[0].content, 'Profile')
  assert.equal(node.fallback[0].children[0].content, 'Loading profile')
})

test('maps Nuxt head metadata without creating visible content nodes', () => {
  const result = compileTemplate('<main><Head><Title>Native screen</Title><Meta name="description" content="Native" /></Head><p>Body</p></main>', { strict: true })
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.nodes[0].children[0].type, 'head')
  assert.equal(result.nodes[0].children[0].children[0].type, 'head-title')
  assert.equal(result.nodes[0].children[0].children[1].type, 'head-meta')
})

test('compiles Nuxt fallback components into explicit native control nodes', () => {
  const result = compileTemplate(`<main>
    <ClientOnly><p>Client content</p></ClientOnly>
    <Suspense><p>Loaded</p><template #fallback><p>Loading</p></template></Suspense>
    <NuxtErrorBoundary><p>Content</p><template #error><p>Recoverable error</p></template></NuxtErrorBoundary>
  </main>`, { strict: true })
  const children = result.nodes[0].children
  assert.equal(children[0].type, 'client-only')
  assert.equal(children[1].type, 'suspense')
  assert.equal(children[1].fallback[0].children[0].content, 'Loading')
  assert.equal(children[2].type, 'error-boundary')
  assert.equal(children[2].fallback[0].children[0].content, 'Recoverable error')
})

test('maps Transition to a native transition node', () => {
  const [node] = compileTemplate('<Transition name="slide" duration="360" easing="ease-out" @after-enter="entered"><p v-if="visible">Shown</p></Transition>').nodes
  assert.equal(node.type, 'transition')
  assert.equal(node.props.name, 'slide')
  assert.equal(node.props.duration, '360')
  assert.equal(node.props.easing, 'ease-out')
  assert.equal(node.props['@after-enter'], 'entered')
})

test('maps KeepAlive to a native retained-subtree node', () => {
  const [node] = compileTemplate('<KeepAlive><section>Cached</section></KeepAlive>', { strict: true }).nodes
  assert.equal(node.type, 'keep-alive')
  assert.equal(node.children[0].type, 'container')
})

test('maps Teleport to a native portal node with its target and disabled props', () => {
  const [node] = compileTemplate('<Teleport to="body" :disabled="inline"><p>Overlay</p></Teleport>', { strict: true }).nodes
  assert.equal(node.type, 'portal')
  assert.equal(node.props.to, 'body')
  assert.equal(node.props[':disabled'], 'inline')
  assert.equal(node.children[0].type, 'text')
})

test('preserves Vue-facing attributes for the native renderer', () => {
  const [node] = compileTemplate('<button @click="save" :disabled="saving">Save</button>').nodes
  assert.equal(node.props['@click'], 'save')
  assert.equal(node.props[':disabled'], 'saving')
})

test('preserves event modifiers for native dispatch', () => {
  const [node] = compileTemplate('<button @click.stop.prevent="save">Save</button>').nodes
  assert.equal(node.props['@click.stop.prevent'], 'save')
})

test('preserves click handlers on non-button native elements', () => {
  const [node] = compileTemplate('<article @click="open"><h2>Open card</h2></article>').nodes
  assert.equal(node.type, 'container')
  assert.equal(node.props['@click'], 'open')
})

test('reports unsupported utilities instead of silently dropping them', () => {
  const result = compileTemplate('<button class="bg-blue-600 hover:bg-blue-700 p-4 unknown-class">Save</button>')
  assert.equal(result.nodes[0].style.backgroundColor, '#2563eb')
  assert.deepEqual(result.diagnostics.map(item => item.message), [
    'Unsupported native utility: unknown-class'
  ])
})

test('compiles native interaction variants into state styles', () => {
  const result = compileClasses('bg-blue-500 hover:bg-blue-600 active:bg-blue-700 focus:border-2 disabled:opacity-50 selected:text-white')
  assert.deepEqual(result.style, { backgroundColor: '#3b82f6' })
  assert.deepEqual(result.stateStyles, {
    hovered: { backgroundColor: '#2563eb' },
    pressed: { backgroundColor: '#1d4ed8' },
    focused: { borderWidth: 2 },
    disabled: { opacity: 0.5 },
    selected: { color: '#ffffff' }
  })
  assert.deepEqual(result.warnings, [])
})

test('compiles native responsive and theme variants', () => {
  const result = compileClasses('bg-white sm:bg-blue-100 md:text-lg dark:bg-slate-900 light:bg-white')
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.responsiveStyles, {
    sm: { backgroundColor: '#dbeafe' },
    md: { fontSize: 18 }
  })
  assert.deepEqual(result.themeStyles, {
    dark: { backgroundColor: '#0f172a' },
    light: { backgroundColor: '#ffffff' }
  })
})

test('composes responsive and theme variants with native interaction states', () => {
  const result = compileClasses('md:hover:bg-blue-600 dark:disabled:opacity-50')
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.responsiveStateStyles, {
    md: { hovered: { backgroundColor: '#2563eb' } }
  })
  assert.deepEqual(result.themeStateStyles, {
    dark: { disabled: { opacity: 0.5 } }
  })
})

test('supports arbitrary and project-defined colors', () => {
  const result = compileTemplate(
    '<main class="bg-brand-primary"><p class="text-[#316ff6]">A</p><p class="text-[22px]">B</p></main>',
    { theme: { colors: { brand: { primary: '#123456' } } } }
  )
  const [first, second] = result.nodes[0].children
  assert.equal(result.nodes[0].style.backgroundColor, '#123456')
  assert.equal(first.style.color, '#316ff6')
  assert.equal(second.style.fontSize, 22)
})

test('supports the standard Tailwind color palette', () => {
  const result = compileClasses('bg-slate-100 text-emerald-700 border-rose-500')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.style.backgroundColor, '#f1f5f9')
  assert.equal(result.style.color, '#047857')
  assert.equal(result.style.borderColor, '#f43f5e')
})

test('compiles native flex alignment and sizing utilities', () => {
  const result = compileClasses('flex flex-row items-center items-stretch justify-evenly flex-none grow shrink-0')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.style.flexDirection, 'row')
  assert.equal(result.style.alignItems, 'stretch')
  assert.equal(result.style.justifyContent, 'space-evenly')
  assert.equal(result.style.flex, 0)
  assert.equal(result.style.flexGrow, 1)
  assert.equal(result.style.flexShrink, 0)
})

test('compiles native grid columns for card and dashboard layouts', () => {
  const result = compileClasses('grid grid-cols-3 gap-4')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.style.display, 'grid')
  assert.equal(result.style.gridColumns, 3)
  assert.equal(result.style.gap, 16)
})

test('supports negative margins, axis spacing, and rem arbitrary values', () => {
  const result = compileTemplate(
    '<main class="-mt-4 space-y-3"><p class="w-[15rem] text-[1.25rem]">A</p></main>',
    { strict: true }
  )
  assert.equal(result.nodes[0].style.marginTop, -16)
  assert.equal(result.nodes[0].style.gap, 12)
  assert.equal(result.nodes[0].children[0].style.width, 240)
  assert.equal(result.nodes[0].children[0].style.fontSize, 20)
})

test('covers the complete standard spacing scale and native line heights', () => {
  const result = compileClasses('p-7 mt-14 gap-24 leading-6')
  assert.deepEqual(result.style, {
    padding: 28,
    marginTop: 56,
    gap: 96,
    lineHeight: 24
  })
  assert.deepEqual(result.warnings, [])
})

test('compiles rounded-full to a numeric native radius', () => {
  const result = compileTemplate('<main><span class="rounded-full">Pill</span></main>')
  assert.equal(result.nodes[0].children[0].style.borderRadius, 9999)
})

test('supports color opacity modifiers', () => {
  const result = compileTemplate('<button class="bg-brand/50">Save</button>', {
    colors: { brand: '#123456' }
  })
  assert.equal(result.nodes[0].style.backgroundColor, 'rgba(18, 52, 86, 0.5)')
})

test('compiles native linear gradient utilities', () => {
  const result = compileTemplate('<main class="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700">Gradient</main>')
  assert.deepEqual(result.nodes[0].style, {
    gradientDirection: 'br',
    gradientFrom: '#2563eb',
    gradientVia: '#4f46e5',
    gradientTo: '#7e22ce'
  })
})

test('compiles common native image and surface utilities', () => {
  const result = compileTemplate('<img src="/surface.png" class="object-cover shadow-xl ring-2 ring-blue-500 tracking-wide" />')
  assert.equal(result.nodes[0].style.objectFit, 'cover')
  assert.equal(result.nodes[0].style.elevation, 12)
  assert.equal(result.nodes[0].style.borderWidth, 2)
  assert.equal(result.nodes[0].style.borderColor, '#3b82f6')
  assert.equal(result.nodes[0].style.letterSpacing, 0.025)
})

test('compiles native relative and absolute positioning utilities', () => {
  const result = compileTemplate('<section class="relative overflow-hidden"><span class="absolute inset-x-0 inset-y-0 z-10">Overlay</span></section>')
  assert.equal(result.nodes[0].style.position, 'relative')
  assert.equal(result.nodes[0].style.overflow, 'hidden')
  assert.equal(result.nodes[0].children[0].style.position, 'absolute')
  assert.equal(result.nodes[0].children[0].style.insetLeft, 0)
  assert.equal(result.nodes[0].children[0].style.insetRight, 0)
  assert.equal(result.nodes[0].children[0].style.insetTop, 0)
  assert.equal(result.nodes[0].children[0].style.insetBottom, 0)
  assert.equal(result.nodes[0].children[0].style.width, 'fill')
  assert.equal(result.nodes[0].children[0].style.height, 'fill')
  assert.equal(result.nodes[0].children[0].style.zIndex, 10)
})

test('compiles native nested vertical overflow utilities', () => {
  const result = compileClasses('overflow-auto overflow-y-auto overflow-y-scroll')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.style.overflow, 'auto')
  assert.equal(result.style.overflowY, 'scroll')
})

test('compiles native horizontal overflow utilities', () => {
  const result = compileClasses('overflow-x-auto overflow-x-scroll')
  assert.deepEqual(result.warnings, [])
  assert.equal(result.style.overflowX, 'scroll')
})

test('compiles native typography, border, and surface utilities', () => {
  const [node] = compileTemplate('<p class="text-center italic uppercase underline border-2 border-brand shadow-lg opacity-75">Styled</p>', {
    colors: { brand: '#123456' }
  }).nodes
  assert.equal(node.style.textAlign, 'center')
  assert.equal(node.style.fontStyle, 'italic')
  assert.equal(node.style.textTransform, 'uppercase')
  assert.equal(node.style.textDecoration, 'underline')
  assert.equal(node.style.borderWidth, 2)
  assert.equal(node.style.borderColor, '#123456')
  assert.equal(node.style.elevation, 8)
  assert.equal(node.style.opacity, 0.75)
})

test('compiles native animation utilities', () => {
  const [fade, slide] = compileTemplate('<main><div class="animate-fade-in">Fade</div><div class="animate-slide-up">Slide</div></main>').nodes[0].children
  assert.equal(fade.style.animation, 'fade-in')
  assert.equal(slide.style.animation, 'slide-up')
})

test('preserves runtime class and style bindings for native refresh', () => {
  const [node] = compileTemplate('<p :class="tone" :style="{ color: textColor, fontSize: size }" style="padding: 8px">Text</p>').nodes
  assert.equal(node.classBinding, 'tone')
  assert.deepEqual(node.styleBindings, { color: 'textColor', fontSize: 'size' })
  assert.equal(node.style.padding, 8)
})

test('preserves object v-bind for native attribute forwarding', () => {
  const [node] = compileTemplate('<button v-bind="attrs">Save</button>').nodes
  assert.equal(node.props['v-bind'], 'attrs')
})

test('packages the full static and project color token map for runtime classes', () => {
  const result = compileTemplate('<p :class="tone">Text</p>', { colors: { brand: '#123456' } })
  assert.equal(result.styleTokens['blue-600'], '#2563eb')
  assert.equal(result.styleTokens.brand, '#123456')
})

test('maps layout slots to native slot nodes for generator composition', () => {
  const result = compileTemplate('<main><slot /></main>', { strict: true })
  assert.equal(result.nodes[0].children[0].type, 'slot')
})

test('expands discovered component templates into native IR', () => {
  const result = compileTemplate('<main><NativeBadge /></main>', {
    strict: true,
    components: { NativeBadge: '<span class="bg-blue-600">Native component</span>' }
  })
  const component = result.nodes[0].children[0]
  assert.equal(component.type, 'component')
  assert.equal(component.children[0].type, 'text')
  assert.equal(component.children[0].style.backgroundColor, '#2563eb')
})

test('expands component props and default slots', () => {
  const result = compileTemplate('<main><NativeCard title="Card title"><p>Slot content</p></NativeCard></main>', {
    strict: true,
    components: { NativeCard: '<article><h2>{{ title }}</h2><slot /></article>' }
  })
  const card = result.nodes[0].children[0]
  const article = card.children[0]
  assert.equal(article.children[0].children[0].content, 'Card title')
  assert.equal(article.children[1].children[0].content, 'Slot content')
})

test('expands named slots and dynamic component props', () => {
  const result = compileTemplate('<main><NativeCard :title="heading"><template #header><p>Named header</p></template><p>Default body</p></NativeCard></main>', {
    strict: true,
    components: { NativeCard: '<article><h2>{{ title }}</h2><slot name="header"><p>Fallback header</p></slot><slot /></article>' }
  })
  const card = result.nodes[0].children[0].children[0]
  assert.equal(card.children[0].children[0].content.expression, 'heading')
  assert.equal(card.children[1].children[0].content, 'Named header')
  assert.equal(card.children[2].children[0].content, 'Default body')
})

test('compiles dynamic components into selectable native variants', () => {
  const result = compileTemplate('<main><component :is="active"><p>Body</p></component></main>', {
    strict: true,
    components: {
      NativeBadge: '<span>Badge</span>',
      NativeCard: '<article><slot /></article>'
    }
  })
  const dynamic = result.nodes[0].children[0]
  assert.equal(dynamic.type, 'dynamic-component')
  assert.deepEqual(dynamic.variants.map(variant => variant.name), ['NativeBadge', 'NativeCard'])
  assert.equal(dynamic.variants[1].nodes[0].children[0].children[0].content, 'Body')
})

test('preserves object v-for value and key bindings for native reconciliation', () => {
  const result = compileTemplate('<main><p v-for="(label, key) in labels" :key="key">{{ key }}: {{ label }}</p></main>', { strict: true })
  const loop = result.nodes[0].children[0]
  assert.equal(loop.type, 'for')
  assert.equal(loop.source, 'labels')
  assert.equal(loop.value, 'label')
  assert.equal(loop.key, 'key')
  assert.equal(loop.track, 'key')
})

test('records component setup scripts with instance-scoped bindings', () => {
  const result = compileTemplate('<main><NativeCounter /></main>', {
    strict: true,
    components: {
      NativeCounter: {
        template: '<button @click="increment">{{ count }}</button>',
        script: 'const count = ref(0)\nfunction increment() { count.value++ }'
      }
    }
  })
  assert.equal(result.componentScripts.length, 1)
  assert.equal(result.componentScripts[0].prefix, '__nuxtComponent0')
  const button = result.nodes[0].children[0].children[0]
  assert.equal(button.props['@click'], '__nuxtComponent0_increment')
  assert.equal(button.children[0].content.expression, '__nuxtComponent0_count')
})

test('compiles Vue structural controls into native control nodes', () => {
  const result = compileTemplate('<main><p v-if="visible">Visible</p><p v-else>Hidden</p><span v-for="(item, index) in items" :key="item.id">{{ index }}: {{ item }}</span></main>', { strict: true })
  const children = result.nodes[0].children
  assert.equal(children[0].type, 'conditional')
  assert.deepEqual(children[0].branches.map(branch => branch.condition), ['visible', null])
  assert.equal(children[1].type, 'for')
  assert.equal(children[1].source, 'items')
  assert.equal(children[1].value, 'item')
  assert.equal(children[1].index, 'index')
  assert.equal(children[1].track, 'item.id')
})

test('preserves v-show for native visibility updates', () => {
  const [node] = compileTemplate('<p v-show="visible">Toggle me</p>').nodes
  assert.equal(node.props['v-show'], 'visible')
})

test('preserves native hidden visibility bindings', () => {
  const result = compileTemplate('<main><p hidden>Gone</p><p :hidden="collapsed">Maybe</p><p v-bind="attrs">Object</p></main>', { strict: true })
  const [hidden, bound, object] = result.nodes[0].children
  assert.equal(hidden.props.hidden, true)
  assert.equal(bound.props[':hidden'], 'collapsed')
  assert.equal(object.props['v-bind'], 'attrs')
})
