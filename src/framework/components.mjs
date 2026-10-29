import { relative } from 'node:path'

function pascalSegment(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** Resolve a Nuxt-style nested component file to its auto-import name. */
export function componentName(file, root) {
  const path = relative(root, file).replace(/\\/g, '/')
  const segments = path.replace(/\.vue$/i, '').split('/').filter(Boolean)
  const names = segments[segments.length - 1]?.toLowerCase() === 'index'
    ? segments.slice(0, -1)
    : segments
  return names.map(pascalSegment).join('') || 'Index'
}
