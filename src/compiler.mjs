import { baseParse, NodeTypes } from '@vue/compiler-dom'

const ELEMENTS = {
  main: 'screen', section: 'container', div: 'container', article: 'container',
  header: 'container', footer: 'container', nav: 'container', ul: 'list', ol: 'list',
  li: 'list-item', h1: 'text', h2: 'text', h3: 'text', h4: 'text', p: 'text',
  span: 'text', label: 'text', img: 'image', input: 'text-input', textarea: 'text-input',
  button: 'button', form: 'form', a: 'link'
}

const COLORS = {
  transparent: 'transparent', white: '#ffffff', black: '#000000',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-500': '#6b7280', 'gray-700': '#374151', 'gray-900': '#111827',
  'red-600': '#dc2626', 'green-600': '#16a34a', 'blue-500': '#3b82f6',
  'blue-600': '#2563eb', 'blue-700': '#1d4ed8'
}

const STATIC_UTILITIES = {
  flex: { display: 'flex' }, 'flex-1': { flex: 1 }, 'flex-row': { flexDirection: 'row' },
  'flex-col': { flexDirection: 'column' }, 'flex-wrap': { flexWrap: 'wrap' },
  'items-start': { alignItems: 'flex-start' }, 'items-center': { alignItems: 'center' },
  'items-end': { alignItems: 'flex-end' }, 'justify-start': { justifyContent: 'flex-start' },
  'justify-center': { justifyContent: 'center' }, 'justify-end': { justifyContent: 'flex-end' },
  'justify-between': { justifyContent: 'space-between' }, 'justify-around': { justifyContent: 'space-around' },
  'text-left': { textAlign: 'left' }, 'text-center': { textAlign: 'center' }, 'text-right': { textAlign: 'right' },
  'font-normal': { fontWeight: 400 }, 'font-medium': { fontWeight: 500 }, 'font-semibold': { fontWeight: 600 }, 'font-bold': { fontWeight: 700 },
  'text-xs': { fontSize: 12 }, 'text-sm': { fontSize: 14 }, 'text-base': { fontSize: 16 },
  'text-lg': { fontSize: 18 }, 'text-xl': { fontSize: 20 }, 'text-2xl': { fontSize: 24 }, 'text-3xl': { fontSize: 30 },
  'w-full': { width: 'fill' }, 'h-full': { height: 'fill' }, 'min-h-screen': { minHeight: 'screen' },
  'max-w-full': { maxWidth: 'fill' }, 'rounded-none': { borderRadius: 0 }, 'rounded-sm': { borderRadius: 2 },
  rounded: { borderRadius: 4 }, 'rounded-lg': { borderRadius: 8 }, 'rounded-xl': { borderRadius: 12 },
  'rounded-2xl': { borderRadius: 16 }, 'rounded-full': { borderRadius: 'full' },
  'shadow-none': { elevation: 0 }, 'shadow-sm': { elevation: 1 }, shadow: { elevation: 2 },
  'shadow-md': { elevation: 4 }, 'shadow-lg': { elevation: 8 }, 'overflow-hidden': { overflow: 'hidden' },
  'opacity-50': { opacity: 0.5 }, 'opacity-75': { opacity: 0.75 }, 'opacity-100': { opacity: 1 }
}

const SPACING = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 }

