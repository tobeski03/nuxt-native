import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compileServerRoute, discoverServerPlugins, serverFileToRoute } from '../src/server-compiler.mjs'

test('maps Nitro-style server filenames to method routes', () => {
  assert.deepEqual(serverFileToRoute('api/profile.put.ts'), {
    path: '/api/profile', method: 'PUT', file: 'api/profile.put.ts'
  })
  assert.deepEqual(serverFileToRoute('index.get.ts'), {
    path: '/', method: 'GET', file: 'index.get.ts'
  })
  assert.equal(serverFileToRoute('api/posts/[id].get.ts').path, '/api/posts/:id')
  assert.equal(serverFileToRoute('api/docs/[...path].get.ts').path, '/api/docs/*path')
})

test('discovers nested server plugins in deterministic order', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-server-plugins-test-'))
  try {
    await writeFile(join(root, 'z.ts'), 'export default defineNitroPlugin(() => {})')
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(join(root, 'nested', 'a.ts'), 'export default defineNitroPlugin(() => {})')
    assert.deepEqual(await discoverServerPlugins(root), [
      { name: 'nested/a', file: join(root, 'nested', 'a.ts').replace(/\\/g, '/') },
      { name: 'z', file: join(root, 'z.ts').replace(/\\/g, '/') }
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('compiles Nitro server plugin hooks for the embedded server boundary', async () => {
  const result = await compileServerRoute('export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook("request", (event) => { event.context.ready = true }) })', { filename: 'server/plugins/request.ts' })
  assert.match(result.code, /function defineNitroPlugin/)
  assert.match(result.code, /__nuxtRegisterServerHook/)
  const context = {}
  vm.runInNewContext(`${result.code}\n__nuxtInvokeServerHandler(__nuxtCreateNitroApp()); result = JSON.stringify(__nuxtRunServerHook('request', { context: {} }))`, context)
  assert.deepEqual(JSON.parse(context.result), { context: { ready: true } })
})

test('preserves request hooks across multiple server plugin assets', async () => {
  const first = await compileServerRoute('export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook("request", (event) => { event.context.first = true }) })', { filename: 'server/plugins/first.ts' })
  const second = await compileServerRoute('export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook("request", (event) => { event.context.second = true }) })', { filename: 'server/plugins/second.ts' })
  const context = {}
  vm.runInNewContext(`${first.code}\n__nuxtInvokeServerHandler(__nuxtCreateNitroApp());`, context)
  vm.runInNewContext(`${second.code}\n__nuxtInvokeServerHandler(__nuxtCreateNitroApp()); result = JSON.stringify(__nuxtRunServerHook('request', { context: {} }))`, context)
  assert.deepEqual(JSON.parse(context.result), { context: { first: true, second: true } })
})

test('accepts object-style Nitro plugin hook declarations', async () => {
  const result = await compileServerRoute('export default defineNitroPlugin({ hooks: { request(event) { event.context.objectStyle = true } } })', { filename: 'server/plugins/object.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}\n__nuxtInvokeServerHandler(__nuxtCreateNitroApp()); result = JSON.stringify(__nuxtRunServerHook('request', { context: {} }))`, context)
  assert.deepEqual(JSON.parse(context.result), { context: { objectStyle: true } })
})

test('preserves structured errors thrown by Nitro plugin hooks', async () => {
  const result = await compileServerRoute('export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook("request", () => { throw createError({ statusCode: 418, statusMessage: "Teapot", data: { reason: "fixture" } }) }) })', { filename: 'server/plugins/error.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}\n__nuxtInvokeServerHandler(__nuxtCreateNitroApp()); result = JSON.stringify(__nuxtRunServerHook('request', { context: {} }))`, context)
  assert.deepEqual(JSON.parse(context.result).__nuxtHookError, {
    statusCode: 418,
    statusMessage: 'Teapot',
    message: 'Teapot',
    data: { reason: 'fixture' }
  })
})

test('compiles TypeScript server handlers into a native server asset', async () => {
  const result = await compileServerRoute(`export default defineEventHandler(async (event) => {
    const body = await readBody<{ name?: string }>(event)
    return { name: body.name ?? '' }
  })`, { filename: 'api/profile.put.ts' })

  assert.equal(result.handler, '__nuxtServerHandler')
  assert.equal(result.mode, 'embedded-async-compatible')
  assert.match(result.code, /function defineEventHandler/)
  assert.match(result.code, /__nuxtServerHandler/)
  assert.doesNotMatch(result.code, /readBody<\{/) 
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtInvokeServerHandler({ body: { name: ' Alice ' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), { name: ' Alice ' })
})

test('auto-imports server utility functions into embedded routes', async () => {
  const result = await compileServerRoute(`export default defineEventHandler(() => ({ value: serverLabel('Native') }))`, {
    filename: 'api/utility.get.ts',
    utilities: [{ filename: 'server/utils/labels.ts', source: 'export function serverLabel(value: string): string { return value + " utility" }' }]
  })
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtInvokeServerHandler({}))`, context)
  assert.deepEqual(JSON.parse(context.result), { value: 'Native utility' })
})

test('bundles imports used by server utilities', async () => {
  const root = await mkdtemp(join(process.cwd(), '.nuxt-native-server-utils-test-'))
  try {
    const shared = join(root, 'shared.ts')
    const labels = join(root, 'labels.ts')
    await writeFile(shared, 'export const suffix = " imported"\n')
    await writeFile(labels, 'import { suffix } from "./shared"\nexport function serverLabel(value: string): string { return value + suffix }\n')
    const result = await compileServerRoute('export default defineEventHandler(() => ({ value: serverLabel("Native") }))', {
      filename: join(root, 'route.ts'),
      utilities: [{ filename: labels, source: await readFile(labels, 'utf8') }]
    })
    const context = {}
    vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtInvokeServerHandler({}))`, context)
    assert.deepEqual(JSON.parse(context.result), { value: 'Native imported' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects duplicate server auto-import utility names', async () => {
  await assert.rejects(
    compileServerRoute('export default defineEventHandler(() => ({ ok: true }))', {
      utilities: [
        { filename: 'server/utils/one.ts', source: 'export function shared() { return 1 }' },
        { filename: 'server/utils/two.ts', source: 'export function shared() { return 2 }' }
      ]
    }),
    /Server auto-import "shared" is declared by both/
  )
})

test('settles asynchronous server handlers through the embedded job queue', async () => {
  const result = await compileServerRoute(`export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    await Promise.resolve()
    return { ok: true, name: body.name }
  })`, { filename: 'api/async.post.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtInvokeServerHandler({ body: { name: 'Native' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), { ok: true, name: 'Native' })
})

test('provides Nitro-style request context helpers to embedded handlers', async () => {
  const result = await compileServerRoute(`export default defineEventHandler((event) => {
    setResponseStatus(event, 201)
    setHeader(event, 'x-native', 'yes')
    return { method: getMethod(event), query: getQuery(event), token: getHeader(event, 'x-token'), status: event.statusCode, header: event.responseHeaders['x-native'] }
  })`, { filename: 'api/context.get.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}
    result = JSON.stringify(__nuxtServerHandler({ method: 'GET', query: { page: '2' }, headers: { 'x-token': 'abc' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), {
    method: 'GET', query: { page: '2' }, token: 'abc', status: 201, header: 'yes'
  })
})

test('provides Nitro request path, router, protocol, host, and IP helpers', async () => {
  const result = await compileServerRoute(`export default defineEventHandler((event) => ({
    path: getRequestPath(event),
    param: getRouterParam(event, 'id'),
    params: getRouterParams(event),
    protocol: getRequestProtocol(event),
    host: getRequestHost(event),
    ip: getRequestIP(event)
  }))`, { filename: 'api/posts/[id].get.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}
    result = JSON.stringify(__nuxtInvokeServerHandler({
      url: 'https://native.test/api/posts/42?view=full',
      path: '/api/posts/42',
      params: { id: '42' },
      headers: { 'x-forwarded-proto': 'https', 'host': 'native.test', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }
    }))`, context)
  assert.deepEqual(JSON.parse(context.result), {
    path: '/api/posts/42',
    param: '42',
    params: { id: '42' },
    protocol: 'https',
    host: 'native.test',
    ip: '203.0.113.7'
  })
})

test('parses request cookies and serializes repeated response cookies natively', async () => {
  const result = await compileServerRoute(`export default defineEventHandler((event) => {
    const session = getCookie(event, 'session')
    setCookie(event, 'theme', 'dark mode', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 })
    setCookie(event, 'flash', 'saved')
    deleteCookie(event, 'legacy', { path: '/account' })
    return { session, cookies: event.responseHeaders['set-cookie'] }
  })`, { filename: 'api/cookies.get.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}
    result = JSON.stringify(__nuxtInvokeServerHandler({ headers: { cookie: 'session=abc%20123; ignored=x' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), {
    session: 'abc 123',
    cookies: [
      'theme=dark%20mode; Max-Age=3600; Path=/; SameSite=Lax; HttpOnly',
      'flash=saved',
      'legacy=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/account'
    ]
  })
})

test('supports native response header composition and redirects', async () => {
  const result = await compileServerRoute(`export default defineEventHandler((event) => {
    setResponseHeaders(event, { 'x-one': '1', 'x-many': ['a', 'b'] })
    appendResponseHeader(event, 'x-one', '2')
    setResponseStatus(event, 202, 'Accepted')
    const before = { request: getRequestHeader(event, 'x-token'), status: getResponseStatus(event), header: getResponseHeader(event, 'x-one') }
    removeResponseHeader(event, 'x-many')
    sendRedirect(event, '/next', 307)
    return { before, headers: getRequestHeaders(event), response: event.responseHeaders, status: getResponseStatus(event) }
  })`, { filename: 'api/headers.get.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}
    result = JSON.stringify(__nuxtInvokeServerHandler({ headers: { 'X-Token': 'abc' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), {
    before: { request: 'abc', status: 202, header: ['1', '2'] },
    headers: { 'x-token': 'abc' },
    response: { 'x-one': ['1', '2'], location: '/next' },
    status: 307
  })
})

test('allows handlers to finalize response bodies explicitly', async () => {
  const sent = await compileServerRoute(`export default defineEventHandler((event) => {
    send(event, { source: 'explicit' })
    return { source: 'return-value' }
  })`, { filename: 'api/send.get.ts' })
  const empty = await compileServerRoute(`export default defineEventHandler((event) => sendNoContent(event))`, { filename: 'api/empty.get.ts' })
  const sentContext = {}
  vm.runInNewContext(`${sent.code}
    result = JSON.stringify((function(){ var event = {}; var body = __nuxtInvokeServerHandler(event); return { body: event.responseBody === undefined ? body : event.responseBody, status: event.statusCode || 200 }; })())`, sentContext)
  assert.deepEqual(JSON.parse(sentContext.result), { body: { source: 'explicit' }, status: 200 })
  const emptyContext = {}
  vm.runInNewContext(`${empty.code}
    result = JSON.stringify((function(){ var event = {}; var body = __nuxtInvokeServerHandler(event); return { body: event.responseBody === undefined ? body : event.responseBody, status: event.statusCode || 200 }; })())`, emptyContext)
  assert.deepEqual(JSON.parse(emptyContext.result), { body: null, status: 204 })
})

test('preserves structured createError metadata for the native host boundary', async () => {
  const result = await compileServerRoute(`export default defineEventHandler(() => {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', data: { reason: 'token' } })
  })`, { filename: 'api/private.get.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}
    try { __nuxtServerHandler({}); result = 'missing' } catch (error) { result = JSON.stringify({ message: error.message, statusCode: error.statusCode, statusMessage: error.statusMessage, data: error.data }) }`, context)
  assert.deepEqual(JSON.parse(context.result), {
    message: 'Unauthorized', statusCode: 401, statusMessage: 'Unauthorized', data: { reason: 'token' }
  })
})

test('provides Nitro method assertions and structured sendError responses', async () => {
  const result = await compileServerRoute('export default defineEventHandler((event) => { if (!isMethod(event, "POST")) return sendError(event, createError({ statusCode: 422, statusMessage: "Invalid method", data: { field: "method" } })); return { ok: true } })', { filename: 'api/method.get.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify((function(){ var event = { method: 'GET', responseHeaders: {} }; var body = __nuxtInvokeServerHandler(event); return { body: body, responseBody: event.responseBody, status: event.statusCode, header: event.responseHeaders.allow }; })())`, context)
  assert.deepEqual(JSON.parse(context.result), {
    body: { statusCode: 422, statusMessage: 'Invalid method', message: 'Invalid method', data: { field: 'method' } },
    responseBody: { statusCode: 422, statusMessage: 'Invalid method', message: 'Invalid method', data: { field: 'method' } },
    status: 422
  })
})

test('provides validated body and query helpers with structured 400 failures', async () => {
  const result = await compileServerRoute('export default defineEventHandler((event) => ({ body: readValidatedBody(event, (value) => ({ name: String(value.name).trim() })), query: getValidatedQuery(event, (value) => value.ready === "1" ? value : false), raw: readRawBody(event) }))', { filename: 'api/validated.post.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtInvokeServerHandler({ body: { name: ' Native ' }, rawBody: 'raw', query: { ready: '1' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), { body: { name: 'Native' }, query: { ready: '1' }, raw: 'raw' })

  const invalid = await compileServerRoute('export default defineEventHandler((event) => readValidatedBody(event, () => false))', { filename: 'api/invalid.post.ts' })
  const invalidContext = {}
  vm.runInNewContext(`${invalid.code}\ntry { __nuxtInvokeServerHandler({ body: {} }); result = 'no-error'; } catch (error) { result = JSON.stringify({ statusCode: error.statusCode, statusMessage: error.statusMessage }); }`, invalidContext)
  assert.deepEqual(JSON.parse(invalidContext.result), { statusCode: 400, statusMessage: 'Invalid request body' })
})

test('settles asynchronous validation helpers through the embedded Promise queue', async () => {
  const result = await compileServerRoute('export default defineEventHandler(async (event) => ({ body: await readValidatedBody(event, async (value) => ({ id: Number(value.id) })), query: await getValidatedQuery(event, async (value) => value.ready === "1" ? value : false) }))', { filename: 'api/validated-async.post.ts' })
  const context = {}
  vm.runInNewContext(`${result.code}\nresult = JSON.stringify(__nuxtInvokeServerHandler({ body: { id: '42' }, query: { ready: '1' } }))`, context)
  assert.deepEqual(JSON.parse(context.result), { body: { id: 42 }, query: { ready: '1' } })
})
