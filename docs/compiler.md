# Compiler

The compiler entry point is `src/compiler.mjs`.

## Pipeline

1. Vue's template AST parser reads the contents of a `<template>` block.
2. Supported elements are mapped to platform-neutral native node types.
3. Attributes and Vue directives are preserved as runtime props.
4. Tailwind-like classes are converted into native style declarations.
5. Unsupported utilities are returned as diagnostics.
6. Layout `<slot />` nodes are composed with the page IR when the selected layout exists; `definePageMeta({ layout: 'name' })` selects `app/layouts/name.vue`, while `layout: false` opts a page out of layout composition.
7. The resulting IR is consumed by a platform renderer.

The generator also resolves the application shell: `NuxtPage` and `NuxtLayout` hosts inside `app/app.vue` are replaced with the generated page and layout IR before assets are written. The native runtime therefore receives no unresolved application-shell outlet for the normal generated route path.

The public `nuxt-native build` command accepts a project root and an asset output directory. If omitted, they resolve once from the current working directory and `<project-root>/android/app/src/main/assets`; all app, server, component, middleware, plugin, and shared-directory discovery uses those resolved paths. Both Nuxt 4-style `app/*` locations and Nuxt's established root-level `pages/`, `components/`, `composables/`, `utils/`, `layouts/`, `middleware/`, `plugins/`, and `app.vue` locations are accepted. A project can therefore be generated from outside its root without hard-coded repository-relative assumptions. `generate:fixtures` remains the lower-level generator entry point.

The same generation pass reads optional `nuxt-native.config.json`, emits `native-config.json`, and updates the configured Android manifest permission block. Capability names are runtime policy, while the permissions list is an explicit host contract. Set `android.manifest` to `false` when manifest ownership belongs to another build system.

Structural Vue controls are represented explicitly in the IR rather than erased: `v-if`/`v-else-if`/`v-else` become `conditional` branches and `v-for` becomes a `for` node containing the source expression, loop bindings, and optional `track` key expression from `:key`. This keeps control flow available to native renderers without introducing an HTML runtime.

Common semantic HTML is accepted in strict mode and lowered to native equivalents: text semantics (`blockquote`, `code`, `time`, `mark`, and related inline tags), document structure (`figure`, `figcaption`, `dl`, `details`, and `summary`), separators (`hr`), and table sections/rows/cells. Tables render as native vertical sections with horizontal row layouts; they are not browser table engines, so CSS table layout behavior is intentionally not implied.

Nuxt control components also receive explicit IR nodes. `ClientOnly` preserves its content, `Suspense` stores default and `#fallback` children, `NuxtErrorBoundary` stores default and `#error`/`#fallback` children, and `Teleport` becomes a `portal` node for the platform renderer.

Page `<script setup>` is compiled separately by `src/script-compiler.mjs`. TypeScript and JavaScript are lowered with esbuild into a QuickJS-compatible route script, alongside a manifest of page actions and ref state names. Project-resolvable npm imports are bundled into that asset, including their transitive JavaScript dependencies; browser-only or native-module dependencies remain outside the supported runtime contract.

Top-level setup bindings are also included in the native runtime snapshot when they are serializable. This preserves familiar template expressions such as `device ? 'Available' : 'Unavailable'` for values returned by native composables, while functions, Promises, and circular references are omitted from the snapshot. Reactive refs keep their existing unwrapped state behavior.

The fixture generator also reads JavaScript/TypeScript modules from `app/composables`, `app/utils`, and `shared/utils`. Their referenced exports are lowered into the route bundle before page setup, providing Nuxt-style convention auto-imports without requiring Web APIs or a browser module loader at runtime; unreferenced modules are omitted and helper dependencies are retained transitively. Page setup may also use relative or project-alias (`~/...` and `@/...`) JavaScript/TypeScript imports; those local modules are bundled into the native route script, while framework imports remain supplied by the generated runtime. If two discovered modules declare the same auto-import symbol, generation fails with an `AUTO_IMPORT_COLLISION` diagnostic that identifies both files.

