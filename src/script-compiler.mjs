import { build, transform } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

function readSetupScript(source) {
  const match = source.match(/<script setup([^>]*)>([\s\S]*?)<\/script>/)
  if (!match) return null
  return {
    attributes: match[1],
    body: match[2].trim(),
    language: /\blang=["']ts["']/i.test(match[1]) ? 'ts' : 'js'
  }
}

function setupBody(source) {
  return source.match(/<script setup([^>]*)>([\s\S]*?)<\/script>/)?.[2]?.trim() ?? source.trim()
}

function setupLanguage(source, fallback = 'js') {
  return source.match(/<script setup([^>]*)>/)?.[1] && /\blang=["']ts["']/i.test(source.match(/<script setup([^>]*)>/)[1]) ? 'ts' : fallback
}

function replaceMacroCalls(source, macro, replacement) {
  const marker = new RegExp(`\\b${macro}(?:<[^>]+>)?\\s*\\(`, 'g')
  let output = ''
  let cursor = 0
  let match
  while ((match = marker.exec(source))) {
    const open = marker.lastIndex - 1
    let depth = 1
    let index = open + 1
    let quote = ''
    let escaped = false
    for (; index < source.length && depth > 0; index++) {
      const character = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = ''
        continue
      }
      if (character === '"' || character === "'" || character === '`') { quote = character; continue }
      if (character === '(') depth++
      else if (character === ')') depth--
    }
    if (depth !== 0) break
    output += source.slice(cursor, match.index) + replacement(source.slice(open + 1, index - 1))
    cursor = index
    marker.lastIndex = index
  }
  return output ? output + source.slice(cursor) : source
}

function replaceModelCalls(source, prefix) {
  const marker = /((?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)defineModel(?:<[^>]+>)?\s*\(/g
  let output = ''
  let cursor = 0
  let match
  while ((match = marker.exec(source))) {
    const open = marker.lastIndex - 1
    let depth = 1
    let index = open + 1
    let quote = ''
    let escaped = false
    for (; index < source.length && depth > 0; index++) {
      const character = source[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = ''
        continue
      }
      if (character === '"' || character === "'" || character === '`') { quote = character; continue }
      if (character === '(') depth++
      else if (character === ')') depth--
    }
    if (depth !== 0) break
    const argumentsText = source.slice(open + 1, index - 1).trim()
    const named = argumentsText.match(/^['"]([^'"]+)['"]/)
    const modelName = named ? named[1] : match[2]
    const options = named ? argumentsText.slice(named[0].length).replace(/^\s*,\s*/, '') : argumentsText
    output += source.slice(cursor, match.index) + `${match[1]}${prefix}_defineModel(${JSON.stringify(modelName)}, ${options || 'undefined'})`
    cursor = index
    marker.lastIndex = index
  }
  return output ? output + source.slice(cursor) : source
}

function stripImports(source) {
  return source.replace(/^\s*import\s+[^;\n]+;?\s*$/gm, '')
}

function stripExternalImports(source) {
  return source.replace(/^\s*import\s+(?:type\s+)?(?:[^;\n]+?\s+from\s+)?(['"])(?!\.\.?\/|[@~]\/)[^'"\n]+\1\s*;?\s*$/gm, '')
}

const importDeclaration = /^\s*import\s+(?:type\s+)?(?:[^;\n]+?\s+from\s+)?(['"])([^'"\n]+)\1\s*;?\s*$/gm

function resolvePackageImport(specifier, filename, projectRoot) {
  const bases = [filename, projectRoot && resolve(projectRoot, 'package.json')].filter(Boolean)
  for (const base of bases) {
    try {
      createRequire(resolve(base)).resolve(specifier)
      return true
    } catch {}
  }
  return false
}

function importedNames(source) {
  const names = []
  for (const match of String(source ?? '').matchAll(/^\s*import\s+(.+?)\s+from\s+['"][^'"]+['"]/gm)) {
    const clause = match[1].replace(/^type\s+/, '').trim()
    const named = clause.match(/\{([^}]+)\}/)?.[1] ?? ''
    for (const part of named.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
    }
    const defaultName = clause.split(',')[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(defaultName)) names.push(defaultName)
    const namespaceName = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1]
    if (namespaceName) names.push(namespaceName)
  }
  return [...new Set(names)]
}

function destructuredPropBindings(source) {
  const names = []
  const patterns = [
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*defineProps(?:<[^>]+>)?\s*\([^)]*\)/g,
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*withDefaults\(\s*defineProps(?:<[^>]+>)?\s*\([^)]*\)\s*,\s*\{[^}]*\}\s*\)/g
  ]
  for (const pattern of patterns) for (const match of String(source ?? '').matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const binding = part.trim().replace(/^\.\.\./, '').split('=')[0].trim()
      const local = binding.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local)
    }
  }
  return [...new Set(names)]
}

function lowerDestructuredProps(source, prefix) {
  function lower(declaration, fields, defaults = {}) {
    const bindings = []
    for (const part of fields.split(',')) {
      const raw = part.trim()
      if (!raw) continue
      if (raw.startsWith('...')) {
        const rest = raw.slice(3).trim()
        if (/^[A-Za-z_$][\w$]*$/.test(rest)) bindings.push(`${declaration}${rest} = ${prefix}_defineProps()`)
        continue
      }
      const [assignment, defaultValue] = raw.split(/\s*=\s*(.+)/s)
      const [property, local] = assignment.split(/\s*:\s*/).map(value => value.trim())
      const propertyName = /^[A-Za-z_$][\w$]*$/.test(property) ? property : null
      const localName = (local || property).trim()
      if (!propertyName || !/^[A-Za-z_$][\w$]*$/.test(localName)) continue
      const access = `${prefix}_defineProps()[${JSON.stringify(propertyName)}]`
      const fallback = defaultValue === undefined ? defaults[propertyName] : defaultValue.trim()
      const value = fallback === undefined ? access : `(${access} === undefined ? ${fallback} : ${access})`
      bindings.push(`${declaration}${localName} = ${value}`)
    }
    return bindings.join('\n')
  }
  function parseDefaults(sourceText) {
    const values = {}
    for (const part of sourceText.split(',')) {
      const separator = part.indexOf(':')
      if (separator < 0) continue
      const key = part.slice(0, separator).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(key)) values[key] = part.slice(separator + 1).trim()
    }
    return values
  }
  source = source.replace(/((?:const|let|var)\s*)\{([^}]+)\}\s*=\s*withDefaults\(\s*defineProps(?:<[^>]+>)?\s*\([^)]*\)\s*,\s*\{([^}]+)\}\s*\)/g, (_, declaration, fields, defaults) => lower(declaration, fields, parseDefaults(defaults)))
  return source.replace(/((?:const|let|var)\s*)\{([^}]+)\}\s*=\s*defineProps(?:<[^>]+>)?\s*\([^)]*\)/g, (_, declaration, fields) => {
    return lower(declaration, fields)
  })
}

async function bundleLocalImports(source, filename, language, projectRoot) {
  const imports = [...source.matchAll(importDeclaration)].map(match => ({ full: match[0], specifier: match[2] }))
  const localImports = imports.filter(({ specifier }) => specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/') || specifier.startsWith('~/'))
  const packageImports = imports.filter(({ specifier }) => !specifier.startsWith('.') && !specifier.startsWith('@/') && !specifier.startsWith('~/') && resolvePackageImport(specifier, filename, projectRoot))
  if (!localImports.length && !packageImports.length) return stripImports(source)
  const plugins = projectRoot ? [{
    name: 'nuxt-native-project-aliases',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^[@~]\// }, args => ({ path: resolve(projectRoot, args.path.slice(2)) }))
    }
  }] : []
  const bundleable = new Set([...localImports, ...packageImports].map(({ full }) => full))
  const bundledSource = source.replace(importDeclaration, (full) => bundleable.has(full) ? full : '')
  const bundled = await build({
    stdin: {
      contents: bundledSource,
      resolveDir: dirname(filename),
      sourcefile: filename,
      loader: language
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2015',
    treeShaking: false,
    plugins,
    legalComments: 'none',
    logLevel: 'silent'
  })
  return bundled.outputFiles[0].text
}

function stripExports(source) {
  return source
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/g, '')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
}

function identifiers(source) {
  return new Set([...String(source ?? '').matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)].map(match => match[0]))
}

// Template expressions can reference setup bindings that are not refs (for
// example `const device = useNativeDevice()`). The native renderer does not
// execute a browser template scope, so expose those top-level bindings in the
// same serializable snapshot as reactive state. Only declarations at the
// setup body's top level are collected; locals inside functions must remain
// private to those functions.
function topLevelBindingNames(source) {
  const names = new Set()
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  let quote = ''
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') { blockComment = false; index++ }
      continue
    }
    if (quote) {
      if (character === '\\') { index++; continue }
      if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '/') { lineComment = true; index++; continue }
    if (character === '/' && next === '*') { blockComment = true; index++; continue }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue }

    if (character === '{') braceDepth++
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (character === '(') parenDepth++
    else if (character === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (character === '[') bracketDepth++
    else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1)

    if (braceDepth || parenDepth || bracketDepth) continue
    const declaration = source.slice(index).match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/)
    if (declaration) {
      names.add(declaration[1])
      index += declaration[0].length - 1
    }
  }
  return [...names]
}

