import { build, transform } from 'esbuild'
import { dirname } from 'node:path'

function middlewareName(file) {
  const normalized = file.replace(/\\/g, '/')
  const name = normalized.split('/').pop().replace(/\.(?:[cm]?[jt]s|tsx?)$/i, '')
  return name.replace(/\.global$/, '')
}

function middlewareLanguage(filename) {
  return /\.(?:ts|tsx)$/i.test(filename) ? 'ts' : 'js'
}

function stripImports(source) {
  return source.replace(/^\s*import[^;\n]+;?\s*$/gm, '')
}

async function bundleLocalImports(source, filename, wrapperName, expression) {
  const localImport = /^\s*import\s+[^;\n]+?\s+from\s+['"]\.\.?\/[^'"\n]+['"]\s*;?\s*$/gm
  if (!localImport.test(source)) return null
  localImport.lastIndex = 0
  const imports = [...source.matchAll(localImport)].map(match => match[0]).join('\n')
  const result = await build({
    stdin: { contents: `${imports}\nvar ${wrapperName} = ${expression};`, resolveDir: dirname(filename), sourcefile: filename, loader: middlewareLanguage(filename) },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2015', treeShaking: false, legalComments: 'none', logLevel: 'silent'
  })
  return result.outputFiles[0].text
}

function unwrapMiddleware(source) {
  const cleaned = stripImports(source).trim().replace(/^['"]use strict['"];?\s*/, '')
  const exported = cleaned.replace(/^export\s+default\s+/, '')
  const wrapped = exported.match(/^defineNuxtRouteMiddleware\s*\(([\s\S]*)\)\s*;?$/)
  return wrapped ? wrapped[1].trim() : exported
}

export async function compileRouteMiddleware(source, { filename = 'middleware.js', name = middlewareName(filename) } = {}) {
  const expression = unwrapMiddleware(source)
  const bundled = await bundleLocalImports(source, filename, '__nuxtMiddleware', expression)
  const compiled = bundled ? { code: bundled } : await transform(`var __nuxtMiddleware = ${expression};`, {
    loader: middlewareLanguage(filename),
    target: 'es2015',
    legalComments: 'none',
    sourcemap: false,
    sourcefile: filename
  })

  const code = compiled.code + `
var __nuxtJobQueue = [];
function __nuxtQueueJob(job) { if (typeof job === 'function') __nuxtJobQueue.push(job); }
function __nuxtFlushJobs() { var pending = __nuxtJobQueue.splice(0, __nuxtJobQueue.length); while (pending.length) { var job = pending.shift(); try { job(); } catch (error) {} } }
function NuxtPromise(executor) { var self = this; self.status = 0; self.value = undefined; self.handlers = []; function settle(status, value) { if (self.status !== 0) return; self.status = status; self.value = value; var pending = self.handlers.slice(); self.handlers.length = 0; for (var i = 0; i < pending.length; i++) __nuxtQueueJob((function(handler) { return function() { run(handler); }; })(pending[i])); } function resolve(value) { if (value && typeof value.then === 'function') return value.then(resolve, reject); settle(1, value); } function reject(error) { settle(2, error); } function run(handler) { var callback = self.status === 1 ? handler.onFulfilled : handler.onRejected; if (typeof callback !== 'function') return (self.status === 1 ? handler.resolve : handler.reject)(self.value); try { handler.resolve(callback(self.value)); } catch (error) { handler.reject(error); } } self.then = function(onFulfilled, onRejected) { return new NuxtPromise(function(resolveNext, rejectNext) { var handler = { onFulfilled: onFulfilled, onRejected: onRejected, resolve: resolveNext, reject: rejectNext }; if (self.status === 0) self.handlers.push(handler); else __nuxtQueueJob(function() { run(handler); }); }); }; self.catch = function(onRejected) { return self.then(null, onRejected); }; self.finally = function(callback) { return self.then(function(value) { callback(); return value; }, function(error) { callback(); throw error; }); }; try { executor(resolve, reject); } catch (error) { reject(error); } }
NuxtPromise.resolve = function(value) { return value && typeof value.then === 'function' ? value : new NuxtPromise(function(resolve) { resolve(value); }); };
NuxtPromise.reject = function(error) { return new NuxtPromise(function(resolve, reject) { reject(error); }); };
var Promise = NuxtPromise;
function __nuxtNormalizeRouteLocation(location) { if (location === null || location === undefined) return '/'; if (typeof location === 'string') return location; if (typeof location !== 'object') return String(location); var target = location.path || '/'; var query = location.query || {}; var pairs = []; for (var key in query) { if (!Object.prototype.hasOwnProperty.call(query, key) || query[key] === undefined) continue; var value = query[key]; if (Array.isArray(value)) { for (var index = 0; index < value.length; index++) pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value[index] === null ? '' : String(value[index]))); } else if (value === null) pairs.push(encodeURIComponent(key)); else pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value))); } if (pairs.length) target += '?' + pairs.join('&'); if (location.hash) target += String(location.hash).charAt(0) === '#' ? String(location.hash) : '#' + String(location.hash); return target; }
function navigateTo(path) { return { __nuxtRedirect: __nuxtNormalizeRouteLocation(path) }; }
function abortNavigation() { return false; }
function useRoute() { return JSON.parse(__nuxtRoute.current()); }
function useRuntimeConfig() { return JSON.parse(__nuxtRuntimeConfig.current()); }
var __nuxtAsyncRequests = {};
function __nuxtResolveAsync(requestId, body, failure) { var request = __nuxtAsyncRequests[String(requestId)]; if (!request) return; delete __nuxtAsyncRequests[String(requestId)]; if (failure) return request.reject(new Error(String(failure))); try { request.resolve(JSON.parse(body)); } catch (error) { request.reject(error); } __nuxtFlushJobs(); }
function $fetch(path, options) { var request = options || {}; var requestId = __nuxtFetchAsync.fetch(path, request.method || 'GET', JSON.stringify(request.body === undefined ? null : request.body), JSON.stringify(request.headers === undefined ? {} : request.headers)); return new Promise(function(resolve, reject) { __nuxtAsyncRequests[String(requestId)] = { resolve: resolve, reject: reject }; }); }
function __nuxtMiddlewareResult(result) { if (result === false) return '__nuxt_abort__'; if (result && result.__nuxtRedirect) return '__nuxt_redirect__:' + result.__nuxtRedirect; return ''; }
function __nuxtRunMiddleware(toJson, fromJson) {
  var result = __nuxtMiddleware(JSON.parse(toJson), JSON.parse(fromJson));
  if (result && typeof result.then === 'function') return '__nuxt_async__';
  return __nuxtMiddlewareResult(result);
}
function __nuxtRunMiddlewareAsync(toJson, fromJson) {
  var finish = function(result) { __nuxtMiddlewareComplete.complete(__nuxtMiddlewareResult(result)); };
  try {
    var result = __nuxtMiddleware(JSON.parse(toJson), JSON.parse(fromJson));
    if (result && typeof result.then === 'function') result.then(finish, function() { __nuxtMiddlewareComplete.complete('__nuxt_abort__'); });
    else finish(result);
  } catch (error) { __nuxtMiddlewareComplete.complete('__nuxt_abort__'); }
  __nuxtFlushJobs();
}
function __nuxtFlushMiddlewareJobs() {
  __nuxtFlushJobs();
}
`

  return { code, name, language: middlewareLanguage(filename), global: filename.replace(/\\/g, '/').split('/').pop().includes('.global.') }
}

export { middlewareName }
