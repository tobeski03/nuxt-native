const PAGE_EXTENSIONS = /\.(vue|js|ts|jsx|tsx)$/

function normalizePath(value) {
  const path = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return path ? `/${path}` : '/'
}

function segmentToRoute(segment) {
  if (segment.startsWith('[[...') && segment.endsWith(']]')) return { path: `*${segment.slice(5, -2)}`, kind: 'optional-catchall' }
  if (segment.startsWith('[...') && segment.endsWith(']')) return { path: `*${segment.slice(4, -1)}`, kind: 'catchall' }
  if (segment.startsWith('[[') && segment.endsWith(']]')) return { path: `:${segment.slice(2, -2)}?`, kind: 'optional' }
  if (segment.startsWith('[') && segment.endsWith(']')) return { path: `:${segment.slice(1, -1)}`, kind: 'dynamic' }
  return { path: segment, kind: 'static' }
}

export function pageFileToRoute(file) {
  const normalized = file.replace(/\\/g, '/')
  const marker = normalized.indexOf('/pages/')
  const relative = marker >= 0 ? normalized.slice(marker + 7) : normalized.replace(/^pages\//, '')
  const withoutExtension = relative.replace(PAGE_EXTENSIONS, '')
  const rawSegments = withoutExtension.split('/').filter(Boolean).filter(segment => !segment.startsWith('-'))
  const segments = rawSegments.filter(segment => segment !== 'index' && !/^\(.+\)$/.test(segment))
  const converted = segments.map(segmentToRoute)
  const path = normalizePath(converted.map(item => item.path).join('/'))
  const name = rawSegments.length ? rawSegments.map(segment => segment.replace(/[\[\].]+/g, '') || 'index').join('-') : 'index'
  const score = converted.reduce((total, item) => total + ({ static: 40, dynamic: 20, optional: 10, catchall: 5, 'optional-catchall': 1 }[item.kind] ?? 0), 0) + converted.length

  return { name, path, file: normalized, score, segments: converted }
}

export function createRouteManifest(files) {
  return files
    .filter(file => PAGE_EXTENSIONS.test(file) && file.replace(/\\/g, '/').includes('/pages/'))
    .map(pageFileToRoute)
    .sort((a, b) => b.score - a.score || b.path.length - a.path.length)
}

function compileRoute(route) {
  const keys = []
  const expression = route.path.split('/').filter(Boolean).map(segment => {
    if (segment.startsWith('*')) {
      keys.push({ name: segment.slice(1), catchall: true })
      return '(.*)'
    }
    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?')
      keys.push({ name: segment.slice(1, optional ? -1 : undefined), optional })
      return optional ? '([^/]*)?' : '([^/]+)'
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  const pattern = expression.length ? `/${expression.join('/')}/?` : '/'
  return { ...route, keys, regex: new RegExp(`^${pattern}$`) }
}

export function matchRoute(manifest, location) {
  const pathname = normalizePath(String(location).split(/[?#]/)[0])
  for (const route of manifest.map(compileRoute)) {
    const match = route.regex.exec(pathname)
    if (!match) continue
    const params = {}
    route.keys.forEach((key, index) => {
      const value = match[index + 1]
      if (value !== undefined && value !== '') params[key.name] = decodeURIComponent(value)
    })
    return { route, params, path: pathname }
  }
  return undefined
}

export function createRouter(manifest, options = {}) {
  const listeners = new Set()
  const history = []
  let index = -1

  function commit(path, replace = false) {
    const resolved = matchRoute(manifest, path)
    if (!resolved) throw new Error(`Route not found: ${path}`)
    if (replace && index >= 0) history[index] = resolved
    else {
      history.splice(index + 1)
      history.push(resolved)
      index += 1
    }
    listeners.forEach(listener => listener(resolved))
    return resolved
  }

  commit(options.initialPath ?? '/')
  return {
    current: () => history[index],
    push: path => commit(path),
    replace: path => commit(path, true),
    back: () => {
      if (index === 0) return history[index]
      index -= 1
      const resolved = history[index]
      listeners.forEach(listener => listener(resolved))
      return resolved
    },
    forward: () => {
      if (index >= history.length - 1) return history[index]
      index += 1
      const resolved = history[index]
      listeners.forEach(listener => listener(resolved))
      return resolved
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