Server utility exports from `server/utils` are injected into embedded route and server-middleware assets. When a utility imports another project-local JavaScript/TypeScript module, the server compiler bundles that relative dependency before the asset is evaluated by QuickJS; duplicate server utility exports are rejected during generation.

Server files under `server/middleware` are compiled as request middleware rather than API routes. Their assets are indexed separately so the embedded native server can run them against one request event before dispatching the method-specific handler.

Files under `server/plugins` are compiled into `server-plugins.json`. Their function- or object-style `defineNitroPlugin()` handlers initialize inside each embedded request context and can register `request`, `beforeResponse`, and `afterResponse` hooks through `nitroApp.hooks.hook(...)`.

Server filenames use the same bracket convention as Nuxt pages: `server/api/posts/[id].get.ts` becomes `GET /api/posts/:id`, `[...path]` becomes a catch-all, and `[[id]]` becomes optional. The native server ranks static matches above dynamic matches and exposes decoded values through `event.params`.

Server `async`/`await` is lowered to a generator-compatible form and executed through the embedded Promise continuation queue. The native host drains nested continuations before serializing the response, so ordinary async handlers can use synchronous request helpers such as `readBody()` without being silently rewritten into a different function.

## Example

```vue
<button class="rounded-xl bg-blue-600 px-4 py-3 text-white" @click="save">
  Save
</button>
```

Conceptually becomes:

```json
{
  "type": "button",
  "tag": "button",
  "props": { "class": "...", "@click": "save" },
  "style": {
    "borderRadius": 12,
    "backgroundColor": "#2563eb",
    "paddingHorizontal": 16,
    "paddingVertical": 12,
    "color": "#ffffff"
  }
}
```

## Compatibility policy

The compiler supports a deliberate native subset rather than pretending all web HTML and CSS are identical to Android. Every new mapping should include:

- a compiler implementation;
- a renderer mapping;
- a test;
- documentation explaining platform differences.

Native interaction variants `hover:`, `focus:`, `active:`, `pressed:`, `selected:`, and `disabled:` compile to Android state-aware backgrounds and text colors. `active:` is normalized to the Android pressed state. Responsive variants `sm:`, `md:`, `lg:`, `xl:`, and `2xl:` select static native style overrides from the available screen width, while `dark:` and `light:` select overrides from the Android system theme. One responsive or theme variant can compose with one interaction variant, so classes such as `md:hover:bg-blue-600` and `dark:disabled:opacity-50` retain their native state behavior. Longer or ambiguous chains are diagnosed instead of silently disappearing. Variant declarations should therefore prefer color, typography, opacity, and other properties with direct native view equivalents.

Common form tags are mapped to native controls: text inputs and textareas use `EditText` (with multiline, password, email, URL, telephone, numeric, search, row-count, maximum-length, readonly, change-event, focus, blur, keyboard-event, and key-modifier behavior), checkbox/radio/switch inputs use Android `CompoundButton` controls, range inputs use `SeekBar`, and `select`/`option` use `Spinner` data. Selects also use the shared native prop, accessibility, and dynamic-style pipeline, so disabled state and reactive bindings are not lost on the specialized renderer path. Static and bound disabled states are applied to the native control. Required text and toggle controls are checked before a native form dispatches its submit action, including format validation for required email inputs; non-empty fields also honor `minlength` and `pattern`. Flex-row/column and flex weights are carried into native `LinearLayout` orientation and layout parameters.

`form` remains a native container with Vue-shaped submission semantics. A button whose `type` is `submit` finds its nearest compiled form and dispatches the form's `@submit` or `@submit.prevent` action; a button may also keep its own `@click` action, which runs before submission. The renderer does not create browser default navigation or reload behavior.

Image `src`/`alt` and anchor `href` attributes are preserved in the IR for the native renderer; internal hrefs are navigation actions rather than browser document links.

## Colors

Color utilities are resolved in this order:

1. built-in tokens such as `blue-600`;
2. project tokens supplied through the compiler theme, including nested values such as `brand.primary` → `brand-primary`;
3. arbitrary values such as `bg-[#316ff6]`, `text-[rgb(49_111_246)]`, `text-[22px]`, and rem dimensions such as `w-[15rem]`;
4. opacity modifiers such as `bg-brand/50`.

Native linear gradients are also supported with Tailwind-shaped utilities such as `bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700`. Directions map to Android `GradientDrawable` orientations; `via-*` is optional, and arbitrary/theme colors work in the same `from-*`/`via-*`/`to-*` positions.

The compiler accepts a theme object so the framework does not need to hardcode an application's palette:

```js
compileTemplate(source, {
  theme: {
    colors: {
      brand: {
        primary: '#123456'
      }
    }
  }
})
```

This follows Tailwind's theme and arbitrary-value model. The native renderer normalizes resolved values into Android view properties; platform-specific color and layout conversion remains inside the renderer rather than the Vue compiler.

Shape utilities are normalized for native properties as well: `rounded-full` becomes a large numeric radius so Android can render pill-shaped controls without receiving browser-only symbolic values.

Native buttons preserve authored casing instead of applying Android's legacy all-caps default, and native text views disable extra font padding so Tailwind-like spacing remains predictable. The Android renderer honors the standard Tailwind spacing scale (`0` through `96`) for generic `p-*`/`m-*`, axis and side-specific utilities, negative margin utilities such as `-mt-4`, and `space-x-*`/`space-y-*` through native container gaps. `leading-*` uses the same dp scale for predictable native line spacing. Authored card and screen insets remain preserved on-device.

Common surface refinements also map directly to native properties: `shadow-xl`/`shadow-2xl` use Android elevation, `ring-*` uses a native border drawable, `tracking-*` uses `TextView` letter spacing, and `object-contain`/`object-cover`/`object-fill`/`object-none` select the corresponding `ImageView` scale behavior.

`overflow-auto`, `overflow-y-auto`, and `overflow-y-scroll` on ordinary containers create a nested native vertical `ScrollView`; `overflow-x-auto` and `overflow-x-scroll` create a native `HorizontalScrollView` whose children are measured as a horizontal content row. For a `flex-row`, generic `overflow-auto` follows the row axis and selects the horizontal surface. Panels, chip rows, and wide tables can therefore own their own scroll surface. The root screen remains scrollable independently.

Positioning utilities `relative`, `absolute`, `inset-*`, `inset-x-*`, `inset-y-*`, `top-*`, `right-*`, `bottom-*`, `left-*`, and `z-*` use a native `FrameLayout` when a relative container owns positioned children. Axis insets also constrain the positioned child to fill that axis, and `overflow-hidden` clips child drawing through the native `ViewGroup` boundary. Ordinary containers remain vertical or flow layouts; browser stacking and percentage positioning are not implied.

Container gaps follow the layout axis in the Android renderer. `gap-*` adds bottom spacing to column containers and right spacing to `flex-row` containers, keeping native cards and action groups separated like their authored Tailwind-like layout.

`flex-row flex-wrap` uses a native flow container that measures children and starts new rows when the available width is exhausted. `grid grid-cols-1` through `grid-cols-12` use the same native flow surface with equal-width cells and row wrapping; `gap-*` is applied between cells. Minimum dimensions are applied to every native view; text views also honor `max-w-*` and `max-h-*` constraints.

Inline `style` attributes are parsed into static IR declarations. `:style` object bindings and `:class` bindings are preserved as runtime binding fields so the Android renderer can update colors, font sizes, and common layout/class properties when route state changes. Native interaction state lists are reapplied after those dynamic updates, so reactive styling does not erase `hover:`, `focus:`, `active:`, or `disabled:` colors.

## Native rendering boundary

