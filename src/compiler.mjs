import { baseParse, NodeTypes } from '@vue/compiler-dom'
import { BUILTIN_COMPONENTS } from './framework/contract.mjs'

const ELEMENTS = {
  main: 'screen', section: 'container', div: 'container', article: 'container',
  header: 'container', footer: 'container', nav: 'container', ul: 'list', ol: 'list',
  li: 'list-item', h1: 'text', h2: 'text', h3: 'text', h4: 'text', h5: 'text', h6: 'text', p: 'text',
  span: 'text', label: 'text', strong: 'text', em: 'text', small: 'text', address: 'text', blockquote: 'text',
  cite: 'text', code: 'text', data: 'text', del: 'text', ins: 'text', kbd: 'text', mark: 'text', q: 'text',
  s: 'text', samp: 'text', sub: 'text', sup: 'text', time: 'text', u: 'text', variable: 'text',
  img: 'image', br: 'line-break', hr: 'divider',
  figure: 'container', figcaption: 'text', dl: 'container', dt: 'text', dd: 'text', details: 'container', summary: 'text',
  table: 'table', caption: 'text', thead: 'table-section', tbody: 'table-section', tfoot: 'table-section',
  tr: 'table-row', td: 'table-cell', th: 'table-cell',
  input: 'text-input', textarea: 'text-input', select: 'select', option: 'option',
  button: 'button', form: 'form', a: 'link', slot: 'slot'
}

for (const [name, definition] of Object.entries(BUILTIN_COMPONENTS)) ELEMENTS[name] = definition.type