function parseArbitrary(value) {
  if (!value?.startsWith('[') || !value.endsWith(']')) return undefined
  const raw = value.slice(1, -1).replace(/_/g, ' ')
  if (/^-?\d+(\.\d+)?(px|rem|%)$/.test(raw)) return Number.parseFloat(raw)
  if (/^#?[0-9a-f]{3,8}$/i.test(raw)) return raw.startsWith('#') ? raw : `#${raw}`
  return raw
}

function spacingValue(value) { return parseArbitrary(value) ?? SPACING[value] }

function utilityStyle(utility) {
  if (STATIC_UTILITIES[utility]) return STATIC_UTILITIES[utility]

  const colorMatch = utility.match(/^(bg|text|border)-(.+)$/)
  if (colorMatch && COLORS[colorMatch[2]]) {
    const property = colorMatch[1] === 'bg' ? 'backgroundColor' : colorMatch[1] === 'text' ? 'color' : 'borderColor'
    return { [property]: COLORS[colorMatch[2]] }
  }

  const arbitraryColor = utility.match(/^(bg|text)-\[(.+)\]$/)
  if (arbitraryColor) return { [arbitraryColor[1] === 'bg' ? 'backgroundColor' : 'color']: parseArbitrary(`[${arbitraryColor[2]}]`) }

  const spacingMatch = utility.match(/^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap)-(.+)$/)
  if (spacingMatch) {
    const value = spacingValue(spacingMatch[2])
    if (value === undefined) return undefined
    const map = {
      p: ['padding'], px: ['paddingHorizontal'], py: ['paddingVertical'], pt: ['paddingTop'],
      pr: ['paddingRight'], pb: ['paddingBottom'], pl: ['paddingLeft'], m: ['margin'],
      mx: ['marginHorizontal'], my: ['marginVertical'], mt: ['marginTop'], mr: ['marginRight'],
      mb: ['marginBottom'], ml: ['marginLeft'], gap: ['gap']
    }
    return Object.fromEntries(map[spacingMatch[1]].map(property => [property, value]))
  }

  const dimensionMatch = utility.match(/^(w|h|min-w|min-h|max-w|max-h)-(.+)$/)
  if (dimensionMatch) {
    const value = dimensionMatch[2] === 'screen' ? 'screen' : dimensionMatch[2] === 'full' ? 'fill' : spacingValue(dimensionMatch[2])
    if (value === undefined) return undefined
    const property = { w: 'width', h: 'height', 'min-w': 'minWidth', 'min-h': 'minHeight', 'max-w': 'maxWidth', 'max-h': 'maxHeight' }[dimensionMatch[1]]
    return { [property]: value }
  }

  const borderMatch = utility.match(/^border(?:-(\d+))?$/)
  if (borderMatch) return { borderWidth: Number(borderMatch[1] ?? 1) }
  const leadingMatch = utility.match(/^leading-(\d+)$/)
  if (leadingMatch) return { lineHeight: Number(leadingMatch[1]) }
  return undefined
}

export function compileClasses(className = '') {
  const style = {}
  const warnings = []
  for (const token of className.split(/\s+/).filter(Boolean)) {
    if (token.includes(':')) {
      warnings.push(`Unsupported native variant: ${token}`)
      continue
    }
    const declaration = utilityStyle(token)
    if (declaration) Object.assign(style, declaration)
    else warnings.push(`Unsupported native utility: ${token}`)
  }
  return { style, warnings }
}

function propsFor(node) {
  const props = {}
  for (const prop of node.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) props[prop.name] = prop.value?.content ?? true
    else if (prop.type === NodeTypes.DIRECTIVE) {
      const argument = prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? prop.arg.content : undefined
      props[`${prop.name}${argument ? `:${argument}` : ''}`] = prop.exp?.content ?? true
    }
  }
  return props
}

function transform(node, diagnostics) {
  if (node.type === NodeTypes.TEXT) return { type: 'text-node', content: node.content }
  if (node.type === NodeTypes.INTERPOLATION) return { type: 'text-node', content: { expression: node.content.content } }
  if (node.type !== NodeTypes.ELEMENT) return undefined

  const type = ELEMENTS[node.tag] ?? 'component'
  const props = propsFor(node)
  const compiledClasses = compileClasses(typeof props.class === 'string' ? props.class : '')
  diagnostics.push(...compiledClasses.warnings.map(message => ({ level: 'warning', message, tag: node.tag })))
  return {
    type, tag: node.tag, props, style: compiledClasses.style,
    children: node.children.map(child => transform(child, diagnostics)).filter(Boolean)
  }
}

export function compileTemplate(template, options = {}) {
  const diagnostics = []
  const ast = baseParse(template, { comments: false })
  const nodes = ast.children.map(node => transform(node, diagnostics)).filter(Boolean)
  const unsupported = nodes.flatMap(node => node.tag && !ELEMENTS[node.tag] ? [node.tag] : [])
  if (options.strict && unsupported.length) throw new Error(`Unsupported native elements: ${[...new Set(unsupported)].join(', ')}`)
  return { version: 2, renderer: 'android-native', nodes, diagnostics }
}