function exportedNames(source) {
  const names = new Set()
  for (const match of String(source ?? '').matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  for (const match of String(source ?? '').matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

async function compileAutoImports(entries, consumerSource = '') {
  const compiled = []
  const diagnostics = []
  const owners = new Map()
  const modules = []
  for (const entry of entries) {
    const original = typeof entry === 'string' ? entry : entry.source
    const filename = typeof entry === 'object' ? entry.filename ?? 'auto-import.js' : 'auto-import.js'
    const source = stripExports(stripImports(original))
    if (!source.trim()) continue
    const declarations = [
      ...source.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm),
      ...source.matchAll(/^\s*(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)\s*(?:=|\{)/gm)
    ].map(match => match[1])
    for (const name of declarations) {
      const previous = owners.get(name)
      if (previous) {
        diagnostics.push({
          level: 'error',
          code: 'AUTO_IMPORT_COLLISION',
          symbol: name,
          files: [previous, filename],
          message: `Auto-import "${name}" is declared by both ${previous} and ${filename}`
        })
      } else owners.set(name, filename)
    }
    modules.push({ entry, original, source, filename, exports: exportedNames(original) })
  }

  const required = identifiers(consumerSource)
  const selected = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const module of modules) {
      const shouldInclude = module.exports.size === 0 || [...module.exports].some(name => required.has(name))
      if (!shouldInclude || selected.has(module)) continue
      selected.add(module)
      for (const identifier of identifiers(module.source)) if (!required.has(identifier)) {
        required.add(identifier)
        changed = true
      }
    }
  }

  for (const module of modules) {
    if (!selected.has(module)) continue
    const { entry, source, filename } = module
    const result = await transform(source, {
      loader: typeof entry === 'object' ? entry.language ?? 'js' : 'js',
      target: 'es2015',
      legalComments: 'none',
      sourcemap: false,
      sourcefile: filename
    })
    compiled.push(result.code)
  }
  return { code: compiled.join('\n'), diagnostics }
}

async function compileComponentScripts(entries) {
  const compiledEntries = []
  for (const entry of entries) {
    const source = lowerDestructuredProps(
      await bundleLocalImports(setupBody(entry.source), entry.filename ?? 'component.vue', entry.language ?? setupLanguage(entry.source, 'js'), entry.projectRoot),
      entry.prefix
    )
    if (!source) continue
    const refNames = [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:ref|shallowRef)(?:<[^>]+>)?\s*\(/g)].map(match => match[1])
    const asyncRefs = [...source.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(useFetch|useAsyncData)\s*\(/g)]
      .flatMap(match => match[1].split(',').map(part => part.trim().split(/\s*:\s*/)[0]).filter(name => /^[A-Za-z_$][\w$]*$/.test(name)))
    const modelNames = [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*defineModel(?:<[^>]+>)?\s*\(/g)].map(match => match[1])
    const functionNames = [...source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1])
    const declarations = [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)].map(match => match[1])
    const returned = [...new Set([...declarations, ...destructuredPropBindings(entry.source), ...importedNames(source), ...asyncRefs, ...functionNames])].filter(name => /^[A-Za-z_$][\w$]*$/.test(name))
    let rewritten = source.replace(/((?:const|let|var)\s+)([A-Za-z_$][\w$]*)(\s*=\s*)(?:ref|shallowRef)(?:<[^>]+>)?\s*\(/g, (_, declaration, name, assignment) => `${declaration}${name}${assignment}ref('${entry.prefix}_${name}', `)
    rewritten = replaceMacroCalls(rewritten, 'defineProps', argumentsText => `${entry.prefix}_defineProps(${argumentsText})`)
    rewritten = rewritten.replace(/\bdefineEmits(?:<[^>]+>)?\s*\([^)]*\)/g, `${entry.prefix}_defineEmits()`)
    rewritten = rewritten.replace(/\bdefineSlots(?:<[^>]+>)?\s*\([^)]*\)/g, `${entry.prefix}_defineSlots()`)
    rewritten = rewritten.replace(/\bdefineExpose\s*\([^)]*\)/g, `${entry.prefix}_defineExpose()`)
    rewritten = rewritten.replace(/\bdefineOptions\s*\([^)]*\)/g, `${entry.prefix}_defineOptions()`)
    rewritten = replaceModelCalls(rewritten, entry.prefix)
    rewritten = rewritten.replace(/\bwithDefaults\s*\(/g, `${entry.prefix}_withDefaults(`)
    rewritten = rewritten.replace(/\buseFetch\s*\(/g, `${entry.prefix}_useFetch(`).replace(/\buseAsyncData\s*\(/g, `${entry.prefix}_useAsyncData(`)
    rewritten = rewritten.replace(/\bonMounted\s*\(/g, `${entry.prefix}_onMounted(`).replace(/\bonUnmounted\s*\(/g, `${entry.prefix}_onUnmounted(`).replace(/\bonBeforeMount\s*\(/g, `${entry.prefix}_onBeforeMount(`).replace(/\bonBeforeUnmount\s*\(/g, `${entry.prefix}_onBeforeUnmount(`).replace(/\bonBeforeRouteLeave\s*\(/g, `${entry.prefix}_onBeforeRouteLeave(`).replace(/\bonBeforeRouteUpdate\s*\(/g, `${entry.prefix}_onBeforeRouteUpdate(`).replace(/\bonErrorCaptured\s*\(/g, `${entry.prefix}_onErrorCaptured(`)
    const compiled = await transform(rewritten, {
      loader: entry.language ?? setupLanguage(entry.source, 'js'),
      target: 'es2015',
      legalComments: 'none',
      sourcemap: false,
      sourcefile: `${entry.id}.vue`
    })
    const returnObject = returned.map(name => `${name}: ${name}`).join(', ')
    const isModelKey = key => key === 'v-model' || key.startsWith('v-model.') || key.startsWith('v-model:')
    const modelKey = Object.keys(entry.props ?? {}).find(isModelKey)
    const staticProps = Object.fromEntries(Object.entries(entry.props ?? {}).filter(([key]) => !key.startsWith(':') && !isModelKey(key)))
    staticProps.__nuxtPropExpressions = Object.fromEntries(Object.entries(entry.props ?? {}).filter(([key, value]) => key.startsWith(':') && typeof value === 'string').map(([key, value]) => [key.slice(1), value]))
    const modelExpression = modelKey ? entry.props[modelKey] : ''
    staticProps.__nuxtModelExpression = modelExpression
    let code = `var ${entry.prefix}_props = ${JSON.stringify(staticProps)};\nfunction ${entry.prefix}_defineProps() { return ${entry.prefix}_props; }\nfunction ${entry.prefix}_defineEmits() { return function(name) { var eventName = String(name); var handler = ${entry.prefix}_props['@' + eventName]; var args = Array.prototype.slice.call(arguments, 1); if (typeof handler === 'function') return handler.apply(null, args); if (typeof handler === 'string') { try { var callback = eval(handler); if (typeof callback === 'function') return callback.apply(null, args); } catch (error) {} if (typeof __nuxtMounted !== 'undefined') __nuxtMounted.push(function() { try { var callback = eval(handler); if (typeof callback === 'function') callback.apply(null, args); } catch (error) {} }); } return false; }; }\nfunction ${entry.prefix}_defineSlots() { return ${entry.prefix}_props.__nuxtSlots || {}; }\nfunction ${entry.prefix}_defineExpose(value) { return value || {}; }\nfunction ${entry.prefix}_defineOptions(value) { return value || {}; }\nfunction ${entry.prefix}_withDefaults(value, defaults) { var result = value || {}; var values = defaults || {}; for (var key in values) if (result[key] === undefined) result[key] = values[key]; return result; }\nvar ${entry.prefix}_mounted = [];\nvar ${entry.prefix}_unmounted = [];\nfunction ${entry.prefix}_onMounted(callback) { if (typeof callback === 'function') ${entry.prefix}_mounted.push(callback); }\nfunction ${entry.prefix}_onUnmounted(callback) { if (typeof callback === 'function') ${entry.prefix}_unmounted.push(callback); }\nfunction ${entry.prefix}_runMounted() { for (var i = 0; i < ${entry.prefix}_mounted.length; i++) ${entry.prefix}_mounted[i](); }\nfunction ${entry.prefix}_runUnmounted() { for (var i = ${entry.prefix}_unmounted.length - 1; i >= 0; i--) ${entry.prefix}_unmounted[i](); }\nfunction ${entry.prefix}_assignModel(value) { try { var expression = ${entry.prefix}_props.__nuxtModelExpression; if (!expression) return; var target = eval(expression); if (target && Object.prototype.hasOwnProperty.call(target, 'value')) target.value = value; else eval(expression + ' = value'); } catch (error) {} }\nfunction ${entry.prefix}_defineModel(name) { var initial = ${entry.prefix}_props.modelValue === undefined ? null : ${entry.prefix}_props.modelValue; var holder = ref('${entry.prefix}_' + name, initial); watch(holder, function(value) { ${entry.prefix}_assignModel(value); }); ${entry.prefix}_mounted.push(function() { try { var expression = ${entry.prefix}_props.__nuxtModelExpression; if (!expression) return; var target = eval(expression); if (target && Object.prototype.hasOwnProperty.call(target, 'value')) holder.value = target.value; else if (target !== undefined) holder.value = target; } catch (error) {} }); return holder; }\nfunction ${entry.prefix}_useFetch(path, options) { return useFetch(path, options, '${entry.prefix}'); }\nfunction ${entry.prefix}_useAsyncData(key, handler) { return useAsyncData(key, handler, '${entry.prefix}'); }\nfunction ${entry.prefix}_setup() {\n${compiled.code}\nreturn { ${returnObject} };\n}\nvar ${entry.prefix}_previousScope = __nuxtActiveScope;\n__nuxtActiveScope = '${entry.prefix}';\nvar ${entry.prefix};\ntry { ${entry.prefix} = ${entry.prefix}_setup(); } finally { __nuxtActiveScope = ${entry.prefix}_previousScope; }\n`
    const modelPattern = new RegExp(`function ${entry.prefix}_defineModel\\(name\\) \\{[\\s\\S]*?\\nfunction ${entry.prefix}_useFetch`)
    const modelReplacement = `function ${entry.prefix}_defineModel(name, options) { var config = options || {}; var initialValue = ${entry.prefix}_props[name] !== undefined ? ${entry.prefix}_props[name] : (config.default !== undefined ? (typeof config.default === 'function' ? config.default() : config.default) : null); var initial = typeof config.get === 'function' ? config.get(initialValue) : initialValue; var holder = ref('${entry.prefix}_' + name, initial); watch(holder, function(value) { var next = typeof config.set === 'function' ? config.set(value) : value; ${entry.prefix}_assignModel(next); }); ${entry.prefix}_mounted.push(function() { try { var expression = ${entry.prefix}_props.__nuxtModelExpression; if (!expression) return; var target = eval(expression); if (target && Object.prototype.hasOwnProperty.call(target, 'value')) holder.value = typeof config.get === 'function' ? config.get(target.value) : target.value; else if (target !== undefined) holder.value = typeof config.get === 'function' ? config.get(target) : target; } catch (error) {} }); return holder; }\nfunction ${entry.prefix}_useFetch`
    const propsPattern = `function ${entry.prefix}_defineProps() { return ${entry.prefix}_props; }`
    const propsReplacement = `function ${entry.prefix}_defineProps(options) { var config = options && typeof options === 'object' && !Array.isArray(options) ? options : {}; for (var optionKey in config) { if (!Object.prototype.hasOwnProperty.call(config, optionKey) || ${entry.prefix}_props[optionKey] !== undefined) continue; var option = config[optionKey]; if (option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'default')) { try { ${entry.prefix}_props[optionKey] = typeof option.default === 'function' ? option.default() : option.default; } catch (error) {} } } var expressions = ${entry.prefix}_props.__nuxtPropExpressions || {}; for (var key in expressions) { if (!Object.prototype.hasOwnProperty.call(expressions, key)) continue; (function(propName, expression) { try { Object.defineProperty(${entry.prefix}_props, propName, { enumerable: true, configurable: true, get: function() { try { var value = eval(expression); return isRef(value) ? value.value : value; } catch (error) { return undefined; } } }); } catch (error) {} })(key, expressions[key]); } return ${entry.prefix}_props; }`
    code = code.replace(propsPattern, propsReplacement)
    code = code.replace(modelPattern, modelReplacement)
    code = code.replace(`function ${entry.prefix}_useAsyncData(key, handler) { return useAsyncData(key, handler, '${entry.prefix}'); }`, `function ${entry.prefix}_useAsyncData(key, handler, options) { return useAsyncData(key, handler, options, '${entry.prefix}'); }`)
    code = code.replace(`var ${entry.prefix}_mounted = [];`, `var ${entry.prefix}_beforeMounted = [];\nvar ${entry.prefix}_beforeUnmounted = [];\nvar ${entry.prefix}_mounted = [];`)
    code = code.replace(`function ${entry.prefix}_onMounted(callback) { if (typeof callback === 'function') ${entry.prefix}_mounted.push(callback); }`, `function ${entry.prefix}_onBeforeMount(callback) { if (typeof callback === 'function') ${entry.prefix}_beforeMounted.push(callback); }\nfunction ${entry.prefix}_onBeforeUnmount(callback) { if (typeof callback === 'function') ${entry.prefix}_beforeUnmounted.push(callback); }\nfunction ${entry.prefix}_onMounted(callback) { if (typeof callback === 'function') ${entry.prefix}_mounted.push(callback); }`)
    code = code.replace(`function ${entry.prefix}_runMounted() { for (var i = 0; i < ${entry.prefix}_mounted.length; i++) ${entry.prefix}_mounted[i](); }`, `function ${entry.prefix}_runMounted() { for (var i = 0; i < ${entry.prefix}_beforeMounted.length; i++) ${entry.prefix}_beforeMounted[i](); for (var i = 0; i < ${entry.prefix}_mounted.length; i++) ${entry.prefix}_mounted[i](); }`)
    code = code.replace(`function ${entry.prefix}_runUnmounted() { for (var i = ${entry.prefix}_unmounted.length - 1; i >= 0; i--) ${entry.prefix}_unmounted[i](); }`, `function ${entry.prefix}_runUnmounted() { for (var i = ${entry.prefix}_beforeUnmounted.length - 1; i >= 0; i--) ${entry.prefix}_beforeUnmounted[i](); for (var i = ${entry.prefix}_unmounted.length - 1; i >= 0; i--) ${entry.prefix}_unmounted[i](); }`)
    code += `function ${entry.prefix}_onBeforeRouteLeave(callback) { if (typeof callback === 'function') __nuxtBeforeRouteLeave.push(callback); }\nfunction ${entry.prefix}_onBeforeRouteUpdate(callback) { if (typeof callback === 'function') __nuxtBeforeRouteUpdate.push(callback); }\nfunction ${entry.prefix}_onErrorCaptured(callback) { if (typeof callback === 'function') __nuxtErrorCaptured.push(callback); }\n`
    for (const name of functionNames) code += `function ${entry.prefix}_${name}() { return ${entry.prefix}.${name}.apply(${entry.prefix}, arguments); }\n`
    compiledEntries.push({ ...entry, code, refNames: [...new Set([...refNames, ...asyncRefs, ...modelNames])], bindingNames: returned, functionNames })
  }
  return compiledEntries
}

export async function compilePageScript(source, { filename = 'page.vue', projectRoot, componentScripts = [], autoImports = [], inlineActions = [] } = {}) {
  const setup = readSetupScript(source) ?? { body: '', language: 'js' }
  if (!setup.body.trim() && componentScripts.length === 0) return null
  const bundledSetup = await bundleLocalImports(setup.body, filename, setup.language, projectRoot)
  const setupBody = bundledSetup.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:ref|shallowRef)(?:<[^>]+>)?\s*\(/g, "$1 $2 = ref('$2', ")

  const stateRefs = [...setup.body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:ref|shallowRef)(?:<[^>]+>)?\(/g)]
    .map((match) => match[1])
  const keyedStateRefs = [...setup.body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useState(?:<[^>]+>)?\s*\(/g)].map((match) => match[1])
  const destructuredStateRefs = [...setup.body.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:useFetch|useAsyncData)\s*\(/g)]
    .flatMap((match) => match[1].split(',').map(part => part.trim().split(/\s*:\s*/)[0]).filter(name => /^[A-Za-z_$][\w$]*$/.test(name)))
  const actions = [
    ...setup.body.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...setup.body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g),
    ...setup.body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g),
    ...setup.body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useNativeGesture\s*\(/g)
  ].map((match) => match[1])

  const compiled = await transform(setupBody, {
    loader: setup.language,
    target: 'es2015',
    legalComments: 'none',
    sourcemap: false,
    sourcefile: filename
  })

  let code = `var __nuxtState = {};\nvar __nuxtMounted = [];\nvar __nuxtUnmounted = [];\nvar __nuxtWatchers = [];\nvar __nuxtActiveScope = null;\nvar __nuxtScopeDisposers = {};\nvar __nuxtScopeSequence = 0;\nfunction __nuxtRegisterScopeCleanup(dispose) { if (!__nuxtActiveScope || typeof dispose !== 'function') return dispose; var list = __nuxtScopeDisposers[__nuxtActiveScope]; if (!list) list = __nuxtScopeDisposers[__nuxtActiveScope] = []; list.push(dispose); return dispose; }\nfunction __nuxtDisposeScope(scope) { var list = __nuxtScopeDisposers[String(scope)] || []; delete __nuxtScopeDisposers[String(scope)]; for (var index = list.length - 1; index >= 0; index--) { try { list[index](); } catch (error) {} } }\nfunction getCurrentScope() { return __nuxtActiveScope ? { active: true, name: __nuxtActiveScope } : undefined; }\nfunction onScopeDispose(callback) { return __nuxtRegisterScopeCleanup(callback); }\nfunction effectScope(detached) { var name = '__nuxtEffectScope_' + (++__nuxtScopeSequence); var scope = { active: true, run: function(callback) { if (!scope.active || typeof callback !== 'function') return undefined; var previous = __nuxtActiveScope; __nuxtActiveScope = name; try { return callback(); } finally { __nuxtActiveScope = previous; } }, stop: function() { if (!scope.active) return; scope.active = false; __nuxtDisposeScope(name); } }; if (!detached && __nuxtActiveScope) __nuxtRegisterScopeCleanup(function() { scope.stop(); }); return scope; }\n`
  code += `function NuxtPromise(executor) { var self = this; self.status = 0; self.value = undefined; self.handlers = []; function settle(status, value) { if (self.status !== 0) return; self.status = status; self.value = value; var pending = self.handlers.slice(); self.handlers.length = 0; for (var i = 0; i < pending.length; i++) run(pending[i]); } function resolve(value) { if (value === self) return reject(new TypeError('Promise cannot resolve itself')); if (value && typeof value.then === 'function') return value.then(resolve, reject); settle(1, value); } function reject(error) { settle(2, error); } function run(handler) { if (self.status === 0) return; var callback = self.status === 1 ? handler.onFulfilled : handler.onRejected; if (typeof callback !== 'function') return (self.status === 1 ? handler.resolve : handler.reject)(self.value); try { handler.resolve(callback(self.value)); } catch (error) { handler.reject(error); } } self.then = function(onFulfilled, onRejected) { return new NuxtPromise(function(resolveNext, rejectNext) { var handler = { onFulfilled: onFulfilled, onRejected: onRejected, resolve: resolveNext, reject: rejectNext }; if (self.status === 0) self.handlers.push(handler); else run(handler); }); }; self.catch = function(onRejected) { return self.then(null, onRejected); }; self.finally = function(callback) { return self.then(function(value) { callback(); return value; }, function(error) { callback(); throw error; }); }; try { executor(resolve, reject); } catch (error) { reject(error); } }\nNuxtPromise.resolve = function(value) { return value && typeof value.then === 'function' ? value : new NuxtPromise(function(resolve) { resolve(value); }); };\nNuxtPromise.reject = function(error) { return new NuxtPromise(function(resolve, reject) { reject(error); }); };\nvar Promise = NuxtPromise;\n`
  code += `var __nuxtPreFlushQueue = [];\nvar __nuxtJobQueue = [];\nvar __nuxtPostFlushQueue = [];\nfunction __nuxtAddUnique(queue, job) { if (typeof job === 'function' && queue.indexOf(job) < 0) queue.push(job); }\nfunction __nuxtQueuePreFlushCb(job) { __nuxtAddUnique(__nuxtPreFlushQueue, job); }\nfunction __nuxtQueueJob(job) { __nuxtAddUnique(__nuxtJobQueue, job); }\nfunction __nuxtQueuePostFlushCb(job) { __nuxtAddUnique(__nuxtPostFlushQueue, job); }\nfunction __nuxtFlushJobs() { while (__nuxtPreFlushQueue.length || __nuxtJobQueue.length || __nuxtPostFlushQueue.length) { var pre = __nuxtPreFlushQueue.splice(0, __nuxtPreFlushQueue.length); while (pre.length) { var preJob = pre.shift(); try { preJob(); } catch (error) {} } var pending = __nuxtJobQueue.splice(0, __nuxtJobQueue.length); while (pending.length) { var job = pending.shift(); try { job(); } catch (error) {} } var post = __nuxtPostFlushQueue.splice(0, __nuxtPostFlushQueue.length); while (post.length) { var postJob = post.shift(); try { postJob(); } catch (error) {} } } }\n`
  code = code.replace('for (var i = 0; i < pending.length; i++) run(pending[i]);', 'for (var i = 0; i < pending.length; i++) __nuxtQueueJob((function(handler) { return function() { run(handler); }; })(pending[i]));')
  code = code.replace('else run(handler);', 'else __nuxtQueueJob(function() { run(handler); });')
  code += `function queuePreFlushCb(callback) { __nuxtQueuePreFlushCb(callback); return callback; }
function queueJob(job) { __nuxtQueueJob(job); return job; }
 function queuePostFlushCb(callback) { __nuxtQueuePostFlushCb(callback); return callback; }
function flushPostFlushCbs() { __nuxtFlushJobs(); }
`
  code += `function ref(key, initial) { var current = initial; var holder = { key: key }; Object.defineProperty(holder, 'value', { get: function() { return current; }, set: function(next) { var previous = current; current = next; __nuxtNotifyWatchers(); if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed(key, typeof next === 'string' ? next : JSON.stringify(next)); } }); return holder; }\nfunction shallowRef(key, initial) { return ref(key, initial); }\nvar __nuxtStateStore = {};\nfunction useState(key, init) { var name = String(key); if (!Object.prototype.hasOwnProperty.call(__nuxtStateStore, name)) { var initial = typeof init === 'function' ? init() : init; __nuxtStateStore[name] = ref(name, initial === undefined ? null : initial); } return __nuxtStateStore[name]; }\n`
  code += `function reactive(value) { if (!value || typeof value !== 'object' || typeof Proxy === 'undefined') return value; return new Proxy(value, { set: function(target, key, next) { target[key] = next; __nuxtNotifyWatchers(); return true; }, deleteProperty: function(target, key) { delete target[key]; __nuxtNotifyWatchers(); return true; } }); }\nfunction shallowReactive(value) { return reactive(value); }\nfunction readonly(value) { if (!value || typeof value !== 'object' || typeof Proxy === 'undefined') return value; return new Proxy(value, { set: function() { return true; }, deleteProperty: function() { return true; } }); }\nfunction computed(getter) { var holder = {}; Object.defineProperty(holder, 'value', { get: getter }); return holder; }\nfunction isRef(value) { return !!(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'key') && Object.prototype.hasOwnProperty.call(value, 'value')); }\nfunction unref(value) { return isRef(value) ? value.value : value; }\nfunction toRef(object, key, defaultValue) { if (!object) return ref(String(key), defaultValue); if (isRef(object[key])) return object[key]; var holder = { key: String(key) }; Object.defineProperty(holder, 'value', { get: function() { return object[key] === undefined ? defaultValue : object[key]; }, set: function(next) { object[key] = next; __nuxtNotifyWatchers(); } }); return holder; }\nfunction toRefs(object) { var result = {}; if (!object) return result; for (var key in object) result[key] = toRef(object, key); return result; }\nfunction watch(source, callback) { var getter = typeof source === 'function' ? source : function() { return source.value; }; var watcher = { getter: getter, callback: callback, previous: getter(), active: true }; __nuxtWatchers.push(watcher); return function() { watcher.active = false; }; }\nfunction watchEffect(effect) { effect(); return function() {}; }\nfunction nextTick(callback) { var promise = Promise.resolve(); return typeof callback === 'function' ? promise.then(callback) : promise; }\nfunction __nuxtNotifyWatchers() { for (var i = 0; i < __nuxtWatchers.length; i++) { var watcher = __nuxtWatchers[i]; if (!watcher.active) continue; var current = watcher.getter(); if (current !== watcher.previous) { var previous = watcher.previous; watcher.previous = current; watcher.callback(current, previous); } } }\n`
  code += `var __nuxtAsyncRequests = {};\nfunction __nuxtResolveAsync(requestId, body, failure) { var request = __nuxtAsyncRequests[String(requestId)]; if (!request) return; delete __nuxtAsyncRequests[String(requestId)]; if (failure) { var failureValue; try { failureValue = JSON.parse(String(failure)); } catch (failureParseError) { failureValue = { message: String(failure) }; } var requestError = new Error(String(failureValue && (failureValue.statusMessage || failureValue.message) || 'Request failed')); if (failureValue && failureValue.status !== undefined) requestError.status = failureValue.status; if (failureValue && failureValue.statusMessage !== undefined) requestError.statusMessage = failureValue.statusMessage; if (failureValue && failureValue.data !== undefined) requestError.data = failureValue.data; if (failureValue && failureValue.headers !== undefined) requestError.headers = failureValue.headers; request.reject(requestError); } else { try { var parsed = JSON.parse(body); var response = parsed && (parsed.__nuxtNativeResponse || parsed.__nuxtNativeError) ? parsed : { body: parsed, status: 200, headers: {} }; if (response.status >= 400 || response.__nuxtNativeError) { var responseBody = response.body; var responseError = new Error(String(responseBody && (responseBody.statusMessage || responseBody.message) || 'Request failed')); responseError.status = response.status || 500; responseError.statusMessage = responseBody && responseBody.statusMessage; responseError.data = responseBody && responseBody.data; responseError.headers = response.headers || {}; request.reject(responseError); } else { request.resolve(request.raw ? { body: response.body, status: response.status, headers: response.headers } : response.body); } } catch (parseError) { request.reject(parseError); } } }\nfunction __nuxtStartFetch(path, options, raw) { var request = options || {}; var requestId = __nuxtFetchAsync.fetch(path, request.method || 'GET', JSON.stringify(request.body === undefined ? null : request.body), JSON.stringify(request.headers === undefined ? {} : request.headers)); return new Promise(function(resolve, reject) { __nuxtAsyncRequests[String(requestId)] = { resolve: resolve, reject: reject, raw: !!raw }; }); }\nfunction $fetch(path, options) { return __nuxtStartFetch(path, options, false); }\n$fetch.raw = function(path, options) { return __nuxtStartFetch(path, options, true); };\n`
  code += `function useRoute() { return JSON.parse(__nuxtRoute.current()); }\n`
  code += `function __nuxtMergeFetchOptions(base, override) { var result = {}; var first = base || {}; var second = override || {}; for (var key in first) if (Object.prototype.hasOwnProperty.call(first, key)) result[key] = first[key]; for (var key in second) if (Object.prototype.hasOwnProperty.call(second, key)) result[key] = second[key]; result.headers = {}; var baseHeaders = first.headers || {}; var overrideHeaders = second.headers || {}; for (var header in baseHeaders) if (Object.prototype.hasOwnProperty.call(baseHeaders, header)) result.headers[header] = baseHeaders[header]; for (var header in overrideHeaders) if (Object.prototype.hasOwnProperty.call(overrideHeaders, header)) result.headers[header] = overrideHeaders[header]; return result; }
$fetch.create = function(defaults) { var config = defaults || {}; var client = function(path, options) { var merged = __nuxtMergeFetchOptions(config, options); var baseURL = merged.baseURL; delete merged.baseURL; var target = String(path); if (baseURL && !/^[a-z][a-z0-9+.-]*:\\/\\//i.test(target) && target.indexOf(String(baseURL)) !== 0) target = String(baseURL).replace(/\\/$/, '') + '/' + target.replace(/^\\//, ''); return $fetch(target, merged); }; client.raw = function(path, options) { var merged = __nuxtMergeFetchOptions(config, options); var baseURL = merged.baseURL; delete merged.baseURL; var target = String(path); if (baseURL && !/^[a-z][a-z0-9+.-]*:\\/\\//i.test(target) && target.indexOf(String(baseURL)) !== 0) target = String(baseURL).replace(/\\/$/, '') + '/' + target.replace(/^\\//, ''); return $fetch.raw(target, merged); }; return client; };
`
  code += `var __nuxtRawMetadataResolveAsync = __nuxtResolveAsync;\n__nuxtResolveAsync = function(requestId, body, failure) { var request = __nuxtAsyncRequests[String(requestId)]; if (request && request.raw && !failure) { var originalResolve = request.resolve; request.resolve = function(value) { try { var parsed = JSON.parse(body); if (value && typeof value === 'object' && parsed && parsed.statusMessage !== undefined) value.statusMessage = parsed.statusMessage; } catch (error) {} originalResolve(value); }; } return __nuxtRawMetadataResolveAsync(requestId, body, failure); };\n`
  code += `function useRuntimeConfig() { return JSON.parse(__nuxtRuntimeConfig.current()); }\nfunction useAppConfig() { var config = useRuntimeConfig(); return config && config.appConfig && typeof config.appConfig === 'object' ? config.appConfig : {}; }\nfunction __nuxtNormalizeHead(value) { if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value') && Object.keys(value).length <= 2) return __nuxtNormalizeHead(value.value); if (Array.isArray(value)) { var list = []; for (var i = 0; i < value.length; i++) list.push(__nuxtNormalizeHead(value[i])); return list; } if (value && typeof value === 'object') { var result = {}; for (var key in value) result[key] = __nuxtNormalizeHead(value[key]); return result; } return value; }\nfunction useHead(input) { var apply = function(value) { var normalized = __nuxtNormalizeHead(typeof value === 'function' ? value() : value || {}); if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed('__nuxtHead', JSON.stringify(normalized)); return normalized; }; apply(input); return { update: apply, dispose: function() {} }; }\nfunction useSeoMeta(input) { return useHead(input || {}); }\n`
  code += `function useNativeCapability(name) { return JSON.parse(__nuxtCapabilities.current()).indexOf(name) >= 0; }\nfunction useNuxtApp() { var values = JSON.parse(__nuxtPlugins.current()); var app = {}; for (var key in values) app['$' + key] = values[key]; return app; }\n`
  code += `function useNativeDevice() { if (!useNativeCapability('device')) return null; return JSON.parse(__nuxtNativeDevice.current()); }\nfunction useNativeStorage() { var available = useNativeCapability('storage'); return { available: available, get: function(key, fallback) { if (!available) return fallback === undefined ? null : fallback; var value = __nuxtNativeStorage.get(String(key)); if (value === null || value === undefined || value === '') return fallback === undefined ? null : fallback; try { return JSON.parse(value); } catch (error) { return value; } }, set: function(key, value) { if (!available) return false; __nuxtNativeStorage.set(String(key), JSON.stringify(value)); return true; }, remove: function(key) { if (!available) return false; __nuxtNativeStorage.remove(String(key)); return true; } }; }\nvar __nuxtPermissionRequests = {};\nfunction __nuxtResolvePermission(requestId, granted) { var request = __nuxtPermissionRequests[String(requestId)]; if (!request) return; delete __nuxtPermissionRequests[String(requestId)]; if (granted) request.resolve(true); else request.resolve(false); }\nfunction useNativePermissions() { var available = useNativeCapability('permissions'); return { available: available, has: function(permission) { return available && __nuxtNativePermissions.has(String(permission)); }, request: function(permission) { if (!available) return Promise.resolve(false); var name = String(permission); if (__nuxtNativePermissions.has(name)) return Promise.resolve(true); var requestId = __nuxtNativePermissions.request(name); if (requestId < 0) return Promise.resolve(false); if (requestId === 0) return Promise.resolve(__nuxtNativePermissions.has(name)); return new Promise(function(resolve, reject) { __nuxtPermissionRequests[String(requestId)] = { resolve: resolve, reject: reject }; }); } }; }\nfunction useNativeFileSystem() { var available = useNativeCapability('filesystem'); return { available: available, readText: function(path, fallback) { if (!available) return fallback === undefined ? null : fallback; var value = __nuxtNativeFileSystem.readText(String(path)); return value === null || value === undefined ? (fallback === undefined ? null : fallback) : value; }, writeText: function(path, value) { if (!available) return false; __nuxtNativeFileSystem.writeText(String(path), String(value)); return true; }, exists: function(path) { return available && __nuxtNativeFileSystem.exists(String(path)); }, remove: function(path) { if (!available) return false; __nuxtNativeFileSystem.remove(String(path)); return true; }, list: function(path) { if (!available) return []; var value = __nuxtNativeFileSystem.list(String(path || '')); try { return JSON.parse(value || '[]'); } catch (error) { return []; } } }; }\nfunction useNativeNotifications() { var available = useNativeCapability('notifications'); return { available: available, show: function(title, body, channelId) { if (!available) return false; return __nuxtNativeNotifications.show(String(title || ''), String(body || ''), String(channelId || 'nuxt-native')); } }; }\nvar __nuxtMediaRequests = {};\nfunction __nuxtResolveMedia(requestId, uri) { var request = __nuxtMediaRequests[String(requestId)]; if (!request) return; delete __nuxtMediaRequests[String(requestId)]; request.resolve(uri || null); }\nfunction useNativeMedia() { var available = useNativeCapability('media'); function pick(mimeType) { if (!available) return Promise.resolve(null); var requestId = __nuxtNativeMedia.pick(String(mimeType || '*/*')); if (requestId < 0) return Promise.resolve(null); return new Promise(function(resolve, reject) { __nuxtMediaRequests[String(requestId)] = { resolve: resolve, reject: reject }; }); } function capture() { if (!available) return Promise.resolve(null); var requestId = __nuxtNativeMedia.capture(); if (requestId < 0) return Promise.resolve(null); return new Promise(function(resolve, reject) { __nuxtMediaRequests[String(requestId)] = { resolve: resolve, reject: reject }; }); } return { available: available, pickImage: function() { return pick('image/*'); }, pickFile: function(mimeType) { return pick(mimeType || '*/*'); }, capturePhoto: capture }; }\nvar __nuxtAppStateRef = ref('__nuxtAppState', 'active');\nvar __nuxtAppStateListeners = [];\nfunction useNativeAppLifecycle() { return { state: __nuxtAppStateRef, onChange: function(callback) { if (typeof callback !== 'function') return function() {}; __nuxtAppStateListeners.push(callback); return function() { var index = __nuxtAppStateListeners.indexOf(callback); if (index >= 0) __nuxtAppStateListeners.splice(index, 1); }; } }; }\nfunction __nuxtRunAppState(next) { __nuxtAppStateRef.value = String(next || 'active'); var listeners = __nuxtAppStateListeners.slice(); for (var i = 0; i < listeners.length; i++) { try { listeners[i](__nuxtAppStateRef.value); } catch (error) {} } }\nvar __nuxtSensorListeners = {};\nfunction __nuxtResolveSensor(sensorId, sample) { var callback = __nuxtSensorListeners[String(sensorId)]; if (!callback) return; try { callback(JSON.parse(sample)); } catch (error) {} }\nfunction useNativeSensors() { var available = useNativeCapability('sensors'); return { available: available, start: function(type, callback) { if (!available || typeof callback !== 'function') return -1; var sensorId = __nuxtNativeSensors.start(String(type || 'accelerometer')); if (sensorId < 0) return -1; __nuxtSensorListeners[String(sensorId)] = callback; return sensorId; }, stop: function(sensorId) { if (!available) return false; delete __nuxtSensorListeners[String(sensorId)]; __nuxtNativeSensors.stop(sensorId); return true; } }; }\n`
  code += `var __nuxtDialogRequests = {};
function __nuxtResolveDialog(requestId, result) { var request = __nuxtDialogRequests[String(requestId)]; if (!request) return; delete __nuxtDialogRequests[String(requestId)]; request.resolve(!!result); }
function useNativeDialog() { var available = useNativeCapability('dialog'); return { available: available, show: function(options) { if (!available) return Promise.resolve(false); var value = typeof options === 'string' ? { message: options } : (options || {}); var requestId = __nuxtNativeDialog.show(String(value.title || ''), String(value.message || ''), String(value.confirmText || 'OK'), String(value.cancelText || '')); if (requestId < 0) return Promise.resolve(false); return new Promise(function(resolve, reject) { __nuxtDialogRequests[String(requestId)] = { resolve: resolve, reject: reject }; }); } }; }
`
  code += `function useNativeGesture(options) { var handlers = options || {}; return function(event) { var type = String(event && event.type || ''); var key = type === 'swipeleft' ? 'left' : type === 'swiperight' ? 'right' : type === 'swipeup' ? 'up' : type === 'swipedown' ? 'down' : type === 'touchstart' ? 'start' : type === 'touchend' ? 'end' : type; var callback = handlers[type] || handlers[key]; return typeof callback === 'function' ? callback(event) : undefined; }; }\n`
  code += `function definePageMeta(meta) { return meta || {}; }\n`
  code += `var __nuxtRunningRouteGuard = false;\nfunction navigateTo(path) { var target = String(path); if (!__nuxtRunningRouteGuard) __nuxtNavigate.call(target); return '__nuxt_redirect__:' + target; }\n`
  code += `function useRouter() { return { push: function(path) { __nuxtNavigate.call(path); }, replace: function(path) { __nuxtReplace.call(path); }, back: function() { __nuxtBack.call(); }, forward: function() { __nuxtForward.call(); }, go: function(delta) { __nuxtGo.call(Number(delta) || 0); } }; }\n`
  code += `function __nuxtNamedRoutePath(name, params) { var routes = {}; try { if (typeof __nuxtRouteNames !== 'undefined' && __nuxtRouteNames.names) routes = JSON.parse(__nuxtRouteNames.names() || '{}'); } catch (error) {} var target = routes[String(name)]; if (!target) return ''; var values = params || {}; target = target.replace(/\\*([A-Za-z_$][\\w$]*)/g, function(_, key) { return encodeURIComponent(values[key] === undefined ? '' : String(values[key])); }); target = target.replace(/:([A-Za-z_$][\\w$]*)(\\?)?/g, function(_, key, optional) { var value = values[key]; if (value === undefined || value === null) return optional ? '' : ':' + key; return encodeURIComponent(String(value)); }); return target.replace(/\\/+/g, '/').replace(/\\/$/, '') || '/'; }\nfunction __nuxtNormalizeRouteLocation(location) { if (location === null || location === undefined) return '/'; if (typeof location === 'string') return location; if (typeof location !== 'object') return String(location); var named = location.name ? __nuxtNamedRoutePath(location.name, location.params) : ''; var target = location.path || (location.name ? (named || '/__nuxt-unknown-route__/' + encodeURIComponent(String(location.name))) : '') || '/'; var query = location.query || {}; var pairs = []; for (var key in query) { if (!Object.prototype.hasOwnProperty.call(query, key) || query[key] === undefined) continue; var value = query[key]; if (Array.isArray(value)) { for (var index = 0; index < value.length; index++) pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value[index] === null ? '' : String(value[index]))); } else if (value === null) pairs.push(encodeURIComponent(key)); else pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value))); } if (pairs.length) target += '?' + pairs.join('&'); if (location.hash) target += String(location.hash).charAt(0) === '#' ? String(location.hash) : '#' + String(location.hash); return target; }\nnavigateTo = function(location) { var target = __nuxtNormalizeRouteLocation(location); if (!__nuxtRunningRouteGuard) __nuxtNavigate.call(target); return '__nuxt_redirect__:' + target; };\nuseRouter = function() { return { push: function(location) { __nuxtNavigate.call(__nuxtNormalizeRouteLocation(location)); }, replace: function(location) { __nuxtReplace.call(__nuxtNormalizeRouteLocation(location)); }, back: function() { __nuxtBack.call(); }, forward: function() { __nuxtForward.call(); }, go: function(delta) { __nuxtGo.call(Number(delta) || 0); } }; };\n`
  code += `function onMounted(callback) { __nuxtMounted.push(callback); }\nfunction onUnmounted(callback) { __nuxtUnmounted.push(callback); }\nvar __nuxtBeforeRouteLeave = [];\nvar __nuxtBeforeRouteUpdate = [];\nvar __nuxtErrorCaptured = [];\nfunction onBeforeRouteLeave(callback) { if (typeof callback === 'function') __nuxtBeforeRouteLeave.push(callback); }\nfunction onBeforeRouteUpdate(callback) { if (typeof callback === 'function') __nuxtBeforeRouteUpdate.push(callback); }\nfunction onErrorCaptured(callback) { if (typeof callback === 'function') __nuxtErrorCaptured.push(callback); }\nfunction __nuxtCaptureError(message) { var error = new Error(String(message || 'Native runtime error')); for (var i = 0; i < __nuxtErrorCaptured.length; i++) { try { if (__nuxtErrorCaptured[i](error) === false) return true; } catch (ignored) {} } return false; }\nfunction __nuxtRunMounted() { for (var i = 0; i < __nuxtMounted.length; i++) __nuxtMounted[i](); }\nfunction __nuxtRunUnmounted() { for (var i = __nuxtUnmounted.length - 1; i >= 0; i--) __nuxtUnmounted[i](); }\nfunction __nuxtRouteGuardDecision(result) { if (result && typeof result.then === 'function') { if (result.status === 0) return { pending: true, promise: result }; if (result.status === 2) return { value: '__nuxt_abort__' }; result = result.value; } if (result === false) return { value: '__nuxt_abort__' }; if (typeof result === 'string' && result.indexOf('__nuxt_redirect__:') === 0) return { value: result }; if (typeof result === 'string' && result.length) return { value: '__nuxt_redirect__:' + result }; return { value: '' }; }\nfunction __nuxtRunRouteGuards(kind, to, from) { try { if (typeof to === 'string') to = JSON.parse(to); if (typeof from === 'string') from = JSON.parse(from); } catch (error) { return '__nuxt_abort__'; } var list = kind === 'update' ? __nuxtBeforeRouteUpdate : __nuxtBeforeRouteLeave; __nuxtRunningRouteGuard = true; try { for (var i = 0; i < list.length; i++) { var decision = __nuxtRouteGuardDecision(list[i](to, from)); if (decision.pending) return '__nuxt_async__'; if (decision.value) return decision.value; } return ''; } finally { __nuxtRunningRouteGuard = false; } }\nfunction __nuxtRunRouteGuardsAsync(kind, to, from) { try { if (typeof to === 'string') to = JSON.parse(to); if (typeof from === 'string') from = JSON.parse(from); } catch (error) { __nuxtRouteGuardComplete.complete('__nuxt_abort__'); return; } var list = kind === 'update' ? __nuxtBeforeRouteUpdate : __nuxtBeforeRouteLeave; var index = 0; __nuxtRunningRouteGuard = true; function finish(result) { var decision; try { decision = __nuxtRouteGuardDecision(result); } catch (error) { __nuxtRunningRouteGuard = false; __nuxtRouteGuardComplete.complete('__nuxt_abort__'); return; } if (decision.pending) { decision.promise.then(finish, function() { __nuxtRunningRouteGuard = false; __nuxtRouteGuardComplete.complete('__nuxt_abort__'); }); return; } if (decision.value) { __nuxtRunningRouteGuard = false; __nuxtRouteGuardComplete.complete(decision.value); return; } index++; if (index >= list.length) { __nuxtRunningRouteGuard = false; __nuxtRouteComplete.complete(''); return; } try { finish(list[index](to, from)); } catch (error) { __nuxtRunningRouteGuard = false; __nuxtRouteGuardComplete.complete('__nuxt_abort__'); } } if (!list.length) { __nuxtRunningRouteGuard = false; __nuxtRouteGuardComplete.complete(''); } else { try { finish(list[0](to, from)); } catch (error) { __nuxtRunningRouteGuard = false; __nuxtRouteComplete.complete('__nuxt_abort__'); } } }\n`
  code += `function useAsyncData(key, handler, scope) { var prefix = scope ? String(scope) + '_' : ''; var data = ref(prefix + 'data', null); var pending = ref(prefix + 'pending', true); var error = ref(prefix + 'error', null); function execute() { pending.value = true; try { var value = handler(); if (value && typeof value.then === 'function') value.then(function(next) { data.value = next; error.value = null; pending.value = false; }, function(failure) { error.value = String(failure && failure.message || failure); pending.value = false; }); else { data.value = value; error.value = null; pending.value = false; } } catch (failure) { error.value = String(failure && failure.message || failure); pending.value = false; } } execute(); return { data: data, pending: pending, error: error, refresh: function() { execute(); } }; }\n`
  code += `function useFetch(path, options, scope) { return useAsyncData(path, function() { return $fetch(path, options); }, scope); }\n`
  code += `function useCookie(name, options) { var key = String(name); var config = options || {}; var storage = useNativeStorage(); var fallback = typeof config.default === 'function' ? config.default() : config.default; var holder = ref('__nuxtCookie_' + key, storage.get(key, fallback === undefined ? null : fallback)); watch(holder, function(value) { if (value === null || value === undefined) storage.remove(key); else storage.set(key, value); }); return holder; }\n`
  code += `function __nuxtAppendFetchQuery(path, query) { if (!query || typeof query !== 'object') return path; var hashIndex = path.indexOf('#'); var hash = hashIndex >= 0 ? path.substring(hashIndex) : ''; var target = hashIndex >= 0 ? path.substring(0, hashIndex) : path; var pairs = []; for (var key in query) { if (!Object.prototype.hasOwnProperty.call(query, key) || query[key] === undefined) continue; var value = query[key]; if (Array.isArray(value)) { for (var index = 0; index < value.length; index++) pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value[index] === null ? '' : String(value[index]))); } else if (value === null) pairs.push(encodeURIComponent(key)); else pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value))); } if (!pairs.length) return path; return target + (target.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&') + hash; }\nvar __nuxtOriginalStartFetch = __nuxtStartFetch;\n__nuxtStartFetch = function(path, options, raw) { var request = options || {}; var target = __nuxtAppendFetchQuery(String(path), request.query || request.params); if (target === String(path)) return __nuxtOriginalStartFetch(path, options, raw); var requestId = __nuxtFetchAsync.fetch(target, request.method || 'GET', JSON.stringify(request.body === undefined ? null : request.body), JSON.stringify(request.headers === undefined ? {} : request.headers)); return new Promise(function(resolve, reject) { __nuxtAsyncRequests[String(requestId)] = { resolve: resolve, reject: reject, raw: !!raw }; }); };\n`
  code += `var __nuxtAsyncDataStore = {};\nvar __nuxtOriginalUseAsyncData = useAsyncData;\nuseAsyncData = function(key, handler, scope) { var cacheKey = (scope ? String(scope) + '_' : '') + String(key); if (Object.prototype.hasOwnProperty.call(__nuxtAsyncDataStore, cacheKey)) return __nuxtAsyncDataStore[cacheKey]; var record = __nuxtOriginalUseAsyncData(key, handler, scope); __nuxtAsyncDataStore[cacheKey] = record; return record; };\n`
  code += `function __nuxtAsyncDataKeys(keys) { if (keys === undefined || keys === null) return null; var list = Array.isArray(keys) ? keys : [keys]; return list.map(function(value) { return String(value); }); }\nfunction refreshNuxtData(keys) { var requested = __nuxtAsyncDataKeys(keys); var names = Object.keys(__nuxtAsyncDataStore); for (var index = 0; index < names.length; index++) { var name = names[index]; if (!requested || requested.indexOf(name) >= 0 || requested.indexOf(name.split('_').slice(1).join('_')) >= 0) __nuxtAsyncDataStore[name].refresh(); } return Promise.resolve(); }\nfunction clearNuxtData(keys) { var requested = __nuxtAsyncDataKeys(keys); if (!requested) { __nuxtAsyncDataStore = {}; return; } var names = Object.keys(__nuxtAsyncDataStore); for (var index = 0; index < names.length; index++) { var name = names[index]; if (requested.indexOf(name) >= 0 || requested.indexOf(name.split('_').slice(1).join('_')) >= 0) delete __nuxtAsyncDataStore[name]; } return Promise.resolve(); }\n`
  code += `var __nuxtOriginalUseState = useState;\nuseState = function(key, init) { var name = String(key); var storage = null; try { if (typeof __nuxtCapabilities !== 'undefined' && useNativeCapability('storage')) storage = useNativeStorage(); } catch (error) {} if (!Object.prototype.hasOwnProperty.call(__nuxtStateStore, name)) { var stored = storage ? storage.get('__nuxtState_' + name, null) : null; var initial = stored === null || stored === undefined ? (typeof init === 'function' ? init() : init) : stored; __nuxtStateStore[name] = __nuxtOriginalUseState(name, function() { return initial === undefined ? null : initial; }); if (storage) watch(__nuxtStateStore[name], function(value) { if (value === null || value === undefined) storage.remove('__nuxtState_' + name); else storage.set('__nuxtState_' + name, value); }); } return __nuxtStateStore[name]; };\n`
  code += `function __nuxtMakeAsyncData(key, handler, scope, options) { var prefix = scope ? String(scope) + '_' : ''; var data = ref(prefix + 'data', null); var pending = ref(prefix + 'pending', true); var error = ref(prefix + 'error', null); function execute() { pending.value = true; try { var value = handler(); if (value && typeof value.then === 'function') { value.then(function(next) { data.value = next; error.value = null; pending.value = false; }, function(failure) { error.value = String(failure && failure.message || failure); pending.value = false; }); } else { data.value = value; error.value = null; pending.value = false; } return value; } catch (failure) { error.value = String(failure && failure.message || failure); pending.value = false; return null; } } var record = { data: data, pending: pending, error: error, refresh: function() { return execute(); } }; if (!options || options.immediate !== false) execute(); return record; }\nvar __nuxtDefaultUseAsyncData = useAsyncData;\nuseAsyncData = function(key, handler, optionsOrScope, maybeScope) { var options = optionsOrScope && typeof optionsOrScope === 'object' ? optionsOrScope : {}; var scope = typeof optionsOrScope === 'string' ? optionsOrScope : maybeScope; var cacheKey = (scope ? String(scope) + '_' : '') + String(key); if (Object.prototype.hasOwnProperty.call(__nuxtAsyncDataStore, cacheKey)) return __nuxtAsyncDataStore[cacheKey]; var record = __nuxtMakeAsyncData(key, handler, scope, options); __nuxtAsyncDataStore[cacheKey] = record; return record; };\nuseLazyAsyncData = function(key, handler, optionsOrScope, maybeScope) { var options = optionsOrScope && typeof optionsOrScope === 'object' ? optionsOrScope : {}; var scope = typeof optionsOrScope === 'string' ? optionsOrScope : maybeScope; var deferred = {}; for (var optionKey in options) deferred[optionKey] = options[optionKey]; deferred.immediate = false; return useAsyncData(key, handler, deferred, scope); };\nuseFetch = function(path, options, scope) { var fetchOptions = options || {}; var asyncOptions = {}; if (fetchOptions.immediate !== undefined) asyncOptions.immediate = fetchOptions.immediate; return useAsyncData(path, function() { return $fetch(path, fetchOptions); }, asyncOptions, scope); };\nuseLazyFetch = function(path, options, scope) { var fetchOptions = options || {}; fetchOptions.immediate = false; return useFetch(path, fetchOptions, scope); };\n`
  code += `function __nuxtPickAsyncData(value, pick) { if (!Array.isArray(pick) || !value || typeof value !== 'object') return value; var selected = {}; for (var index = 0; index < pick.length; index++) { var key = String(pick[index]); if (Object.prototype.hasOwnProperty.call(value, key)) selected[key] = value[key]; } return selected; }\nfunction __nuxtNormalizeAsyncError(failure) { var source = failure || {}; var result = { message: String(source.message || source || 'Request failed') }; if (source.status !== undefined) result.status = source.status; if (source.statusMessage !== undefined) result.statusMessage = source.statusMessage; if (source.data !== undefined) result.data = source.data; if (source.headers !== undefined) result.headers = source.headers; return result; }\n__nuxtMakeAsyncData = function(key, handler, scope, options) { var config = options || {}; var prefix = scope ? String(scope) + '_' : ''; var fallback = typeof config.default === 'function' ? config.default() : config.default; var data = ref(prefix + 'data', fallback === undefined ? null : fallback); var pending = ref(prefix + 'pending', true); var error = ref(prefix + 'error', null); function fail(failure) { error.value = __nuxtNormalizeAsyncError(failure); pending.value = false; } function apply(next) { try { var transformed = typeof config.transform === 'function' ? config.transform(next) : next; if (transformed && typeof transformed.then === 'function') return transformed.then(apply, fail); data.value = __nuxtPickAsyncData(transformed, config.pick); error.value = null; pending.value = false; return data.value; } catch (failure) { fail(failure); return null; } } function execute() { pending.value = true; try { var value = handler(); return value && typeof value.then === 'function' ? value.then(apply, fail) : apply(value); } catch (failure) { fail(failure); return null; } } var record = { data: data, pending: pending, error: error, refresh: function() { return execute(); } }; if (config.immediate !== false) execute(); return record; };\nuseFetch = function(path, options, scope) { var fetchOptions = options || {}; var asyncOptions = {}; for (var optionKey in fetchOptions) if (optionKey === 'immediate' || optionKey === 'default' || optionKey === 'transform' || optionKey === 'pick') asyncOptions[optionKey] = fetchOptions[optionKey]; return useAsyncData(path, function() { return $fetch(path, fetchOptions); }, asyncOptions, scope); };\nuseLazyFetch = function(path, options, scope) { var fetchOptions = {}; var source = options || {}; for (var optionKey in source) fetchOptions[optionKey] = source[optionKey]; fetchOptions.immediate = false; return useFetch(path, fetchOptions, scope); };\n`
  code += `var __nuxtOriginalMakeAsyncData = __nuxtMakeAsyncData;\n__nuxtMakeAsyncData = function(key, handler, scope, options) { var record = __nuxtOriginalMakeAsyncData(key, handler, scope, options); var watched = options && options.watch; if (Array.isArray(watched)) { for (var watchIndex = 0; watchIndex < watched.length; watchIndex++) if (watched[watchIndex]) watch(watched[watchIndex], function() { record.refresh(); }); } else if (watched) { watch(watched, function() { record.refresh(); }); } return record; };\nvar __nuxtWatchedUseFetch = useFetch;\nuseFetch = function(path, options, scope) { var fetchOptions = options || {}; var asyncOptions = {}; for (var optionKey in fetchOptions) if (optionKey === 'immediate' || optionKey === 'default' || optionKey === 'transform' || optionKey === 'pick' || optionKey === 'watch') asyncOptions[optionKey] = fetchOptions[optionKey]; return useAsyncData(path, function() { return $fetch(path, fetchOptions); }, asyncOptions, scope); };\nvar __nuxtActiveEffect = null;\nvar __nuxtRunningEffects = false;\nvar __nuxtEffectRef = ref;\nref = function(key, initial) { var current = initial; var holder = { key: key, __nuxtEffects: [] }; Object.defineProperty(holder, 'value', { enumerable: true, get: function() { if (__nuxtActiveEffect && holder.__nuxtEffects.indexOf(__nuxtActiveEffect) < 0) holder.__nuxtEffects.push(__nuxtActiveEffect); return current; }, set: function(next) { var previous = current; current = next; __nuxtNotifyWatchers(); if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed(key, typeof next === 'string' ? next : JSON.stringify(next)); if (previous !== next && !__nuxtRunningEffects) { var effects = holder.__nuxtEffects.slice(); for (var effectIndex = 0; effectIndex < effects.length; effectIndex++) effects[effectIndex](); } } }); return holder; };\nwatchEffect = function(effect) { if (typeof effect !== 'function') return function() {}; var deps = []; var active = true; var run = function() { if (!active || __nuxtRunningEffects) return; for (var index = 0; index < deps.length; index++) { var list = deps[index].__nuxtEffects; var position = list.indexOf(run); if (position >= 0) list.splice(position, 1); } deps = []; __nuxtActiveEffect = run; try { effect(); } finally { __nuxtActiveEffect = null; } for (var key in __nuxtEffectRef) {} };\nrun = (function(originalRun) { return function() { if (!active || __nuxtRunningEffects) return; __nuxtRunningEffects = true; try { originalRun(); } finally { __nuxtRunningEffects = false; } }; })(run);\nvar initialRun = run; __nuxtActiveEffect = run; try { effect(); } finally { __nuxtActiveEffect = null; } var stop = function() { if (!active) return; active = false; for (var index = 0; index < deps.length; index++) { var list = deps[index].__nuxtEffects; var position = list.indexOf(run); if (position >= 0) list.splice(position, 1); } deps = []; }; return stop; };\n`
  code += `var __nuxtEffectState = null;\nvar __nuxtEffectGuard = false;\nref = function(key, initial) { var current = initial; var holder = { key: key, __nuxtEffects: [] }; Object.defineProperty(holder, 'value', { enumerable: true, get: function() { if (__nuxtEffectState && __nuxtEffectState.deps.indexOf(holder) < 0) { __nuxtEffectState.deps.push(holder); holder.__nuxtEffects.push(__nuxtEffectState.run); } return current; }, set: function(next) { var previous = current; current = next; __nuxtNotifyWatchers(); if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed(key, typeof next === 'string' ? next : JSON.stringify(next)); if (previous !== next && !__nuxtEffectGuard) { var effects = holder.__nuxtEffects.slice(); for (var effectIndex = 0; effectIndex < effects.length; effectIndex++) effects[effectIndex](); } } }); return holder; };\nwatchEffect = function(effect) { if (typeof effect !== 'function') return function() {}; var state = { active: true, deps: [], run: null }; state.run = function() { if (!state.active || __nuxtEffectGuard) return; for (var index = 0; index < state.deps.length; index++) { var list = state.deps[index].__nuxtEffects; var position = list.indexOf(state.run); if (position >= 0) list.splice(position, 1); } state.deps = []; __nuxtEffectGuard = true; __nuxtEffectState = state; try { effect(); } finally { __nuxtEffectState = null; __nuxtEffectGuard = false; } }; state.run(); return function() { if (!state.active) return; state.active = false; for (var index = 0; index < state.deps.length; index++) { var list = state.deps[index].__nuxtEffects; var position = list.indexOf(state.run); if (position >= 0) list.splice(position, 1); } state.deps = []; }; };\nvar __nuxtBeforeMount = [];\nvar __nuxtBeforeUnmount = [];\nfunction onBeforeMount(callback) { if (typeof callback === 'function') __nuxtBeforeMount.push(callback); }\nfunction onBeforeUnmount(callback) { if (typeof callback === 'function') __nuxtBeforeUnmount.push(callback); }\nvar __nuxtOriginalRunMounted = __nuxtRunMounted;\n__nuxtRunMounted = function() { for (var index = 0; index < __nuxtBeforeMount.length; index++) __nuxtBeforeMount[index](); __nuxtOriginalRunMounted(); };\nvar __nuxtOriginalRunUnmounted = __nuxtRunUnmounted;\n__nuxtRunUnmounted = function() { for (var index = __nuxtBeforeUnmount.length - 1; index >= 0; index--) __nuxtBeforeUnmount[index](); __nuxtOriginalRunUnmounted(); };\n`
  code += `__nuxtMakeAsyncData = function(key, handler, scope, options) { var config = options || {}; var prefix = scope ? String(scope) + '_' : ''; var fallback = typeof config.default === 'function' ? config.default() : config.default; var data = ref(prefix + 'data', fallback === undefined ? null : fallback); var pending = ref(prefix + 'pending', true); var error = ref(prefix + 'error', null); var generation = 0; function fail(failure, token) { if (token !== generation) return; error.value = __nuxtNormalizeAsyncError(failure); pending.value = false; } function apply(next, token) { if (token !== generation) return next; try { var transformed = typeof config.transform === 'function' ? config.transform(next) : next; if (transformed && typeof transformed.then === 'function') return transformed.then(function(value) { return apply(value, token); }, function(failure) { fail(failure, token); }); if (token !== generation) return transformed; data.value = __nuxtPickAsyncData(transformed, config.pick); error.value = null; pending.value = false; return data.value; } catch (failure) { fail(failure, token); return null; } } function execute() { var token = ++generation; pending.value = true; try { var value = handler(); return value && typeof value.then === 'function' ? value.then(function(next) { return apply(next, token); }, function(failure) { fail(failure, token); }) : apply(value, token); } catch (failure) { fail(failure, token); return null; } } var record = { data: data, pending: pending, error: error, refresh: function() { return execute(); } }; if (config.immediate !== false) execute(); var watched = config.watch; if (Array.isArray(watched)) { for (var watchIndex = 0; watchIndex < watched.length; watchIndex++) if (watched[watchIndex]) watch(watched[watchIndex], function() { record.refresh(); }); } else if (watched) { watch(watched, function() { record.refresh(); }); } return record; };\n`
  const obsoleteEffectStart = code.indexOf('var __nuxtActiveEffect = null;')
  const effectReplacementStart = code.indexOf('var __nuxtEffectState = null;', obsoleteEffectStart)
  if (obsoleteEffectStart >= 0 && effectReplacementStart > obsoleteEffectStart) code = code.slice(0, obsoleteEffectStart) + code.slice(effectReplacementStart)
  code += `computed = function(options) { var getter = typeof options === 'function' ? options : (options && typeof options.get === 'function' ? options.get : function() { return undefined; }); var setter = options && typeof options === 'object' && typeof options.set === 'function' ? options.set : function() {}; var holder = { key: '__nuxtComputed', __nuxtEffects: [] }; var cached; var dirty = true; var state = { deps: [], run: null }; state.run = function() { if (dirty) return; dirty = true; var effects = holder.__nuxtEffects.slice(); for (var index = 0; index < effects.length; index++) effects[index](); }; function evaluate() { for (var index = 0; index < state.deps.length; index++) { var list = state.deps[index].__nuxtEffects; var position = list.indexOf(state.run); if (position >= 0) list.splice(position, 1); } state.deps = []; var previous = __nuxtEffectState; __nuxtEffectState = state; try { cached = getter(); } finally { __nuxtEffectState = previous; } dirty = false; } Object.defineProperty(holder, 'value', { enumerable: true, get: function() { if (__nuxtEffectState && __nuxtEffectState !== state && holder.__nuxtEffects.indexOf(__nuxtEffectState.run) < 0) holder.__nuxtEffects.push(__nuxtEffectState.run); if (dirty) evaluate(); return cached; }, set: setter }); return holder; };\nvar __nuxtReactiveTargets = [];\nvar __nuxtReactiveProxies = [];\nvar __nuxtReactiveShallow = [];\nfunction __nuxtMakeReactive(value, shallow) { if (!value || typeof value !== 'object' || typeof Proxy === 'undefined') return value; for (var cachedIndex = 0; cachedIndex < __nuxtReactiveTargets.length; cachedIndex++) if (__nuxtReactiveTargets[cachedIndex] === value && __nuxtReactiveShallow[cachedIndex] === !!shallow) return __nuxtReactiveProxies[cachedIndex]; var effects = []; var proxy = new Proxy(value, { get: function(target, key) { if (__nuxtEffectState && effects.indexOf(__nuxtEffectState.run) < 0) effects.push(__nuxtEffectState.run); var next = target[key]; return shallow ? next : __nuxtMakeReactive(next, false); }, set: function(target, key, next) { var previous = target[key]; target[key] = next; __nuxtNotifyWatchers(); if (previous !== next && !__nuxtEffectGuard) { var pending = effects.slice(); for (var index = 0; index < pending.length; index++) pending[index](); } return true; }, deleteProperty: function(target, key) { var existed = Object.prototype.hasOwnProperty.call(target, key); delete target[key]; __nuxtNotifyWatchers(); if (existed && !__nuxtEffectGuard) { var pending = effects.slice(); for (var index = 0; index < pending.length; index++) pending[index](); } return true; } }); __nuxtReactiveTargets.push(value); __nuxtReactiveProxies.push(proxy); __nuxtReactiveShallow.push(!!shallow); return proxy; }\nreactive = function(value) { return __nuxtMakeReactive(value, false); };\nshallowReactive = function(value) { return __nuxtMakeReactive(value, true); };\n`
  code += `function __nuxtWatchValue(source) { if (Array.isArray(source)) { var values = []; for (var index = 0; index < source.length; index++) values.push(__nuxtWatchValue(source[index])); return values; } if (typeof source === 'function') return source(); if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, 'value')) return source.value; return source; }\nfunction __nuxtWatchEqual(previous, current) { if (Array.isArray(previous) && Array.isArray(current)) { if (previous.length !== current.length) return false; for (var index = 0; index < previous.length; index++) if (previous[index] !== current[index]) return false; return true; } return previous === current; }\nwatch = function(source, callback, options) { var watcher = { getter: function() { return __nuxtWatchValue(source); }, callback: callback, previous: __nuxtWatchValue(source), active: true }; __nuxtWatchers.push(watcher); if (options && options.immediate && typeof callback === 'function') callback(watcher.previous, undefined); return function() { watcher.active = false; }; };\n__nuxtNotifyWatchers = function() { for (var index = 0; index < __nuxtWatchers.length; index++) { var watcher = __nuxtWatchers[index]; if (!watcher.active) continue; var current = watcher.getter(); if (!__nuxtWatchEqual(current, watcher.previous)) { var previous = watcher.previous; watcher.previous = current; watcher.callback(current, previous); } } };\ncomputed = function(options) { var getter = typeof options === 'function' ? options : (options && typeof options.get === 'function' ? options.get : function() { return undefined; }); var setter = options && typeof options === 'object' && typeof options.set === 'function' ? options.set : function() {}; var holder = { key: '__nuxtComputed' }; Object.defineProperty(holder, 'value', { enumerable: true, get: getter, set: setter }); return holder; };\n`
  code += `var __nuxtProvides = {};\nfunction provide(key, value) { __nuxtProvides[String(key)] = value; return value; }\nfunction inject(key, defaultValue) { var name = String(key); if (Object.prototype.hasOwnProperty.call(__nuxtProvides, name)) return __nuxtProvides[name]; return typeof defaultValue === 'function' ? defaultValue() : defaultValue; }\n`
  code += `computed = function(options) { var getter = typeof options === 'function' ? options : (options && typeof options.get === 'function' ? options.get : function() { return undefined; }); var setter = options && typeof options === 'object' && typeof options.set === 'function' ? options.set : function() {}; var holder = { key: '__nuxtComputed', __nuxtEffects: [] }; var cached; var dirty = true; var state = { deps: [], run: null }; state.run = function() { if (dirty) return; dirty = true; var effects = holder.__nuxtEffects.slice(); for (var index = 0; index < effects.length; index++) effects[index](); }; function evaluate() { for (var index = 0; index < state.deps.length; index++) { var list = state.deps[index].__nuxtEffects; var position = list.indexOf(state.run); if (position >= 0) list.splice(position, 1); } state.deps = []; var previous = __nuxtEffectState; __nuxtEffectState = state; try { cached = getter(); } finally { __nuxtEffectState = previous; } dirty = false; } Object.defineProperty(holder, 'value', { enumerable: true, get: function() { if (__nuxtEffectState && __nuxtEffectState !== state && holder.__nuxtEffects.indexOf(__nuxtEffectState.run) < 0) holder.__nuxtEffects.push(__nuxtEffectState.run); if (dirty) evaluate(); return cached; }, set: setter }); return holder; };
`
  code += `var __nuxtAnonymousRef = 0;
ref = function(key, initial) { if (arguments.length < 2) { initial = key; key = '__nuxtAnonymousRef_' + (++__nuxtAnonymousRef); } var current = initial; var holder = { key: key, __nuxtEffects: [] }; Object.defineProperty(holder, 'value', { enumerable: true, get: function() { if (__nuxtEffectState && __nuxtEffectState.deps.indexOf(holder) < 0) { __nuxtEffectState.deps.push(holder); holder.__nuxtEffects.push(__nuxtEffectState.run); } return current; }, set: function(next) { var previous = current; current = next; __nuxtNotifyWatchers(); if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed(key, typeof next === 'string' ? next : JSON.stringify(next)); if (previous !== next && !__nuxtEffectGuard) { var effects = holder.__nuxtEffects.slice(); for (var effectIndex = 0; effectIndex < effects.length; effectIndex++) effects[effectIndex](); } } }); return holder; };
shallowRef = function(value, initial) { return arguments.length < 2 ? ref(value) : ref(value, initial); };
var __nuxtErrorState = ref('__nuxtError', null);
function __nuxtNormalizeError(value) { var source = value || {}; if (typeof source === 'string') return { statusCode: 500, statusMessage: source, message: source }; return { statusCode: Number(source.statusCode || source.status || 500), statusMessage: String(source.statusMessage || source.message || 'Native runtime error'), message: String(source.message || source.statusMessage || 'Native runtime error'), data: source.data === undefined ? null : source.data }; }
function useError() { return __nuxtErrorState; }
function showError(value) { var normalized = __nuxtNormalizeError(value); __nuxtErrorState.value = normalized; if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed('__nuxtShowError', JSON.stringify(normalized)); return normalized; }
function clearError() { __nuxtErrorState.value = null; if (__nuxtStateChanged && typeof __nuxtStateChanged.changed === 'function') __nuxtStateChanged.changed('__nuxtClearError', 'true'); return Promise.resolve(); }
var __nuxtRouteProxy;
function __nuxtReadRoute() { try { var value = JSON.parse(__nuxtRoute.current()); return value && typeof value === 'object' ? value : {}; } catch (error) { return {}; } }
useRoute = function() { if (__nuxtRouteProxy) return __nuxtRouteProxy; var route = {}; var keys = ['path', 'fullPath', 'params', 'query', 'hash', 'name', 'meta']; for (var index = 0; index < keys.length; index++) (function(key) { Object.defineProperty(route, key, { enumerable: true, configurable: false, get: function() { return __nuxtReadRoute()[key]; } }); })(keys[index]); __nuxtRouteProxy = route; return route; };
var __nuxtReadonlyTargets = [];
var __nuxtReadonlyProxies = [];
function __nuxtMakeReadonly(value) { if (!value || typeof value !== 'object' || typeof Proxy === 'undefined') return value; for (var cachedIndex = 0; cachedIndex < __nuxtReadonlyTargets.length; cachedIndex++) if (__nuxtReadonlyTargets[cachedIndex] === value) return __nuxtReadonlyProxies[cachedIndex]; var proxy = new Proxy(value, { get: function(target, key) { return __nuxtMakeReadonly(target[key]); }, set: function() { return true; }, deleteProperty: function() { return true; } }); __nuxtReadonlyTargets.push(value); __nuxtReadonlyProxies.push(proxy); return proxy; }
readonly = function(value) { return __nuxtMakeReadonly(value); };
watchEffect = function(effect) { if (typeof effect !== 'function') return function() {}; var state = { active: true, deps: [], run: null, cleanup: null }; function removeDependencies() { for (var index = 0; index < state.deps.length; index++) { var list = state.deps[index].__nuxtEffects; var position = list.indexOf(state.run); if (position >= 0) list.splice(position, 1); } state.deps = []; } function onCleanup(callback) { state.cleanup = typeof callback === 'function' ? callback : null; } state.run = function() { if (!state.active || __nuxtEffectGuard) return; removeDependencies(); if (state.cleanup) { var previousCleanup = state.cleanup; state.cleanup = null; try { previousCleanup(); } catch (error) {} } __nuxtEffectGuard = true; __nuxtEffectState = state; try { effect(onCleanup); } finally { __nuxtEffectState = null; __nuxtEffectGuard = false; } }; state.run(); return function() { if (!state.active) return; state.active = false; removeDependencies(); if (state.cleanup) { var finalCleanup = state.cleanup; state.cleanup = null; try { finalCleanup(); } catch (error) {} } }; };
var __nuxtWatchWithCleanup = watch;
watch = function(source, callback, options) { var watcher = { getter: function() { return __nuxtWatchValue(source); }, callback: callback, previous: __nuxtWatchValue(source), active: true, cleanup: null }; function onCleanup(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; } __nuxtWatchers.push(watcher); if (options && options.immediate && typeof callback === 'function') callback(watcher.previous, undefined, onCleanup); return function() { if (!watcher.active) return; watcher.active = false; if (watcher.cleanup) { var finalCleanup = watcher.cleanup; watcher.cleanup = null; try { finalCleanup(); } catch (error) {} } }; };
__nuxtNotifyWatchers = function() { for (var index = 0; index < __nuxtWatchers.length; index++) { var watcher = __nuxtWatchers[index]; if (!watcher.active) continue; var current = watcher.getter(); if (!__nuxtWatchEqual(current, watcher.previous)) { var previous = watcher.previous; watcher.previous = current; if (watcher.cleanup) { var previousCleanup = watcher.cleanup; watcher.cleanup = null; try { previousCleanup(); } catch (error) {} } watcher.callback(current, previous, function(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; }); } } };
function __nuxtWatchSnapshot(value, seen) { if (value === null || value === undefined || typeof value !== 'object') return value; var visited = seen || []; if (visited.indexOf(value) >= 0) return undefined; visited.push(value); if (Array.isArray(value)) { var list = []; for (var index = 0; index < value.length; index++) list.push(__nuxtWatchSnapshot(value[index], visited)); return list; } var result = {}; for (var key in value) result[key] = __nuxtWatchSnapshot(value[key], visited); return result; }
watch = function(source, callback, options) { var deep = !!(options && options.deep) || !!(source && typeof source === 'object' && !Array.isArray(source) && !Object.prototype.hasOwnProperty.call(source, 'value')); var initial = __nuxtWatchValue(source); var watcher = { getter: function() { return __nuxtWatchValue(source); }, callback: callback, previous: initial, comparison: deep ? __nuxtWatchSnapshot(initial) : initial, active: true, cleanup: null, deep: deep }; function onCleanup(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; } __nuxtWatchers.push(watcher); if (options && options.immediate && typeof callback === 'function') callback(watcher.previous, undefined, onCleanup); return function() { if (!watcher.active) return; watcher.active = false; if (watcher.cleanup) { var finalCleanup = watcher.cleanup; watcher.cleanup = null; try { finalCleanup(); } catch (error) {} } }; };
__nuxtNotifyWatchers = function() { for (var index = 0; index < __nuxtWatchers.length; index++) { var watcher = __nuxtWatchers[index]; if (!watcher.active) continue; var current = watcher.getter(); var comparison = watcher.deep ? __nuxtWatchSnapshot(current) : current; if (!__nuxtWatchEqual(comparison, watcher.comparison)) { var previous = watcher.previous; watcher.previous = current; watcher.comparison = comparison; if (watcher.cleanup) { var previousCleanup = watcher.cleanup; watcher.cleanup = null; try { previousCleanup(); } catch (error) {} } watcher.callback(current, previous, function(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; }); } } };
`
  code += `function __nuxtWatchNeedsDeep(source) { if (Array.isArray(source)) { for (var index = 0; index < source.length; index++) if (__nuxtWatchNeedsDeep(source[index])) return true; return false; } return !!(source && typeof source === 'object' && !Object.prototype.hasOwnProperty.call(source, 'value')); }
function __nuxtRunWatchCallback(watcher, current, previous) { if (!watcher.active) return; if (watcher.cleanup) { var previousCleanup = watcher.cleanup; watcher.cleanup = null; try { previousCleanup(); } catch (error) {} } watcher.callback(current, previous, function(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; }); }
watch = function(source, callback, options) { var deep = !!(options && options.deep) || __nuxtWatchNeedsDeep(source); var initial = __nuxtWatchValue(source); var watcher = { getter: function() { return __nuxtWatchValue(source); }, callback: callback, previous: initial, comparison: deep ? __nuxtWatchSnapshot(initial) : initial, active: true, cleanup: null, deep: deep, flush: options && options.flush === 'post' ? 'post' : 'sync', queued: false, queuedCurrent: undefined, queuedPrevious: undefined }; function onCleanup(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; } __nuxtWatchers.push(watcher); if (options && options.immediate && typeof callback === 'function') { if (watcher.flush === 'post') __nuxtQueueJob(function() { __nuxtRunWatchCallback(watcher, watcher.previous, undefined); }); else __nuxtRunWatchCallback(watcher, watcher.previous, undefined); } return function() { if (!watcher.active) return; watcher.active = false; if (watcher.cleanup) { var finalCleanup = watcher.cleanup; watcher.cleanup = null; try { finalCleanup(); } catch (error) {} } }; };
__nuxtNotifyWatchers = function() { for (var index = 0; index < __nuxtWatchers.length; index++) { var watcher = __nuxtWatchers[index]; if (!watcher.active) continue; var current = watcher.getter(); var comparison = watcher.deep ? __nuxtWatchSnapshot(current) : current; if (!__nuxtWatchEqual(comparison, watcher.comparison)) { var previous = watcher.previous; watcher.previous = current; watcher.comparison = comparison; if (watcher.flush === 'post') { watcher.queuedCurrent = current; if (!watcher.queued) { watcher.queued = true; watcher.queuedPrevious = previous; __nuxtQueueJob(function() { watcher.queued = false; var next = watcher.queuedCurrent; var old = watcher.queuedPrevious; watcher.queuedCurrent = undefined; watcher.queuedPrevious = undefined; __nuxtRunWatchCallback(watcher, next, old); }); } } else __nuxtRunWatchCallback(watcher, current, previous); } } };
`
  code += `function __nuxtCreateWatchEffect(effect, flush) { if (typeof effect !== 'function') return function() {}; var state = { active: true, deps: [], run: null, cleanup: null, flush: flush === 'post' ? 'post' : 'sync', scheduled: false, started: false }; function removeDependencies() { for (var index = 0; index < state.deps.length; index++) { var list = state.deps[index].__nuxtEffects; var position = list.indexOf(state.run); if (position >= 0) list.splice(position, 1); } state.deps = []; } function onCleanup(callback) { state.cleanup = typeof callback === 'function' ? callback : null; } state.execute = function() { if (!state.active || __nuxtEffectGuard) return; removeDependencies(); if (state.cleanup) { var previousCleanup = state.cleanup; state.cleanup = null; try { previousCleanup(); } catch (error) {} } __nuxtEffectGuard = true; __nuxtEffectState = state; try { effect(onCleanup); } finally { __nuxtEffectState = null; __nuxtEffectGuard = false; state.started = true; } }; state.run = function() { if (!state.active || __nuxtEffectGuard) return; if (state.flush === 'post' && state.started) { if (state.scheduled) return; state.scheduled = true; __nuxtQueueJob(function() { state.scheduled = false; state.execute(); }); } else state.execute(); }; state.run(); return function() { if (!state.active) return; state.active = false; removeDependencies(); if (state.cleanup) { var finalCleanup = state.cleanup; state.cleanup = null; try { finalCleanup(); } catch (error) {} } }; }\nwatchSyncEffect = function(effect) { return __nuxtCreateWatchEffect(effect, 'sync'); };\nwatchPostEffect = function(effect) { return __nuxtCreateWatchEffect(effect, 'post'); };\n`
  code += `var __nuxtWatchWithOnce = watch;\nwatch = function(source, callback, options) { var config = options || {}; if (!config.once) return __nuxtWatchWithOnce(source, callback, options); var active = true; var stop; stop = __nuxtWatchWithOnce(source, function(next, previous, onCleanup) { if (!active) return; active = false; try { return callback(next, previous, onCleanup); } finally { if (stop) stop(); } }, options); if (!active && stop) stop(); return stop; };\nvar __nuxtScopedWatch = watch;\nwatch = function(source, callback, options) { var stop = __nuxtScopedWatch(source, callback, options); return __nuxtRegisterScopeCleanup(stop); };\nvar __nuxtScopedWatchEffect = watchEffect;\nwatchEffect = function(effect) { var stop = __nuxtScopedWatchEffect(effect); return __nuxtRegisterScopeCleanup(stop); };\nvar __nuxtScopedWatchPostEffect = watchPostEffect;\nwatchPostEffect = function(effect) { var stop = __nuxtScopedWatchPostEffect(effect); return __nuxtRegisterScopeCleanup(stop); };\nvar __nuxtScopedWatchSyncEffect = watchSyncEffect;\nwatchSyncEffect = function(effect) { var stop = __nuxtScopedWatchSyncEffect(effect); return __nuxtRegisterScopeCleanup(stop); };\nvar __nuxtScopedLifecycle = useNativeAppLifecycle;\nuseNativeAppLifecycle = function() { var lifecycle = __nuxtScopedLifecycle(); var subscribe = lifecycle.onChange; lifecycle.onChange = function(callback) { return __nuxtRegisterScopeCleanup(subscribe(callback)); }; return lifecycle; };\nvar __nuxtScopedSensors = useNativeSensors;\nuseNativeSensors = function() { var sensors = __nuxtScopedSensors(); var start = sensors.start; sensors.start = function(type, callback) { var sensorId = start(type, callback); if (sensorId >= 0) __nuxtRegisterScopeCleanup(function() { sensors.stop(sensorId); }); return sensorId; }; return sensors; };\n`
  code += `function useNativeClipboard() { var available = useNativeCapability('clipboard'); return { available: available, readText: function(fallback) { if (!available) return fallback === undefined ? null : fallback; var value = __nuxtNativeClipboard.readText(); return value === null || value === undefined ? (fallback === undefined ? null : fallback) : value; }, writeText: function(value) { return available && __nuxtNativeClipboard.writeText(String(value === undefined || value === null ? '' : value)); } }; }\n`
  code = code.replace("flush: options && options.flush === 'post' ? 'post' : 'sync'", "flush: options && options.flush === 'post' ? 'post' : options && options.flush === 'pre' ? 'pre' : 'sync'")
  code = code.replace("if (watcher.flush === 'post') __nuxtQueueJob(function() { __nuxtRunWatchCallback(watcher, watcher.previous, undefined); }); else __nuxtRunWatchCallback(watcher, watcher.previous, undefined);", "if (watcher.flush === 'post') __nuxtQueuePostFlushCb(function() { __nuxtRunWatchCallback(watcher, watcher.previous, undefined); }); else if (watcher.flush === 'pre') __nuxtQueuePreFlushCb(function() { __nuxtRunWatchCallback(watcher, watcher.previous, undefined); }); else __nuxtRunWatchCallback(watcher, watcher.previous, undefined);")
  code = code.replace("if (watcher.flush === 'post') { watcher.queuedCurrent", "if (watcher.flush === 'post' || watcher.flush === 'pre') { watcher.queuedCurrent")
  code = code.replace("__nuxtQueueJob(function() { watcher.queued = false;", "__nuxtQueueFlush(watcher, function() { watcher.queued = false;")
  code = code.replace("function __nuxtWatchNeedsDeep(source)", "function __nuxtQueueFlush(watcher, job) { if (watcher && watcher.flush === 'pre') __nuxtQueuePreFlushCb(job); else __nuxtQueuePostFlushCb(job); }\nfunction __nuxtQueueWatchCallback(watcher) { var pendingWatcher = watcher; __nuxtQueueFlush(pendingWatcher, function() { pendingWatcher.queued = false; var next = pendingWatcher.queuedCurrent; var old = pendingWatcher.queuedPrevious; pendingWatcher.queuedCurrent = undefined; pendingWatcher.queuedPrevious = undefined; __nuxtRunWatchCallback(pendingWatcher, next, old); }); }\nfunction __nuxtWatchNeedsDeep(source)")
  code = code.replace("__nuxtQueueFlush(watcher, function() { watcher.queued = false; var next = watcher.queuedCurrent; var old = watcher.queuedPrevious; watcher.queuedCurrent = undefined; watcher.queuedPrevious = undefined; __nuxtRunWatchCallback(watcher, next, old); });", "__nuxtQueueWatchCallback(watcher);")
  code = code.replace("function __nuxtRunWatchCallback(watcher, current, previous) { if (!watcher.active) return; if (watcher.cleanup) { var previousCleanup = watcher.cleanup; watcher.cleanup = null; try { previousCleanup(); } catch (error) {} } watcher.callback(current, previous, function(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; }); }", "var __nuxtCurrentWatcher = null;\nfunction onWatcherCleanup(handler) { if (__nuxtCurrentWatcher && __nuxtCurrentWatcher.active) __nuxtCurrentWatcher.cleanup = typeof handler === 'function' ? handler : null; if (typeof __nuxtEffectState !== 'undefined' && __nuxtEffectState && __nuxtEffectState.active) __nuxtEffectState.cleanup = typeof handler === 'function' ? handler : null; }\nfunction __nuxtRunWatchCallback(watcher, current, previous) { if (!watcher.active) return; if (watcher.cleanup) { var previousCleanup = watcher.cleanup; watcher.cleanup = null; try { previousCleanup(); } catch (error) {} } var previousWatcher = __nuxtCurrentWatcher; __nuxtCurrentWatcher = watcher; try { watcher.callback(current, previous, function(handler) { watcher.cleanup = typeof handler === 'function' ? handler : null; }); } finally { __nuxtCurrentWatcher = previousWatcher; } }")
  code = code.replace("flush: flush === 'post' ? 'post' : 'sync'", "flush: flush === 'post' ? 'post' : flush === 'pre' ? 'pre' : 'sync'")
  code = code.replace("if (state.flush === 'post' && state.started)", "if ((state.flush === 'post' || state.flush === 'pre') && state.started)")
  code = code.replace("__nuxtQueueJob(function() { state.scheduled = false; state.execute(); });", "__nuxtQueueFlush(state, function() { state.scheduled = false; state.execute(); });")
  const autoImportConsumer = [setup.body, ...componentScripts.map(entry => entry.source ?? '')].join('\n')
  const autoImportResult = await compileAutoImports(autoImports, autoImportConsumer)
  code += `${autoImportResult.code}\n`
  code += `if (typeof __nuxtResolveAsync === 'function') { var __nuxtOriginalResolveAsync = __nuxtResolveAsync; __nuxtResolveAsync = function() { var result = __nuxtOriginalResolveAsync.apply(this, arguments); __nuxtFlushJobs(); return result; }; }\nif (typeof __nuxtResolvePermission === 'function') { var __nuxtOriginalResolvePermission = __nuxtResolvePermission; __nuxtResolvePermission = function() { var result = __nuxtOriginalResolvePermission.apply(this, arguments); __nuxtFlushJobs(); return result; }; }\nif (typeof __nuxtResolveMedia === 'function') { var __nuxtOriginalResolveMedia = __nuxtResolveMedia; __nuxtResolveMedia = function() { var result = __nuxtOriginalResolveMedia.apply(this, arguments); __nuxtFlushJobs(); return result; }; }\nif (typeof __nuxtResolveSensor === 'function') { var __nuxtOriginalResolveSensor = __nuxtResolveSensor; __nuxtResolveSensor = function() { var result = __nuxtOriginalResolveSensor.apply(this, arguments); __nuxtFlushJobs(); return result; }; }\n`
  code += `var __nuxtStateBindings = {};\nfunction __nuxtSetState(name, value) { if (__nuxtStateBindings[name]) return __nuxtStateBindings[name](value); var target = name + '.value = ' + JSON.stringify(value); return eval(target); }\nfunction __nuxtSetModel(name, value) { if (__nuxtStateBindings[name]) return __nuxtStateBindings[name](value); if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[[0-9]+\\])*$/.test(name)) throw new Error('Invalid model binding: ' + name); var parts = name.replace(/\\[([0-9]+)\\]/g, '.$1').split('.'); var target = eval(parts[0]); if (parts.length === 1) return target && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, 'value') ? target.value = value : eval(name + ' = ' + JSON.stringify(value)); if (target && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, 'value')) target = target.value; for (var index = 1; index < parts.length - 1; index++) { if (target == null) return value; target = target[parts[index]]; } if (target != null) target[parts[parts.length - 1]] = value; return value; }\n`
  code += `var __nuxtRouteComplete = typeof __nuxtRouteGuardComplete === 'undefined' ? { complete: function() {} } : __nuxtRouteGuardComplete;\n`
  const compiledComponents = await compileComponentScripts(componentScripts)
  // Evaluate page setup before child setup so bound component props and
  // parent event handlers are available when a child calls its macros.
  code += `${compiled.code}\n`
  code += compiledComponents.map(entry => entry.code).join('\n')
  for (const entry of compiledComponents) {
    for (const name of entry.refNames) code += `__nuxtStateBindings[${JSON.stringify(`${entry.prefix}_${name}`)}] = function(value) { ${entry.prefix}.${name}.value = value; };\n`
    code += `__nuxtMounted.push(function() { ${entry.prefix}_runMounted(); });\n__nuxtUnmounted.push(function() { ${entry.prefix}_runUnmounted(); __nuxtDisposeScope('${entry.prefix}'); });\n`
  }
  for (const action of inlineActions) {
    if (!action || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(action.name) || typeof action.expression !== 'string') continue
    code += `function ${action.name}($event) { return (${action.expression}); }\n`
  }
  const pageStateRefs = [...new Set([...stateRefs, ...keyedStateRefs, ...destructuredStateRefs])]
  const snapshotBindings = topLevelBindingNames(setupBody)
  const componentStateRefs = compiledComponents.flatMap(entry => entry.refNames.map(name => ({ key: `${entry.prefix}_${name}`, expression: `${entry.prefix}.${name}.value` })))
  const componentBindings = compiledComponents.flatMap(entry => entry.bindingNames
    .filter(name => !entry.refNames.includes(name))
    .map(name => ({ key: `${entry.prefix}_${name}`, expression: `__nuxtSnapshotValue(${entry.prefix}.${name})` })))
  const allStateRefs = [...new Set([...pageStateRefs, ...componentStateRefs.map(entry => entry.key)])]
  const snapshotEntries = [
    ...pageStateRefs.map(name => `${name}: ${name}.value`),
    ...snapshotBindings.filter(name => !pageStateRefs.includes(name)).map(name => `${JSON.stringify(name)}: __nuxtSnapshotValue(${name})`),
    ...componentStateRefs.map(entry => `${JSON.stringify(entry.key)}: ${entry.expression}`),
    ...componentBindings.map(entry => `${JSON.stringify(entry.key)}: ${entry.expression}`)
  ]
  code += `function __nuxtSnapshotValue(value, seen) { if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value; if (isRef(value)) return __nuxtSnapshotValue(value.value, seen); if (typeof value === 'function' || (value && typeof value.then === 'function')) return undefined; var visited = seen || []; if (visited.indexOf(value) >= 0) return undefined; visited.push(value); if (Array.isArray(value)) { var list = []; for (var i = 0; i < value.length; i++) list.push(__nuxtSnapshotValue(value[i], visited)); return list; } if (typeof value === 'object') { var result = {}; for (var key in value) { var next = __nuxtSnapshotValue(value[key], visited); if (next !== undefined) result[key] = next; } return result; } return undefined; }\n`
  if (snapshotEntries.length) code += `var __nuxtSnapshot = function() { return JSON.stringify({ ${snapshotEntries.join(', ')} }); };\n`
  return {
    code,
    language: setup.language,
    actions: [...new Set([...actions, ...compiledComponents.flatMap(entry => entry.functionNames.map(name => `${entry.prefix}_${name}`)), ...inlineActions.map(action => action?.name).filter(name => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name ?? ''))])],
    stateRefs: allStateRefs,
    diagnostics: autoImportResult.diagnostics
  }
}