const TAILWIND_PALETTE = {
  slate: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617' },
  gray: { 50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827', 950: '#030712' },
  zinc: { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b' },
  neutral: { 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040', 800: '#262626', 900: '#171717', 950: '#0a0a0a' },
  stone: { 50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a8a29e', 500: '#78716c', 600: '#57534e', 700: '#44403c', 800: '#292524', 900: '#1c1917', 950: '#0c0a09' },
  red: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a' },
  orange: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12', 950: '#431407' },
  amber: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03' },
  yellow: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207', 800: '#854d0e', 900: '#713f12', 950: '#422006' },
  lime: { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d', 700: '#4d7c0f', 800: '#3f6212', 900: '#365314', 950: '#1a2e05' },
  green: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d', 950: '#052e16' },
  emerald: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22' },
  teal: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a', 950: '#042f2e' },
  cyan: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490', 800: '#155e75', 900: '#164e63', 950: '#083344' },
  sky: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e', 950: '#082f49' },
  blue: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a', 950: '#172554' },
  indigo: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b' },
  violet: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065' },
  purple: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#a855f7', 600: '#9333ea', 700: '#7e22ce', 800: '#6b21a8', 900: '#581c87', 950: '#3b0764' },
  fuchsia: { 50: '#fdf4ff', 100: '#fae8ff', 200: '#f5d0fe', 300: '#f0abfc', 400: '#e879f9', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf', 800: '#86198f', 900: '#701a75', 950: '#4a044e' },
  pink: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843', 950: '#500724' },
  rose: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337', 950: '#4c0519' }
}

const COLORS = { transparent: 'transparent', white: '#ffffff', black: '#000000', ...flattenColors(TAILWIND_PALETTE) }

const STATIC_UTILITIES = {
  flex: { display: 'flex' }, 'flex-1': { flex: 1 }, 'flex-auto': { flex: 1 }, 'flex-initial': { flex: 0 }, 'flex-none': { flex: 0 }, 'grow': { flexGrow: 1 }, 'grow-0': { flexGrow: 0 }, 'shrink': { flexShrink: 1 }, 'shrink-0': { flexShrink: 0 }, 'flex-row': { flexDirection: 'row' },
  'flex-col': { flexDirection: 'column' }, 'flex-wrap': { flexWrap: 'wrap' }, 'grid': { display: 'grid' },
  static: { position: 'static' }, relative: { position: 'relative' }, absolute: { position: 'absolute' },
  'items-start': { alignItems: 'flex-start' }, 'items-center': { alignItems: 'center' },
  'items-end': { alignItems: 'flex-end' }, 'items-stretch': { alignItems: 'stretch' }, 'items-baseline': { alignItems: 'baseline' }, 'justify-start': { justifyContent: 'flex-start' },
  'justify-center': { justifyContent: 'center' }, 'justify-end': { justifyContent: 'flex-end' },
  'justify-between': { justifyContent: 'space-between' }, 'justify-around': { justifyContent: 'space-around' }, 'justify-evenly': { justifyContent: 'space-evenly' },
  'text-left': { textAlign: 'left' }, 'text-center': { textAlign: 'center' }, 'text-right': { textAlign: 'right' }, 'text-justify': { textAlign: 'justify' },
  'font-normal': { fontWeight: 400 }, 'font-medium': { fontWeight: 500 }, 'font-semibold': { fontWeight: 600 }, 'font-bold': { fontWeight: 700 },
  italic: { fontStyle: 'italic' }, 'not-italic': { fontStyle: 'normal' },
  uppercase: { textTransform: 'uppercase' }, lowercase: { textTransform: 'lowercase' }, capitalize: { textTransform: 'capitalize' }, 'normal-case': { textTransform: 'none' },
  underline: { textDecoration: 'underline' }, 'line-through': { textDecoration: 'line-through' }, 'no-underline': { textDecoration: 'none' },
  'text-xs': { fontSize: 12 }, 'text-sm': { fontSize: 14 }, 'text-base': { fontSize: 16 },
  'text-lg': { fontSize: 18 }, 'text-xl': { fontSize: 20 }, 'text-2xl': { fontSize: 24 }, 'text-3xl': { fontSize: 30 },
  'w-full': { width: 'fill' }, 'h-full': { height: 'fill' }, 'min-h-screen': { minHeight: 'screen' },
  'max-w-full': { maxWidth: 'fill' }, 'rounded-none': { borderRadius: 0 }, 'rounded-sm': { borderRadius: 2 },
  rounded: { borderRadius: 4 }, 'rounded-lg': { borderRadius: 8 }, 'rounded-xl': { borderRadius: 12 },
  'rounded-2xl': { borderRadius: 16 }, 'rounded-full': { borderRadius: 9999 },
  'shadow-none': { elevation: 0 }, 'shadow-sm': { elevation: 1 }, shadow: { elevation: 2 },
  'shadow-md': { elevation: 4 }, 'shadow-lg': { elevation: 8 }, 'shadow-xl': { elevation: 12 }, 'shadow-2xl': { elevation: 16 }, 'overflow-hidden': { overflow: 'hidden' }, 'overflow-auto': { overflow: 'auto' }, 'overflow-y-auto': { overflowY: 'auto' }, 'overflow-y-scroll': { overflowY: 'scroll' }, 'overflow-x-auto': { overflowX: 'auto' }, 'overflow-x-scroll': { overflowX: 'scroll' },
  'object-contain': { objectFit: 'contain' }, 'object-cover': { objectFit: 'cover' }, 'object-fill': { objectFit: 'fill' }, 'object-none': { objectFit: 'none' },
  'tracking-tighter': { letterSpacing: -0.05 }, 'tracking-tight': { letterSpacing: -0.025 }, 'tracking-normal': { letterSpacing: 0 }, 'tracking-wide': { letterSpacing: 0.025 }, 'tracking-wider': { letterSpacing: 0.05 }, 'tracking-widest': { letterSpacing: 0.1 },
  'opacity-50': { opacity: 0.5 }, 'opacity-75': { opacity: 0.75 }, 'opacity-100': { opacity: 1 },
  'animate-fade-in': { animation: 'fade-in' }, 'animate-slide-up': { animation: 'slide-up' },
  'animate-scale-in': { animation: 'scale-in' }
}

// Tailwind's default spacing scale expressed in Android dp. The compiler
// keeps the token names intact so arbitrary values and project tokens can
// still extend it without changing the renderer contract.
const SPACING = {
  0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16,
  5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48,
  14: 56, 16: 64, 20: 80, 24: 96, 28: 112, 32: 128, 36: 144,
  40: 160, 44: 176, 48: 192, 52: 208, 56: 224, 60: 240, 64: 256,
  72: 288, 80: 320, 96: 384
}

function parseArbitrary(value) {
  if (!value?.startsWith('[') || !value.endsWith(']')) return undefined
  const raw = value.slice(1, -1).replace(/_/g, ' ')
  if (/^-?\d+(\.\d+)?px$/.test(raw)) return Number.parseFloat(raw)
  if (/^-?\d+(\.\d+)?rem$/.test(raw)) return Number.parseFloat(raw) * 16
  if (/^-?\d+(\.\d+)?%$/.test(raw)) return Number.parseFloat(raw)
  if (/^#?[0-9a-f]{3,8}$/i.test(raw)) return raw.startsWith('#') ? raw : `#${raw}`
  return raw
}

function spacingValue(value) { return parseArbitrary(value) ?? SPACING[value] }

function flattenColors(colors, prefix = '') {
  const result = {}
  for (const [key, value] of Object.entries(colors ?? {})) {
    const name = prefix ? `${prefix}-${key}` : key
    if (typeof value === 'string') result[name] = value
    else if (value && typeof value === 'object') Object.assign(result, flattenColors(value, name))
  }
  return result
}

function colorValue(name, colors) {
  return colors[name] ?? parseArbitrary(name)
}

function withOpacity(value, opacity) {
  if (!opacity) return value
  const amount = Math.max(0, Math.min(100, Number(opacity))) / 100
  if (value === 'transparent') return value
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const expanded = hex.length === 3 ? hex.split('').map(part => part + part).join('') : hex
    if (expanded.length === 6) return `rgba(${Number.parseInt(expanded.slice(0, 2), 16)}, ${Number.parseInt(expanded.slice(2, 4), 16)}, ${Number.parseInt(expanded.slice(4, 6), 16)}, ${amount})`
  }
  return `color-mix(in srgb, ${value} ${opacity}%, transparent)`
}

function utilityStyle(utility, colors) {
  const negative = utility.startsWith('-')
  const normalizedUtility = negative ? utility.slice(1) : utility
  if (negative && (normalizedUtility.startsWith('p-') || normalizedUtility.startsWith('gap-') || normalizedUtility.startsWith('space-'))) return undefined
  if (!negative && STATIC_UTILITIES[utility]) return STATIC_UTILITIES[utility]

  const gridColumnsMatch = normalizedUtility.match(/^grid-cols-([1-9]|1[0-2])$/)
  if (!negative && gridColumnsMatch) return { display: 'grid', gridColumns: Number(gridColumnsMatch[1]) }

  const ringMatch = normalizedUtility.match(/^ring(?:-(\d+))?$/)
  if (!negative && ringMatch) return { borderWidth: Number(ringMatch[1] ?? 1) }
  const ringColorMatch = normalizedUtility.match(/^ring-(.+?)(?:\/(\d{1,3}))?$/)
  if (!negative && ringColorMatch) {
    const value = colorValue(ringColorMatch[1], colors)
    if (value !== undefined) return { borderColor: withOpacity(value, ringColorMatch[2]) }
  }

  const gradientDirection = normalizedUtility.match(/^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/)
  if (!negative && gradientDirection) return { gradientDirection: gradientDirection[1] }
  const gradientColor = normalizedUtility.match(/^(from|via|to)-(.+?)(?:\/(\d{1,3}))?$/)
  if (!negative && gradientColor) {
    const value = colorValue(gradientColor[2], colors)
    if (value !== undefined && typeof value === 'string') return { [`gradient${gradientColor[1].charAt(0).toUpperCase()}${gradientColor[1].slice(1)}`]: withOpacity(value, gradientColor[3]) }
  }

  const colorMatch = normalizedUtility.match(/^(bg|text|border)-(.+?)(?:\/(\d{1,3}))?$/)
  if (colorMatch) {
    const value = colorValue(colorMatch[2], colors)
    if (value !== undefined && !(colorMatch[1] === 'text' && typeof value === 'number')) {
      const property = colorMatch[1] === 'bg' ? 'backgroundColor' : colorMatch[1] === 'text' ? 'color' : 'borderColor'
      return { [property]: withOpacity(value, colorMatch[3]) }
    }
  }

  const arbitraryText = normalizedUtility.match(/^text-\[(.+)\]$/)
  if (arbitraryText) {
    const value = parseArbitrary(`[${arbitraryText[1]}]`)
    if (typeof value === 'number') return { fontSize: value }
    if (value !== undefined) return { color: value }
  }

  const spacingMatch = normalizedUtility.match(/^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-x|space-y)-(.+)$/)
  if (spacingMatch) {
    const value = spacingValue(spacingMatch[2])
    if (value === undefined) return undefined
    const resolvedValue = negative ? -value : value
    const map = {
      p: ['padding'], px: ['paddingHorizontal'], py: ['paddingVertical'], pt: ['paddingTop'],
      pr: ['paddingRight'], pb: ['paddingBottom'], pl: ['paddingLeft'], m: ['margin'],
      mx: ['marginHorizontal'], my: ['marginVertical'], mt: ['marginTop'], mr: ['marginRight'],
      mb: ['marginBottom'], ml: ['marginLeft'], gap: ['gap'], 'space-x': ['gap'], 'space-y': ['gap']
    }
    return Object.fromEntries(map[spacingMatch[1]].map(property => [property, resolvedValue]))
  }

  const dimensionMatch = normalizedUtility.match(/^(w|h|min-w|min-h|max-w|max-h)-(.+)$/)
  if (dimensionMatch) {
    const value = dimensionMatch[2] === 'screen' ? 'screen' : dimensionMatch[2] === 'full' ? 'fill' : spacingValue(dimensionMatch[2])
    if (value === undefined) return undefined
    const property = { w: 'width', h: 'height', 'min-w': 'minWidth', 'min-h': 'minHeight', 'max-w': 'maxWidth', 'max-h': 'maxHeight' }[dimensionMatch[1]]
    return { [property]: value }
  }

  const insetMatch = normalizedUtility.match(/^(inset-x|inset-y|inset|top|right|bottom|left)-(.+)$/)
  if (insetMatch) {
    const value = spacingValue(insetMatch[2])
    if (value === undefined) return undefined
    const properties = {
      inset: ['inset'], 'inset-x': ['insetLeft', 'insetRight'], 'inset-y': ['insetTop', 'insetBottom'],
      top: ['top'], right: ['right'], bottom: ['bottom'], left: ['left']
    }[insetMatch[1]]
    const result = Object.fromEntries(properties.map(property => [property, value]))
    if (insetMatch[1] === 'inset-x') result.width = 'fill'
    if (insetMatch[1] === 'inset-y') result.height = 'fill'
    return result
  }
  const zIndexMatch = normalizedUtility.match(/^z-(\d+)$/)
  if (!negative && zIndexMatch) return { zIndex: Number(zIndexMatch[1]) }

  const borderMatch = normalizedUtility.match(/^border(?:-(\d+))?$/)
  if (borderMatch) return { borderWidth: Number(borderMatch[1] ?? 1) }
  const borderColorMatch = normalizedUtility.match(/^border-(.+)$/)
  if (borderColorMatch) {
    const value = colorValue(borderColorMatch[1], colors)
    if (value !== undefined) return { borderColor: withOpacity(value, undefined) }
  }
  const leadingMatch = normalizedUtility.match(/^leading-(\d+)$/)
  if (leadingMatch) {
    const leading = spacingValue(leadingMatch[1])
    if (leading !== undefined) return { lineHeight: leading }
  }
  return undefined
}

export function compileClasses(className = '', options = {}) {
  const style = {}
  const stateStyles = {}
  const responsiveStyles = {}
  const themeStyles = {}
  const responsiveStateStyles = {}
  const themeStateStyles = {}
  const warnings = []
  const colors = { ...COLORS, ...flattenColors(options.colors ?? options.theme?.colors) }
  for (const token of className.split(/\s+/).filter(Boolean)) {
    const pieces = token.split(':')
    const utility = pieces.pop()
    const variants = pieces
    const supportedVariants = new Set(['2xl', 'active', 'dark', 'disabled', 'focus', 'hover', 'light', 'lg', 'md', 'pressed', 'selected', 'sm', 'xl'])
    if (variants.some(variant => !supportedVariants.has(variant))) {
      warnings.push(`Unsupported native variant: ${token}`)
      continue
    }
    const declaration = utilityStyle(utility, colors)
    if (declaration && variants.length) {
      const responsive = variants.filter(variant => ['sm', 'md', 'lg', 'xl', '2xl'].includes(variant))
      const theme = variants.filter(variant => variant === 'dark' || variant === 'light')
      const interaction = variants.filter(variant => ['active', 'disabled', 'focus', 'hover', 'pressed', 'selected'].includes(variant))
      if (responsive.length > 1 || theme.length > 1 || interaction.length > 1 || (responsive.length && theme.length) || (responsive.length + theme.length + interaction.length !== variants.length)) {
        warnings.push(`Unsupported native variant combination: ${token}`)
        continue
      }
      const state = interaction[0] === 'active' ? 'pressed' : interaction[0] === 'focus' ? 'focused' : interaction[0] === 'hover' ? 'hovered' : interaction[0]
      if (responsive[0] && state) Object.assign((responsiveStateStyles[responsive[0]] ??= {})[state] ??= {}, declaration)
      else if (theme[0] && state) Object.assign((themeStateStyles[theme[0]] ??= {})[state] ??= {}, declaration)
      else if (responsive[0]) Object.assign(responsiveStyles[responsive[0]] ??= {}, declaration)
      else if (theme[0]) Object.assign(themeStyles[theme[0]] ??= {}, declaration)
      else if (state) Object.assign(stateStyles[state] ??= {}, declaration)
    } else if (declaration) Object.assign(style, declaration)
    else warnings.push(`Unsupported native utility: ${token}`)
  }
  return { style, stateStyles, responsiveStyles, themeStyles, responsiveStateStyles, themeStateStyles, warnings }
}

function propsFor(node) {
  const props = {}
  for (const prop of node.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) props[prop.name] = prop.value?.content ?? true
    else if (prop.type === NodeTypes.DIRECTIVE) {
      const argument = prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? prop.arg.content : undefined
      const modifierNames = (prop.modifiers ?? [])
        .map(modifier => typeof modifier === 'string' ? modifier : modifier?.content ?? modifier?.name)
        .filter(Boolean)
      const modifiers = modifierNames.length ? `.${modifierNames.join('.')}` : ''
      const name = prop.name === 'on'
        ? `@${argument ?? ''}${modifiers}`
        : prop.name === 'bind'
          ? (argument ? `:${argument}${modifiers}` : 'v-bind')
            : prop.name === 'model'
            ? `v-model${modifiers}`
            : prop.name === 'show'
              ? 'v-show'
            : `${prop.name}${argument ? `:${argument}` : ''}${modifiers}`
      props[name] = prop.exp?.content ?? true
    }
  }
  return props
}

function cssPropertyName(value) {
  return value.trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function parseInlineStyle(value) {
  const style = {}
  for (const declaration of String(value ?? '').split(';')) {
    const [property, ...parts] = declaration.split(':')
    if (!property || !parts.length) continue
    const raw = parts.join(':').trim()
    const numeric = raw.match(/^(-?\d+(?:\.\d+)?)(?:px|dp)?$/)
    style[cssPropertyName(property)] = numeric ? Number(numeric[1]) : raw
  }
  return style
}

function parseStyleBindings(expression) {
  if (typeof expression !== 'string') return {}
  const source = expression.trim().replace(/^\{/, '').replace(/\}$/, '')
  const bindings = {}
  for (const declaration of source.split(',')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    const property = cssPropertyName(declaration.slice(0, separator).replace(/["']/g, ''))
    const value = declaration.slice(separator + 1).trim()
    if (/^[A-Za-z_$][\w$]*$/.test(value) || /^['"].*['"]$/.test(value) || /^-?\d+(?:\.\d+)?$/.test(value)) bindings[property] = value
  }
  return bindings
}

function componentSourceWithProps(source, props) {
  return source.replace(/\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g, (_, name) => {
    const expression = props[`:${name}`]
    if (typeof expression === 'string') return `{{ ${expression} }}`
    const value = props[name]
    if (typeof value === 'string') return value
    if (Object.hasOwn(props, name)) return ''
    return `{{ ${name} }}`
  })
}

function componentTemplate(component) {
  return typeof component === 'string' ? component : component?.template ?? ''
}

function componentSetup(component) {
  return typeof component === 'string' ? '' : component?.script ?? ''
}

function componentBindings(source) {
  const declarations = [
    ...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g),
    ...source.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*/g)
  ].flatMap(match => match[1].includes(',')
    ? match[1].split(',').map(value => value.trim().split(/\s*:\s*/)[0])
    : [match[1]])
  const functions = [...source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1])
  const imports = []
  for (const match of source.matchAll(/^\s*import\s+(.+?)\s+from\s+['"][^'"]+['"]/gm)) {
    const clause = match[1].replace(/^type\s+/, '').trim()
    const named = clause.match(/\{([^}]+)\}/)?.[1] ?? ''
    for (const part of named.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) imports.push(name)
    }
    const defaultName = clause.split(',')[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(defaultName)) imports.push(defaultName)
    const namespaceName = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1]
    if (namespaceName) imports.push(namespaceName)
  }
  return [...new Set([...declarations, ...functions, ...imports].filter(name => /^[A-Za-z_$][\w$]*$/.test(name)))]
}

function rewriteExpression(expression, bindings, prefix) {
  if (typeof expression !== 'string') return expression
  return bindings.reduce((result, name) => result.replace(new RegExp(`\\b${name}\\b`, 'g'), `${prefix}_${name}`), expression)
}

function rewriteComponentNode(node, bindings, prefix) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'text-node' && node.content && typeof node.content === 'object') {
    node.content.expression = rewriteExpression(node.content.expression, bindings, prefix)
  }
  if (node.props && typeof node.props === 'object') {
    for (const [key, value] of Object.entries(node.props)) {
      if (key.startsWith('@')) node.props[key] = rewriteExpression(value, bindings, prefix)
      else if (key.startsWith(':') || key === 'v-model') node.props[key] = rewriteExpression(value, bindings, prefix)
    }
  }
  if (node.condition) node.condition = rewriteExpression(node.condition, bindings, prefix)
  if (node.source) node.source = rewriteExpression(node.source, bindings, prefix)
  if (Array.isArray(node.children)) node.children.forEach(child => rewriteComponentNode(child, bindings, prefix))
  if (Array.isArray(node.branches)) node.branches.forEach(branch => {
    branch.condition = branch.condition ? rewriteExpression(branch.condition, bindings, prefix) : branch.condition
    if (Array.isArray(branch.children)) branch.children.forEach(child => rewriteComponentNode(child, bindings, prefix))
  })
  if (Array.isArray(node.variants)) node.variants.forEach(variant => variant.nodes?.forEach(child => rewriteComponentNode(child, bindings, prefix)))
}

function expandComponentSlots(node, slots) {
  if (node.type === 'slot') {
    const name = node.props?.name ?? 'default'
    return slots[name] ?? node.children ?? []
  }
  return [{ ...node, children: Array.isArray(node.children) ? node.children.flatMap(child => expandComponentSlots(child, slots)) : node.children }]
}

function componentSlots(children, diagnostics, options) {
  const slots = { default: [] }
  for (const child of children) {
    const slotDirective = child.type === NodeTypes.ELEMENT && child.tag === 'template'
      ? child.props.find(prop => prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot')
      : undefined
    const name = slotDirective?.arg?.type === NodeTypes.SIMPLE_EXPRESSION
      ? slotDirective.arg.content
      : slotDirective
        ? 'default'
        : 'default'
    const content = child.type === NodeTypes.ELEMENT && child.tag === 'template' && slotDirective ? child.children : [child]
    slots[name] ??= []
    slots[name].push(...transformChildren(content, diagnostics, options))
  }
  return slots
}

function dynamicComponentName(expression) {
  if (typeof expression !== 'string') return undefined
  const match = expression.trim().match(/^['"]([^'"]+)['"]$/)
  return match?.[1]
}

function compileComponentVariant(source, props, slots, diagnostics, options) {
  const descriptor = typeof source === 'string' ? { template: source, script: '' } : source
  const componentSource = componentSourceWithProps(componentTemplate(descriptor), props)
  const context = options.componentContext ?? { next: 0, scripts: [] }
  let prefix
  if (componentSetup(descriptor)) {
    prefix = `__nuxtComponent${context.next++}`
    context.scripts.push({ id: prefix, prefix, source: componentSetup(descriptor), filename: descriptor.filename, projectRoot: options.projectRoot, language: descriptor.language ?? 'js', props, bindings: componentBindings(componentSetup(descriptor)) })
  }
  const compiled = compileTemplate(componentSource, { ...options, strict: false, componentContext: context })
  diagnostics.push(...compiled.diagnostics)
  if (prefix) compiled.nodes.forEach(node => rewriteComponentNode(node, componentBindings(componentSetup(descriptor)), prefix))
  return compiled.nodes.flatMap(node => expandComponentSlots(node, slots))
}

/** Compile an app shell or layout with its own instance-scoped setup block. */
export function compileScopedTemplate(template, script = '', options = {}) {
  const context = options.componentContext ?? { next: 0, scripts: [], scopeNext: 0 }
  const result = compileTemplate(template, { ...options, componentContext: context })
  const source = String(script ?? '').trim()
  if (!source) return result
  const prefix = options.scopePrefix ?? `__nuxtShell${context.scopeNext ?? 0}`
  context.scopeNext = (context.scopeNext ?? 0) + 1
  const bindings = componentBindings(source)
  context.scripts.push({
    id: prefix,
    prefix,
    source,
    filename: options.filename,
    projectRoot: options.projectRoot,
    language: options.language ?? 'js',
    props: {},
    bindings
  })
  result.nodes.forEach(node => rewriteComponentNode(node, bindings, prefix))
  return { ...result, componentScripts: [...result.componentScripts, context.scripts[context.scripts.length - 1]], scopePrefix: prefix }
}

function directive(node, name) {
  return node.props.find(prop => prop.type === NodeTypes.DIRECTIVE && prop.name === name)
}

function withoutDirectives(node, names) {
  return { ...node, props: node.props.filter(prop => !(prop.type === NodeTypes.DIRECTIVE && names.includes(prop.name))) }
}

function parseForExpression(expression) {
  const match = expression?.match(/^\s*(?:\(([^)]+)\)|([^\s]+))\s+(?:in|of)\s+(.+)\s*$/)
  if (!match) return undefined
  const variables = (match[1] ?? match[2]).split(',').map(value => value.trim()).filter(Boolean)
  return {
    value: variables[0],
    // The second binding is the item's key for object sources and the
    // array index for array sources. The native renderer supplies the
    // source-appropriate value at runtime, so retain that binding in the
    // key slot for both forms; a third binding is always the index.
    key: variables.length > 1 ? variables[1] : undefined,
    index: variables.length === 2 ? variables[1] : variables[2],
    source: match[3]
  }
}

function transformChildren(children, diagnostics, options) {
  const output = []
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    if (child.type !== NodeTypes.ELEMENT) {
      const transformed = transform(child, diagnostics, options)
      if (transformed) output.push(transformed)
      continue
    }

    const ifDirective = directive(child, 'if')
    if (ifDirective) {
      const branches = [{
        condition: ifDirective.exp?.content ?? 'false',
        children: [transform(withoutDirectives(child, ['if']), diagnostics, options)].filter(Boolean)
      }]
      let next = index + 1
      while (next < children.length) {
        const sibling = children[next]
        if (sibling.type !== NodeTypes.ELEMENT) break
        const elseIf = directive(sibling, 'else-if')
        const elseDirective = directive(sibling, 'else')
        if (!elseIf && !elseDirective) break
        branches.push({
          condition: elseIf?.exp?.content ?? null,
          children: [transform(withoutDirectives(sibling, ['else-if', 'else']), diagnostics, options)].filter(Boolean)
        })
        next++
        if (elseDirective) break
      }
      output.push({ type: 'conditional', branches })
      index = next - 1
      continue
    }

    if (directive(child, 'else') || directive(child, 'else-if')) {
      diagnostics.push({ level: 'warning', message: 'v-else/v-else-if must follow v-if', tag: child.tag })
      continue
    }

    const forDirective = directive(child, 'for')
    if (forDirective) {
      const parsed = parseForExpression(forDirective.exp?.content)
      if (!parsed) {
        diagnostics.push({ level: 'warning', message: `Unsupported v-for expression: ${forDirective.exp?.content ?? ''}`, tag: child.tag })
        continue
      }
      output.push({
        type: 'for',
        source: parsed.source,
        value: parsed.value,
        key: parsed.key,
        index: parsed.index,
        track: propsFor(child)[':key'] ?? propsFor(child).key,
        children: [transform(withoutDirectives(child, ['for']), diagnostics, options)].filter(Boolean)
      })
      continue
    }

    const transformed = transform(child, diagnostics, options)
    if (transformed) output.push(transformed)
  }
  return output
}

function transform(node, diagnostics, options) {
  if (node.type === NodeTypes.TEXT) return { type: 'text-node', content: node.content }
  if (node.type === NodeTypes.INTERPOLATION) return { type: 'text-node', content: { expression: node.content.content } }
  if (node.type !== NodeTypes.ELEMENT) return undefined

  const props = propsFor(node)
  let type = ELEMENTS[node.tag] ?? 'component'
  if (node.tag === 'input') {
    type = ({ checkbox: 'checkbox', radio: 'radio', switch: 'switch', range: 'seekbar' }[String(props.type).toLowerCase()] ?? 'text-input')
  }
  const compiledClasses = compileClasses(typeof props.class === 'string' ? props.class : '', options)
  const staticStyle = typeof props.style === 'string' ? parseInlineStyle(props.style) : {}
  const style = { ...staticStyle, ...compiledClasses.style }
  const stateStyles = compiledClasses.stateStyles
  const styleBindings = parseStyleBindings(props[':style'])
  diagnostics.push(...compiledClasses.warnings.map(message => ({ level: 'warning', message, tag: node.tag })))
  if (node.tag === 'ClientOnly') {
    return { type: 'client-only', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'Head') {
    return { type: 'head', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'Title' || node.tag === 'Meta' || node.tag === 'Link') {
    return { type, tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'NuxtRouteAnnouncer') {
    return { type: 'route-announcer', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'NuxtIsland') {
    const slots = componentSlots(node.children, diagnostics, options)
    return { type: 'island', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: slots.default, fallback: slots.fallback ?? [] }
  }
  if (node.tag === 'NuxtErrorBoundary') {
    const slots = componentSlots(node.children, diagnostics, options)
    return { type: 'error-boundary', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: slots.default, fallback: slots.error ?? slots.fallback ?? [] }
  }
  if (node.tag === 'KeepAlive') {
    return { type: 'keep-alive', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'Transition') {
    return { type: 'transition', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'Suspense') {
    const slots = componentSlots(node.children, diagnostics, options)
    return { type: 'suspense', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: slots.default, fallback: slots.fallback ?? [] }
  }
  if (node.tag === 'Teleport') {
    return { type: 'portal', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], children: transformChildren(node.children, diagnostics, options) }
  }
  if (node.tag === 'component' && (props.is || props[':is'])) {
    const selector = props[':is'] ?? props.is
    const slots = componentSlots(node.children, diagnostics, options)
    const names = dynamicComponentName(selector)
      ? [dynamicComponentName(selector)]
      : Object.keys(options.components ?? {})
    const variants = names.filter(name => options.components?.[name]).map(name => ({
      name,
      nodes: compileComponentVariant(options.components[name], props, slots, diagnostics, options)
    }))
    return { type: 'dynamic-component', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'], variants }
  }
  if (type === 'component' && options.components?.[node.tag]) {
    const slots = componentSlots(node.children, diagnostics, options)
    return {
      type: 'component', tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'],
      children: compileComponentVariant(options.components[node.tag], props, slots, diagnostics, options)
    }
  }
  return {
    type, tag: node.tag, props, style, stateStyles, responsiveStyles: compiledClasses.responsiveStyles, themeStyles: compiledClasses.themeStyles, responsiveStateStyles: compiledClasses.responsiveStateStyles, themeStateStyles: compiledClasses.themeStateStyles, styleBindings, classBinding: props[':class'],
    children: transformChildren(node.children, diagnostics, options)
  }
}

export function compileTemplate(template, options = {}) {
  const componentContext = options.componentContext ?? { next: 0, scripts: [] }
  const initialScriptCount = componentContext.scripts.length
  const compileOptions = { ...options, componentContext }
  const diagnostics = []
  const ast = baseParse(template, { comments: false })
  const nodes = transformChildren(ast.children, diagnostics, compileOptions)
  const unsupported = nodes.flatMap(node => node.tag && node.tag !== 'component' && !ELEMENTS[node.tag] && !compileOptions.components?.[node.tag] ? [node.tag] : [])
  if (compileOptions.strict && unsupported.length) throw new Error(`Unsupported native elements: ${[...new Set(unsupported)].join(', ')}`)
  const styleTokens = { ...COLORS, ...flattenColors(options.colors ?? options.theme?.colors) }
  return { version: 2, renderer: 'android-native', nodes, diagnostics, styleTokens, componentScripts: componentContext.scripts.slice(initialScriptCount) }
}