The compiler output is not Android source code. It is a platform-neutral IR document. A platform renderer owns the final mapping to Android views, iOS views, or another future target. This keeps the compiler testable and prevents app pages from becoming platform-specific implementations. `nuxt-native.config.json` may define project color tokens under `theme.colors`; the normal build pipeline passes those tokens into compilation and packages them in the IR so static and runtime classes resolve the same custom palette.

Component `<script setup>` supports native-safe lowering of `defineProps()`, `withDefaults()`, `defineEmits()`, `defineSlots()`, `defineExpose()`, `defineOptions()`, and the default or named `defineModel()` macro. Destructured props, aliases, simple defaults (`const { label, count: amount = 0 } = defineProps(...)`), and `withDefaults(defineProps(...), { label: 'Fallback' })` are lowered into the generated component scope as well. An inline destructuring default takes precedence over a `withDefaults()` value. `defineModel({ default: 'Untitled' })` and named model options are honored when no parent value is supplied; `get` and `set` transforms are applied when the model is read or written. Slots are expanded into the native IR at compile time, while `defineSlots()` returns the component's slot metadata object; `defineExpose()` and `defineOptions()` are compile-time-safe no-ops for the flattened native scope. Static component attributes are exposed through the generated props object, and emitted event names resolve to the parent component's `@event` handler binding through the generated native component scope. A component `v-model` or named `v-model:title` expression is synchronized through the model ref and parent ref, with initial synchronization deferred until route mount so the parent setup has initialized. If an event is emitted during child setup before the flattened parent setup has initialized its handler, delivery is queued until route mount.

Runtime option objects such as `defineProps({ label: { type: String, default: 'Fallback' } })` are preserved. Missing fields receive literal defaults or factory defaults before component setup evaluates, while parent-bound props continue to use the native reactive prop-expression bridge. `defineModel()` options are parsed as balanced calls, so default/get/set factories containing nested parentheses remain intact.

Text interpolations are emitted as expression nodes rather than being evaluated by the compiler. The runtime owns expression evaluation because values can change after the screen is mounted. Native text evaluation supports state variables, property paths, optional chaining (`device?.model`), nullish fallback (`value ?? 'fallback'`), and nested ternary expressions; unsupported JavaScript expressions remain diagnostics/runtime compatibility work rather than being silently treated as HTML.

`v-show` is a non-destructive native visibility binding: the renderer keeps the view mounted and switches its Android visibility between `VISIBLE` and `GONE` as the expression changes. HTML `hidden`, `:hidden`, and object-bound `hidden` use the same native visibility boundary. Use `v-if` when the subtree should be created and removed instead.

The `generate:ir` command writes this IR for a target renderer. `generate:fixtures` scans `app/pages`, generates one IR and script bundle per route, and clears only previously generated route/manifest files so stale pages cannot remain in the APK. The `examples/` directory is reference material rather than the application route source.

The same generation pass discovers `app/middleware/`. Middleware files are lowered into isolated JavaScript guard assets under `assets/middleware/`; `*.global.ts` files are attached to every route, while named middleware is attached when a page uses `definePageMeta({ middleware: [...] })`. The generated `routes.json` and `middleware.json` manifests keep this relationship explicit for the native router. Discovered components expand default and named slots during IR generation, bound text props remain expression nodes for the native state renderer, and component `<script setup>` blocks are emitted into the page script bundle with instance-scoped ref/action names. Bound component props such as `:label="parentLabel"` are evaluated after page setup and passed into child `defineProps()` scope with ref values unwrapped, so parent handlers and reactive values are available during child setup; dynamic props are exposed through getters so later parent-ref changes remain visible to child `props` reads. Dynamic `<component :is="selector">` nodes contain one compiled native variant per discovered component; the renderer resolves the selector from a literal or route state value and remounts the dynamic subtree when it changes.

The Android renderer evaluates the supported control expressions against the route state snapshot. State snapshots are applied after script setup executes, so initial `ref` values participate in conditional and repeated content; later ref changes reconcile the affected native structural subtree, retaining unchanged branch views and keyed loop items.
