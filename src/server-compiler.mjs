import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, sep } from 'node:path'
import { build, transform } from 'esbuild'

function stripExtension(file) {
  return file.replace(/\.(?:[cm]?[jt]s|tsx?)$/i, '')
}

function serverSegmentToRoute(segment) {
  if (segment.startsWith('[[...') && segment.endsWith(']]')) return `*${segment.slice(5, -2)}`
  if (segment.startsWith('[...') && segment.endsWith(']')) return `*${segment.slice(4, -1)}`
  if (segment.startsWith('[[') && segment.endsWith(']]')) return `:${segment.slice(2, -2)}?`
  if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`
  return segment
}

export function serverFileToRoute(file) {
  const normalized = file.split(sep).join('/')
  const withoutExtension = stripExtension(normalized)
  const methodMatch = withoutExtension.match(/\.([a-z]+)$/i)
  const method = (methodMatch?.[1] ?? 'get').toUpperCase()
  const routeFile = methodMatch ? withoutExtension.slice(0, -methodMatch[0].length) : withoutExtension
  const segments = routeFile.split('/').filter(Boolean)
  if (segments.at(-1) === 'index') segments.pop()
  const path = `/${segments.map(serverSegmentToRoute).join('/')}`.replace(/\/+/g, '/') || '/'
  return { path, method, file: normalized }
}

export async function discoverServerRoutes(root = 'server') {
  const files = []
  async function visit(directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(entry.name)) {
        const normalized = path.replace(/\\/g, '/')
        if (!normalized.includes('/middleware/') && !normalized.includes('/plugins/') && !normalized.includes('/utils/')) files.push(path)
      }
    }
  }
  await visit(root)
  return files.map((file) => serverFileToRoute(relative(root, file)))
}

export async function discoverServerMiddleware(root = 'server/middleware') {
  const files = []
  async function visit(directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(entry.name)) files.push(path)
    }
  }
  await visit(root)
  return files.map(file => ({
    name: basename(stripExtension(file)),
    file: file.replace(/\\/g, '/')
  }))
}

export async function discoverServerPlugins(root = 'server/plugins') {
  const files = []
  async function visit(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(entry.name)) files.push(path)
    }
  }
  await visit(root)
  return files.sort().map(file => ({
    name: relative(root, file).replace(/\\/g, '/').replace(/\.(?:[cm]?[jt]s|tsx?)$/i, ''),
    file: file.replace(/\\/g, '/')
  }))
}

export async function discoverServerUtils(root = 'server/utils') {
  const files = []
  async function visit(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) await visit(path)
      else if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(entry.name)) files.push(path)
    }
  }
  await visit(root)
  return files.sort()
}

function utilityExports(source) {
  return [
    ...source.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g),
    ...source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g),
    ...source.matchAll(/export\s*\{([^}]+)\}/g)
  ].flatMap(match => match[0].startsWith('export {')
    ? match[1].split(',').map(value => {
      const parts = value.trim().split(/\s+as\s+/)
      return parts[1] || parts[0]
    }).filter(Boolean)
    : [match[1]])
}

async function compileServerUtility(entry) {
  const source = typeof entry === 'string' ? await readFile(entry, 'utf8') : entry.source
  const filename = typeof entry === 'string' ? entry : entry.filename
  if (/^\s*import\s|\n\s*import\s/m.test(source)) throw new Error(`Server utility imports are not supported in embedded auto-imports: ${filename}`)
  const compiled = await transform(source, {
    loader: extname(filename).toLowerCase() === '.ts' ? 'ts' : 'js',
    target: 'es2015', legalComments: 'none', sourcemap: false, sourcefile: filename
  })
  const code = compiled.code
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|class)\b)/g, '')
    .replace(/\bexport\s+(?=(?:const|let|var)\b)/g, '')
    .replace(/\bexport\s*\{[^}]*\};?/g, '')
  if (/\bimport\s/.test(code)) throw new Error(`Server utility imports are not supported in embedded auto-imports: ${filename}`)
  return { code, exports: utilityExports(source), filename }
}

async function prepareServerUtilities(utilities = []) {
  const sources = await Promise.all(utilities.map(async entry => ({
    entry,
    source: typeof entry === 'string' ? await readFile(entry, 'utf8') : entry.source,
    filename: typeof entry === 'string' ? entry : entry.filename
  })))
  const seen = new Map()
  for (const utility of sources) for (const name of utilityExports(utility.source)) {
    if (seen.has(name)) throw new Error(`Server auto-import "${name}" is declared by both ${seen.get(name)} and ${utility.filename}`)
    seen.set(name, utility.filename)
  }
  if (!sources.some(({ source }) => /^\s*import\s|\n\s*import\s/m.test(source))) {
    return Promise.all(sources.map(({ entry }) => compileServerUtility(entry)))
  }

  const exports = [...seen.keys()]
  const virtualUtilities = new Map()
  const entrySource = sources.map(({ filename, source }, index) => {
    const names = utilityExports(source)
    if (!names.length) return ''
    const path = `nuxt-native-server-utility:${index}`
    virtualUtilities.set(path, { filename, source })
    return `export { ${names.join(', ')} } from ${JSON.stringify(path)}`
  }).filter(Boolean).join('\n')
  const bundled = await build({
    stdin: { contents: entrySource, sourcefile: 'nuxt-native-server-utils-entry.js' },
    bundle: true,
    format: 'iife',
    globalName: '__nuxtServerUtilities',
    platform: 'neutral',
    target: 'es2015',
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'nuxt-native-server-utility-loader',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^nuxt-native-server-utility:/ }, args => ({ path: args.path, namespace: 'nuxt-native-server-utility' }))
        pluginBuild.onLoad({ filter: /.*/, namespace: 'nuxt-native-server-utility' }, args => {
          const utility = virtualUtilities.get(args.path)
          if (!utility) return null
          return {
            contents: utility.source,
            loader: extname(utility.filename).toLowerCase() === '.ts' ? 'ts' : 'js',
            resolveDir: dirname(utility.filename)
          }
        })
      }
    }]
  })
  const bindings = exports.map(name => `var ${name} = __nuxtServerUtilities.${name};`).join('\n')
  return [{
    code: `${bundled.outputFiles[0].text}\n${bindings}`,
    exports,
    filename: sources.map(({ filename }) => filename).join(', ')
  }]
}

export async function compileServerRoute(source, { filename = 'server.ts', utilities = [] } = {}) {
  const transformedSource = source.replace(/export\s+default\s+/, 'var __nuxtServerHandler = ')
  const compiled = await transform(transformedSource, {
    loader: extname(filename).toLowerCase() === '.ts' ? 'ts' : 'js',
    // Lower async functions to generators so the embedded host can drain a
    // framework-owned Promise queue without requiring QuickJS's unavailable
    // pending-job executor.
    target: 'es2015',
    legalComments: 'none',
    sourcemap: false,
    sourcefile: filename
  })
  const utilityCode = utilities.length
    ? (await prepareServerUtilities(utilities)).map(entry => entry.code).join('\n')
    : ''
  const nitroHelpers = `
function isError(error) { return !!(error && (error instanceof Error || error.statusCode !== undefined || error.statusMessage !== undefined)); }
function isMethod(event, expected, allowHead) { var actual = getMethod(event).toUpperCase(); var names = Array.isArray(expected) ? expected : [expected]; for (var index = 0; index < names.length; index++) if (actual === String(names[index]).toUpperCase()) return true; return !!allowHead && actual === 'HEAD' && names.some(function(name) { return String(name).toUpperCase() === 'GET'; }); }
function assertMethod(event, expected, allowHead) { if (!isMethod(event, expected, allowHead)) { var names = Array.isArray(expected) ? expected.join(', ') : String(expected); var error = createError({ statusCode: 405, statusMessage: 'Method Not Allowed', data: { allow: names } }); setHeader(event, 'allow', names); throw error; } return true; }
function sendError(event, error, options) { var failure = isError(error) ? error : createError(error); var status = failure.statusCode || failure.statusCodeValue || 500; var message = failure.statusMessage || failure.message || 'Server error'; setResponseStatus(event, status, message); return send(event, { statusCode: status, statusMessage: message, message: failure.message || message, data: failure.data === undefined ? null : failure.data }); }
function __nuxtValidateResult(original, result, label) { if (result === false || result === null || result === undefined) throw createError({ statusCode: 400, statusMessage: 'Invalid ' + label }); return result === true ? original : result; }
function __nuxtValidate(value, validator, label) { if (typeof validator !== 'function') return value; try { var result = validator(value); if (result && typeof result.then === 'function') return result.then(function(validated) { return __nuxtValidateResult(value, validated, label); }, function(error) { if (error && error.statusCode) throw error; throw createError({ statusCode: 400, statusMessage: 'Invalid ' + label, data: { cause: error && error.message || String(error) } }); }); return __nuxtValidateResult(value, result, label); } catch (error) { if (error && error.statusCode) throw error; throw createError({ statusCode: 400, statusMessage: 'Invalid ' + label, data: { cause: error && error.message || String(error) } }); } }
function readRawBody(event) { return event && event.rawBody !== undefined ? event.rawBody : readBody(event); }
function readValidatedBody(event, validator) { return __nuxtValidate(readBody(event), validator, 'request body'); }
function getValidatedQuery(event, validator) { return __nuxtValidate(getQuery(event), validator, 'query'); }
`
  return {
    code: `
function NuxtPromise(executor) { var self = this; self.status = 0; self.value = undefined; self.handlers = []; function settle(status, value) { if (self.status !== 0) return; self.status = status; self.value = value; var pending = self.handlers.slice(); self.handlers.length = 0; for (var i = 0; i < pending.length; i++) __nuxtQueueJob(function(handler) { return function() { run(handler); }; }(pending[i])); } function resolve(value) { if (value === self) return reject(new TypeError('Promise cannot resolve itself')); if (value && typeof value.then === 'function') return value.then(resolve, reject); settle(1, value); } function reject(error) { settle(2, error); } function run(handler) { if (self.status === 0) return; var callback = self.status === 1 ? handler.onFulfilled : handler.onRejected; if (typeof callback !== 'function') return (self.status === 1 ? handler.resolve : handler.reject)(self.value); try { handler.resolve(callback(self.value)); } catch (error) { handler.reject(error); } } self.then = function(onFulfilled, onRejected) { return new NuxtPromise(function(resolveNext, rejectNext) { var handler = { onFulfilled: onFulfilled, onRejected: onRejected, resolve: resolveNext, reject: rejectNext }; if (self.status === 0) self.handlers.push(handler); else __nuxtQueueJob(function() { run(handler); }); }); }; self.catch = function(onRejected) { return self.then(null, onRejected); }; self.finally = function(callback) { return self.then(function(value) { callback(); return value; }, function(error) { callback(); throw error; }); }; try { executor(resolve, reject); } catch (error) { reject(error); } }
NuxtPromise.resolve = function(value) { return value && typeof value.then === 'function' ? value : new NuxtPromise(function(resolve) { resolve(value); }); };
NuxtPromise.reject = function(error) { return new NuxtPromise(function(resolve, reject) { reject(error); }); };
var Promise = NuxtPromise;
var __nuxtServerJobs = [];
function __nuxtQueueJob(job) { if (typeof job === 'function') __nuxtServerJobs.push(job); }
function __nuxtDrainJobs() { while (__nuxtServerJobs.length) { var pending = __nuxtServerJobs.splice(0, __nuxtServerJobs.length); while (pending.length) { var job = pending.shift(); try { job(); } catch (error) {} } } }
function defineEventHandler(handler) { return handler; }
function defineNitroPlugin(plugin) { return plugin; }
var __nuxtServerHooks = typeof __nuxtServerHooks === 'undefined' ? {} : __nuxtServerHooks;
function __nuxtRegisterServerHook(name, callback) { if (typeof callback !== 'function') return; var key = String(name); (__nuxtServerHooks[key] || (__nuxtServerHooks[key] = [])).push(callback); }
function __nuxtRunServerHook(name, payload) { var list = (__nuxtServerHooks[String(name)] || []).slice(); for (var i = 0; i < list.length; i++) { try { var result = list[i](payload); if (result === false && payload && typeof payload === 'object') payload.__nuxtAborted = true; } catch (error) { if (payload && typeof payload === 'object' && !payload.__nuxtHookError) payload.__nuxtHookError = { statusCode: error && error.statusCode || 500, statusMessage: error && error.statusMessage || error && error.message || 'Server plugin hook failed', message: error && error.message || 'Server plugin hook failed', data: error && error.data === undefined ? null : error.data }; } } return payload; }
function __nuxtCreateNitroApp() { return { hooks: { hook: __nuxtRegisterServerHook } }; }
function readBody(event) { return event.body; }
function getMethod(event) { return event.method || 'GET'; }
function getRequestURL(event) { return event.url || event.path || '/'; }
function getRequestPath(event) { if (event && event.path) return String(event.path); var url = String(getRequestURL(event)); var scheme = url.indexOf('://'); if (scheme >= 0) { var slash = url.indexOf('/', scheme + 3); url = slash >= 0 ? url.slice(slash) : '/'; } var marker = url.search(/[?#]/); return marker < 0 ? url : url.slice(0, marker); }
function getQuery(event) { return event.query || {}; }
function getRouterParams(event) { return event.params || {}; }
function getRouterParam(event, name) { var params = getRouterParams(event); return params[String(name)]; }
function getHeader(event, name) { var headers = event.headers || {}; var target = String(name).toLowerCase(); if (headers[target] !== undefined) return headers[target]; for (var key in headers) if (Object.prototype.hasOwnProperty.call(headers, key) && String(key).toLowerCase() === target) return headers[key]; return undefined; }
function getRequestHeader(event, name) { return getHeader(event, name); }
function getRequestHeaders(event) { var source = event.headers || {}; var result = {}; for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) result[String(key).toLowerCase()] = source[key]; return result; }
function getRequestProtocol(event) { var forwarded = getHeader(event, 'x-forwarded-proto'); if (forwarded) return String(forwarded).split(',')[0].trim(); if (event.protocol) return String(event.protocol); return String(getRequestURL(event)).toLowerCase().indexOf('https://') === 0 ? 'https' : 'http'; }
function getRequestHost(event) { return event.host || getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || ''; }
function getRequestIP(event) { var forwarded = getHeader(event, 'x-forwarded-for'); if (forwarded) return String(forwarded).split(',')[0].trim(); return event.ip || getHeader(event, 'x-real-ip') || ''; }
function setHeader(event, name, value) { event.responseHeaders = event.responseHeaders || {}; event.responseHeaders[String(name).toLowerCase()] = Array.isArray(value) ? value.slice() : String(value); }
function setResponseHeaders(event, headers) { var source = headers || {}; for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) setHeader(event, key, source[key]); }
function getResponseHeader(event, name) { var headers = event.responseHeaders || {}; return headers[String(name).toLowerCase()]; }
function appendResponseHeader(event, name, value) { var key = String(name).toLowerCase(); var current = getResponseHeader(event, key); if (current === undefined) return setHeader(event, key, value); var values = Array.isArray(current) ? current.slice() : [current]; if (Array.isArray(value)) values.push.apply(values, value); else values.push(value); setHeader(event, key, values); }
function removeResponseHeader(event, name) { var headers = event.responseHeaders || {}; delete headers[String(name).toLowerCase()]; }
function __nuxtCookieMap(event) { var headers = event && event.headers || {}; var raw = headers.cookie || headers.Cookie || ''; var result = {}; String(raw).split(';').forEach(function(part) { var marker = part.indexOf('='); if (marker < 0) return; var key = part.slice(0, marker).trim(); if (!key) return; var value = part.slice(marker + 1).trim(); try { result[key] = decodeURIComponent(value); } catch (error) { result[key] = value; } }); return result; }
function getCookie(event, name) { return __nuxtCookieMap(event)[String(name)]; }
function __nuxtCookieEncode(value) { return encodeURIComponent(String(value)).replace(/[!'()*]/g, function(character) { return '%' + character.charCodeAt(0).toString(16).toUpperCase(); }); }
function __nuxtCookieSameSite(value) { if (value === true) return 'Strict'; var normalized = String(value || '').toLowerCase(); return normalized === 'lax' ? 'Lax' : normalized === 'strict' ? 'Strict' : normalized === 'none' ? 'None' : ''; }
function __nuxtSerializeCookie(name, value, options) { var config = options || {}; var line = __nuxtCookieEncode(name) + '=' + (value === null || value === undefined ? '' : __nuxtCookieEncode(value)); if (config.maxAge !== undefined) line += '; Max-Age=' + Math.max(0, Math.floor(Number(config.maxAge) || 0)); if (config.expires) { var date = config.expires instanceof Date ? config.expires : new Date(config.expires); if (!isNaN(date.getTime())) line += '; Expires=' + date.toUTCString(); } if (config.domain) line += '; Domain=' + String(config.domain); if (config.path) line += '; Path=' + String(config.path); var sameSite = __nuxtCookieSameSite(config.sameSite); if (sameSite) line += '; SameSite=' + sameSite; if (config.httpOnly) line += '; HttpOnly'; if (config.secure) line += '; Secure'; return line; }
function setCookie(event, name, value, options) { event.responseHeaders = event.responseHeaders || {}; var header = __nuxtSerializeCookie(name, value, options); var current = event.responseHeaders['set-cookie']; if (!current) event.responseHeaders['set-cookie'] = [header]; else if (Array.isArray(current)) current.push(header); else event.responseHeaders['set-cookie'] = [String(current), header]; return value; }
function deleteCookie(event, name, options) { var config = {}; var source = options || {}; for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) config[key] = source[key]; config.maxAge = 0; config.expires = new Date(0); return setCookie(event, name, '', config); }
function setResponseStatus(event, status, message) { event.statusCode = status; if (message) event.statusMessage = message; }
function getResponseStatus(event) { return event.statusCode || 200; }
function send(event, body) { event.responseBody = body; return body; }
function sendNoContent(event, status) { setResponseStatus(event, status === undefined ? 204 : status); event.responseBody = null; return null; }
function sendRedirect(event, location, code) { var status = code === undefined ? 302 : Number(code); setResponseStatus(event, status); setHeader(event, 'location', location); return ''; }
function createError(input) { var error = new Error(typeof input === 'string' ? input : (input && input.statusMessage) || (input && input.message) || 'Server error'); if (input && input.statusCode) error.statusCode = input.statusCode; if (input && input.statusMessage) error.statusMessage = input.statusMessage; if (input && input.data !== undefined) error.data = input.data; return error; }
${nitroHelpers}
${utilityCode}
${compiled.code}
function __nuxtInvokeServerHandler(event) { var completed = false; var result; var failure; try { var handler = __nuxtServerHandler; if (handler && handler.hooks) for (var hookName in handler.hooks) if (Object.prototype.hasOwnProperty.call(handler.hooks, hookName)) __nuxtRegisterServerHook(hookName, handler.hooks[hookName]); var value = typeof handler === 'function' ? handler(event) : handler; if (value && typeof value.then === 'function') { value.then(function(next) { result = next; completed = true; }, function(error) { failure = error; completed = true; }); __nuxtDrainJobs(); if (!completed) throw new Error('Embedded async server handler did not settle synchronously'); if (failure) throw failure; return result; } return value; } finally { __nuxtDrainJobs(); } }
`,
    handler: '__nuxtServerHandler',
    mode: 'embedded-async-compatible'
  }
}

export async function compileServerDirectory(root = 'server', { utilities = [] } = {}) {
  const routes = await discoverServerRoutes(root)
  const seen = new Map()
  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    const previous = seen.get(key)
    if (previous) throw new Error(`Duplicate server route "${key}" from ${previous} and ${route.file}`)
    seen.set(key, route.file)
  }
  return Promise.all(routes.map(async (route) => ({
    ...route,
    source: await readFile(`${root}/${route.file}`, 'utf8'),
    compiled: await compileServerRoute(await readFile(`${root}/${route.file}`, 'utf8'), { filename: route.file, utilities })
  })))
}
