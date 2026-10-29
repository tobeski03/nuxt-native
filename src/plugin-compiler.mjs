import { build, transform } from 'esbuild'
import { dirname } from 'node:path'

function stripImports(source) {
  return source.replace(/^\s*import[^;\n]+;?\s*$/gm, '')
}

async function bundleLocalImports(source, filename, wrapperName, expression) {
  const localImport = /^\s*import\s+[^;\n]+?\s+from\s+['"]\.\.?\/[^'"\n]+['"]\s*;?\s*$/gm
  if (!localImport.test(source)) return null
  localImport.lastIndex = 0
  const imports = [...source.matchAll(localImport)].map(match => match[0]).join('\n')
  const result = await build({
    stdin: { contents: `${imports}\nvar ${wrapperName} = ${expression};`, resolveDir: dirname(filename), sourcefile: filename, loader: /\.tsx?$/i.test(filename) ? 'ts' : 'js' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2015', treeShaking: false, legalComments: 'none', logLevel: 'silent'
  })
  return result.outputFiles[0].text
}

function pluginName(file) {
  return file.replace(/\\/g, '/').split('/').pop().replace(/\.(?:[cm]?[jt]s|tsx?)$/i, '')
}

function unwrapPlugin(source) {
  const cleaned = stripImports(source).trim().replace(/^['"]use strict['"];?\s*/, '')
  const exported = cleaned.replace(/^export\s+default\s+/, '')
  const wrapped = exported.match(/^defineNuxtPlugin\s*\(([\s\S]*)\)\s*;?$/)
  return wrapped ? wrapped[1].trim() : exported
}

export async function compilePlugin(source, { filename = 'plugin.js', name = pluginName(filename) } = {}) {
  const expression = unwrapPlugin(source)
  const bundled = await bundleLocalImports(source, filename, '__nuxtPlugin', expression)
  const compiled = bundled ? { code: bundled } : await transform(`var __nuxtPlugin = ${expression};`, {
    loader: /\.(?:ts|tsx)$/i.test(filename) ? 'ts' : 'js',
    target: 'es2015',
    legalComments: 'none',
    sourcemap: false,
    sourcefile: filename
  })

  const code = `${compiled.code}
var __nuxtPluginHooks = {};
var __nuxtPluginDisposers = [];
function defineNuxtPlugin(plugin) { return plugin; }
function useNativeCapability(name) {
  var values = JSON.parse(__nuxtCapabilities.current());
  return values.indexOf(name) >= 0;
}
function useRuntimeConfig() { return JSON.parse(__nuxtRuntimeConfig.current()); }
function __nuxtPluginCapabilities(plugin) {
  var declared = plugin && Array.isArray(plugin.capabilities) ? plugin.capabilities : null;
  var available = JSON.parse(__nuxtCapabilities.current());
  if (!declared) return available;
  var result = [];
  for (var index = 0; index < declared.length; index++) {
    var name = String(declared[index]);
    if (available.indexOf(name) >= 0 && result.indexOf(name) < 0) result.push(name);
  }
  return result;
}
function __nuxtRegisterPluginHook(name, callback) {
  if (typeof callback !== 'function') return function() {};
  var key = String(name);
  (__nuxtPluginHooks[key] || (__nuxtPluginHooks[key] = [])).push(callback);
  return function() {
    var list = __nuxtPluginHooks[key] || [];
    var index = list.indexOf(callback);
    if (index >= 0) list.splice(index, 1);
  };
}
function __nuxtRunPluginHook(name, payload) {
  var list = (__nuxtPluginHooks[String(name)] || []).slice();
  for (var i = 0; i < list.length; i++) {
    try { list[i](payload); } catch (error) {}
  }
}
function __nuxtRunAppState(state) { __nuxtRunPluginHook('app:state', state); }
function __nuxtRegisterPluginDisposer(callback) { if (typeof callback === 'function') __nuxtPluginDisposers.push(callback); return callback; }
function __nuxtDisposePlugin() {
  __nuxtRunPluginHook('app:dispose', null);
  var disposers = __nuxtPluginDisposers.slice().reverse();
  __nuxtPluginDisposers = [];
  for (var index = 0; index < disposers.length; index++) { try { disposers[index](); } catch (error) {} }
  __nuxtPluginHooks = {};
}
function __nuxtRunPlugin() {
  var plugin = __nuxtPlugin;
  var capabilities = __nuxtPluginCapabilities(plugin);
  var app = {
    provide: function(key, value) {
      try { __nuxtPluginProvide.provide(key, JSON.stringify(value)); } catch (error) {}
    },
    hook: __nuxtRegisterPluginHook,
    callHook: __nuxtRunPluginHook,
    capabilities: capabilities.slice(),
    hasCapability: function(name) { return capabilities.indexOf(String(name)) >= 0; },
    onDispose: __nuxtRegisterPluginDisposer
  };
  var result = typeof plugin === 'function' ? plugin(app) : plugin && typeof plugin.setup === 'function' ? plugin.setup(app) : plugin;
  if (typeof result === 'function') __nuxtRegisterPluginDisposer(result);
  else if (result && typeof result.dispose === 'function') __nuxtRegisterPluginDisposer(function() { result.dispose(); });
  if (plugin && plugin.hooks) for (var name in plugin.hooks) __nuxtRegisterPluginHook(name, plugin.hooks[name]);
  return result == null ? "" : "";
}
`

  return { code, name, language: /\.(?:ts|tsx)$/i.test(filename) ? 'ts' : 'js' }
}

export { pluginName }
