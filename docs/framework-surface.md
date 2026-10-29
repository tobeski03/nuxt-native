# Framework surface

Nuxt-native is a framework, not an Android app template. The profile page is only a fixture used to exercise the framework.

## Project contract

Nuxt-native follows the Nuxt 4-style separation:

```text
app/
├── app.vue
├── pages/       file-based routes
├── components/  auto-imported components
├── composables/ auto-imported stateful helpers
├── layouts/     reusable page shells
├── middleware/  navigation guards
├── plugins/     runtime initialization
└── utils/       client utilities

server/
├── api/         Nitro API handlers
├── routes/      server-rendered routes
├── middleware/  server request middleware
├── plugins/     Nitro initialization
└── utils/       server-only utilities

shared/
├── types/       safe in both targets
└── utils/       safe in both targets
```

`public/` contains unprocessed assets. `modules/` is reserved for framework extensions. The generator accepts both Nuxt 4-style `app/` directories and the established Nuxt root directories: `app/pages` or `pages`, `app/components` or `components`, `app/composables` or `composables`, `app/utils` or `utils`, `app/layouts` or `layouts`, `app/middleware` or `middleware`, `app/plugins` or `plugins`, and `app.vue` or `app/app.vue`. If both forms define the same route, component, layout, or shell, generation fails deterministically instead of silently choosing one. Files under `examples/` are reference fixtures and are not used to define the app route manifest.

`NuxtIsland` is a native island boundary. Since the packaged app does not hydrate server HTML, its default slot is rendered directly from the native route asset; an explicit `#fallback` slot is retained for an island with no packaged content.

Dynamic text expressions support nested conditional branches, so familiar Vue
labels such as `saving ? 'Saving...' : saved ? 'Saved' : 'Save'` remain native
and reactive instead of requiring a flattened component-specific workaround.

Reactive `v-model` selects synchronize both the native selected index and the
visible selected label after state refreshes, including when setup code changes
the model during `onMounted()`.

Native text controls preserve familiar HTML input attributes: `type` values for
password, email, URL, telephone, numeric, and search inputs select the matching
Android keyboard behavior; `textarea rows`, `maxlength`, and static or reactive
disabled state are applied by the renderer. Required text and toggle controls
are checked before `@submit` dispatches, with the first invalid native control
focused and marked with an Android error indicator. Required email fields also
reject malformed addresses before the submit action runs. `readonly` fields remain
visible but are not editable, and text `@change` handlers run when focus leaves
the field with the final value. Native `@focus` and `@blur` handlers receive the
same `{ type, value }` event shape.
Text controls also support `@keydown` and `@keyup`; their native payload adds
`keyCode`, `key`, and `repeat` while returning `false` to preserve Android's
normal editing behavior. Key modifiers such as `.enter`, `.escape`, `.tab`,
`.space`, arrow keys, and modifier keys filter dispatch to matching events.

`nuxt-native.config.json` defines the native host contract. `capabilities` is the allowlist consumed by the Android `NativeCapabilityBroker`; `permissions` drives the managed permission block in the configured Android manifest and is also emitted into `native-config.json`. `runtimeConfig.public` is emitted as the public runtime configuration; other runtime config keys stay out of the APK. `appConfig` is the static, non-secret configuration returned by `useAppConfig()`. A conventional root `app.config.ts`, `app.config.js`, or `app.config.mjs` (with `app/app.config.*` accepted as well) is loaded into the same object; values in `nuxt-native.config.json` take precedence when keys overlap. Set `runtimeConfig.public.apiBase` to an HTTP(S) origin to switch native `$fetch()` calls to a deployed backend; leave it absent or empty to keep the embedded server boundary. By default the manifest is `android/app/src/main/AndroidManifest.xml`; set `android.manifest` to another project-relative path or `false` to disable manifest editing. The generated runtime config is loaded before routes, plugins, and middleware execute, so every runtime receives the same project policy.

Project design tokens may be declared under `theme.colors` in `nuxt-native.config.json`. Nested objects are flattened into names such as `brand-primary`, and those tokens are available to both static Tailwind-like classes and reactive `:class` bindings during the normal build.

Functions exported from `server/utils` are convention auto-imported into embedded server routes and server middleware. Relative JavaScript/TypeScript imports are bundled ahead of time. Project-resolvable pure-JavaScript npm imports in page and component setup are bundled as well; browser globals, Node built-ins, and native bindings remain outside the packaged QuickJS boundary. Duplicate exported names fail generation instead of silently shadowing one another.

Server handlers use the familiar `defineEventHandler()` authoring surface and receive Nitro-style request helpers including `readBody`, `readRawBody`, `readValidatedBody`, `getMethod`, `isMethod`, `assertMethod`, `getRequestURL`, `getRequestPath`, `getQuery`, `getValidatedQuery`, `getRouterParam`, `getRouterParams`, `getRequestProtocol`, `getRequestHost`, `getRequestIP`, `getHeader`, `getRequestHeader`, `getRequestHeaders`, `getCookie`, `setHeader`, `setResponseHeaders`, `appendResponseHeader`, `getResponseHeader`, `removeResponseHeader`, `setCookie`, `deleteCookie`, `setResponseStatus`, `getResponseStatus`, `send`, `sendError`, `sendNoContent`, `sendRedirect`, and `createError`. In embedded mode, cookies are app-local request/response metadata carried through the native server bridge; they are not browser `document.cookie` state and do not require a WebView. Multiple response cookies are preserved as repeated `set-cookie` values, and explicit response bodies take precedence over handler return values.

Files under `server/plugins` are compiled into a separate server-plugin manifest. A `defineNitroPlugin()` function or object-style plugin initializes inside each embedded request context and can register `request`, `beforeResponse`, and `afterResponse` hooks with `nitroApp.hooks.hook(...)`. The request callback receives the event before middleware and route dispatch; response hooks receive the event with its serialized native response. Returning `false` from a request hook aborts the request with a native 403 response, and plugin globals cannot leak into another native request.

The same `android` section owns generated app identity: `applicationId`, `label`, `versionCode`, `versionName`, `minSdk`, and `targetSdk`. These values are applied to the generated Gradle host and manifest; the renderer's internal Java package remains framework-owned.

`android.theme` controls generated native colors (`primary`, `background`, `onPrimary`, `onBackground`, and `statusBar`). The generator writes platform resource XML, an adaptive vector launcher icon, and an API 31 splash style. `android.icon` can point to a project-relative PNG, WebP, JPEG, or drawable XML override.

`app/app.vue` or root-level `app.vue` is the application shell. Its `NuxtLayout` and `NuxtPage` hosts are resolved during IR generation, so the selected layout and page become one native view tree rather than runtime HTML wrappers. Shell and layout files may also contain JavaScript or TypeScript `<script setup>` blocks; those blocks are compiled into scoped native runtime instances alongside the page and their template bindings are rewritten to the matching scope. `app/layouts/default.vue` or root-level `layouts/default.vue` is composed around every page when the shell requests `NuxtLayout`; `definePageMeta({ layout: 'name' })` selects the matching layout, and `layout: false` opts a page out. The selected layout's `<slot />` is replaced with the page root before the asset is packaged. An optional `app/error.vue` or root-level `error.vue` is compiled as the native route-error surface and receives the current `error` object as runtime state.

Files under `app/plugins/` are compiled into startup assets and run once before the first route. Both function-style and object-style `defineNuxtPlugin()` declarations are supported. A plugin can call `useNativeCapability(name)`, expose serializable values with `nuxtApp.provide(key, value)`, register `nuxtApp.hook()` callbacks, and use `nuxtApp.callHook()` for local dispatch. A plugin may declare `capabilities: ['device', 'storage']`; `nuxtApp.capabilities` and `nuxtApp.hasCapability()` expose only the intersection of that declaration and the host grants. Lifecycle hooks named `app:mounted`, `app:state`, and `app:dispose` are delivered by the native host; `nuxtApp.onDispose()` and disposer functions returned from `setup` are called in reverse registration order, and registered hooks are removed during disposal. Page scripts read provided values as `$key` properties from `useNuxtApp()`. The native host grants an explicit capability allowlist; `core`, `network`, and the non-sensitive `dialog` bridge are available by default, while device, storage, notifications, media, sensors, filesystem, and permissions remain opt-in. Plugin code does not receive arbitrary Android objects.

Nuxt state and metadata composables remain available alongside the native services: `useState(key, init)` returns a keyed ref shared by all consumers in the active route runtime, included in native state snapshots, and persisted under a reserved app-scoped storage key when the `storage` capability is available. It falls back to memory when storage is unavailable. `useCookie(name, options)` returns a persistent ref backed by app-scoped Android `SharedPreferences`. `useCookie()` supports a `default` value or factory, removes the stored value when set to `null`/`undefined`, and falls back to memory when storage is unavailable. It is intentionally a native persistence primitive rather than a browser `document.cookie` jar: there is no WebView, browser cookie domain, or HTTP cookie header behavior. `useHead()` and `useSeoMeta()` forward serializable metadata such as `title` to the native activity. The first framework-owned Android service composables are `useNativeDevice()` and `useNativeStorage()`. The former returns serializable model, manufacturer, Android version/SDK, and package metadata when the `device` capability is available. The latter exposes `available`, `get(key, fallback)`, `set(key, value)`, and `remove(key)` over app-scoped Android `SharedPreferences` when `storage` is available. Both APIs degrade safely when a host does not grant the capability, so application code can branch with `useNativeCapability()` instead of importing Android classes. The Android host owns these grants through one `NativeCapabilityBroker`, not through per-page or per-service lists.

`useNativeClipboard()` exposes `available`, `readText(fallback)`, and `writeText(value)` through Android's `ClipboardManager` when the `clipboard` capability is granted. It degrades to the supplied fallback or `false` when unavailable.

`useNativePermissions()` is the corresponding permission boundary. It exposes `available`, `has(permission)`, and `request(permission)`. `request()` returns a Promise that resolves after Android's permission dialog result is delivered to the active route runtime. Permissions listed in `nuxt-native.config.json` are written to the generator-managed manifest block; hosts that set `android.manifest` to `false` remain responsible for declaring them.

`useNativeFileSystem()` exposes `available`, `readText(path, fallback)`, `writeText(path, value)`, `exists(path)`, `remove(path)`, and `list(path)`. Paths are rooted in Android's app-private `filesDir`; traversal outside that directory is rejected. This API is intentionally text-oriented at the framework boundary so JSON, config, and cached document data can be handled without exposing Java `File` objects to JavaScript. Use `useCookie()` for small app preferences and session-like values; use this filesystem composable for larger text documents or cache files.

`useAsyncData(key, handler)` shares its `data`, `pending`, `error`, and `refresh` object with later calls using the same key in the same route runtime. Component calls are namespaced by component scope, so two component instances do not accidentally share request state. This is an in-runtime dedupe/cache boundary; it does not persist server data across app launches.

Component-scoped `useAsyncData()` forwards the same options object as page setup, so `default`, `transform`, `pick`, and `immediate` behave consistently while the generated component scope still isolates the cache key.

Watchers and `watchEffect()` registrations created during component setup are owned by that component scope and are disposed when the native component subtree unmounts. This prevents component-local reactive callbacks, including watchers created by component async-data and model helpers, from continuing to observe route state after teardown. App-lifecycle listeners and sensor subscriptions started by a component are disposed through the same boundary.

`watchEffect()` tracks generated refs read during its callback, reruns when those refs change, and returns a cleanup function that detaches the effect.

`effectScope()` creates an explicit reactive ownership boundary, `getCurrentScope()` reports the active component/effect scope, and `onScopeDispose()` registers cleanup in that boundary. Non-detached scopes created during component setup are linked to the component unmount lifecycle.

`watch()` accepts Vue-shaped `immediate`, `deep`, `once`, and `flush` options. The default and `flush: 'sync'` callbacks run during the native state notification; `flush: 'pre'` callbacks are coalesced into the pre-flush queue, while `flush: 'post'` callbacks use the post-flush queue. `onWatcherCleanup()` can register cleanup from inside an active `watch()` or `watchEffect()` callback. `queuePreFlushCb()`, `queueJob()`, `queuePostFlushCb()`, and `flushPostFlushCbs()` expose the same scheduler boundary to compatible libraries; pre-flush callbacks run first, post-flush callbacks run after main jobs, and post-flush callbacks can enqueue a following main-job turn. `watchSyncEffect()` and `watchPostEffect()` provide the corresponding effect timing helpers.

`useError()` returns the route runtime's error ref. `showError(value)` normalizes a string or error-like object and transfers it to the native error surface with status metadata; `clearError()` retries the last requested route after clearing the error state.

The same dependency tracking applies to properties read from `reactive()` and `shallowReactive()` objects, including property assignment and deletion.

`reactive()` proxies nested objects deeply and caches their proxies, so nested reads remain trackable. `shallowReactive()` only tracks assignment of its root properties and leaves nested values raw.

`watch()` accepts a ref, getter, or array of sources, returns a stop function, and supports `{ immediate: true }` and `{ once: true }`. Array values are compared element-by-element so unrelated ref changes do not trigger the callback.

`computed()` accepts either a getter function or `{ get, set }`; both return ref-compatible values, and writable computed setters forward assignments to their source state.

Computed getters are lazy and cached until a tracked dependency changes, then invalidate and recompute on the next read. `readonly()` wraps nested objects with stable cached proxies and ignores writes/deletions, while `shallowReactive()` intentionally observes only top-level property replacement.

`provide(key, value)` and `inject(key, fallback?)` share serializable or reactive values across the page, layout, and bundled component setup scopes for the active route runtime. Missing injections use a value or factory fallback; the registry is discarded with the route runtime.

Lifecycle setup supports `onBeforeMount`, `onMounted`, `onBeforeUnmount`, and `onUnmounted`. Before hooks run around the native route commit/teardown, while component hooks are kept within the component's generated lifecycle scope.

The `watch` option accepts one reactive source or an array of sources. Changing any watched ref refreshes the async-data record; `useFetch()` forwards the same option so query-dependent native requests can reload from reactive state.

Async-data refreshes are generation-aware: if a newer refresh starts before an older native request settles, the older response is ignored and cannot overwrite the newest record.

`refreshNuxtData(key?)` refreshes one or all cached async-data entries, while `clearNuxtData(key?)` invalidates one or all entries so the next call recreates them. Both helpers are route-runtime scoped and return a Promise-compatible completion value.

`useLazyAsyncData()` and `useLazyFetch()` create the same reactive record without executing its handler/request during setup. The record remains `pending` until `refresh()` or `refreshNuxtData()` is called; this is useful for user-triggered loads because native routes do not need browser SSR hydration.

Async-data options include `default` (value or factory used before resolution), `transform` (a synchronous or Promise-returning result mapper), and `pick` (an array of response keys to retain). They are applied before the `data` ref is updated and work for both `useAsyncData()` and `useFetch()`.

When an async-data handler or fetch fails, its `error` ref contains a serializable object with `message` and any available `status`, `statusMessage`, `data`, and `headers` fields. This preserves server response context for native error screens and retry UI instead of reducing the failure to a string.

`$fetch(url, { query })` and `$fetch(url, { params })` encode object values into the URL before dispatch. Array values become repeated query keys, `null` becomes a key without a value, and existing query strings and hash fragments are preserved. The same normalized URL is used by embedded handlers and remote API forwarding.

`$fetch.create(defaults)` creates a configured client that merges default and per-request options and headers. Relative paths resolve against `baseURL`, and each configured client exposes `.raw()` with the same response metadata behavior as the root fetch helper.

`useNativeNotifications()` exposes `available` and `show(title, body, channelId)`. Android notification channels are created by the host, and Android 13+ notification permission is checked before posting. The method returns `false` when the host capability or permission is unavailable.

`useNativeMedia()` exposes `available`, `pickImage()`, `pickFile(mimeType)`, and `capturePhoto()`. Picker methods open Android's document picker and resolve to a persisted `content://` URI. `capturePhoto()` requires the host to declare and grant `android.permission.CAMERA`, writes through `MediaStore`, and resolves to the resulting image URI. All methods resolve to `null` when canceled or unavailable.

`useNativeDialog()` exposes `available` and `show(options)`. It opens an Android `AlertDialog` with `title`, `message`, `confirmText`, and optional `cancelText`, returning a Promise that resolves to `true` for confirmation and `false` for cancellation or unavailable dialog capability.

`useNativeAppLifecycle()` exposes a reactive `state` ref (`active` or `background`) and `onChange(callback)`. The native activity updates it from Android `onResume`/`onPause`, so pages and plugins can pause work or refresh data when the app returns to the foreground.

Serializable page refs declared by the generated script manifest are restored per route after Android activity or process recreation. This preserves user-entered state without persisting arbitrary runtime objects, pending requests, plugin values, or native view instances.

`useNativeSensors()` exposes `available`, `start(type, callback)`, and `stop(sensorId)`. Supported sensor names are `accelerometer`, `gyroscope`, `magnetometer`, and `rotation`; callbacks receive JSON samples containing `type`, `timestamp`, `values`, and convenience `x`/`y`/`z` fields. Active subscriptions are stopped automatically when the app enters the background.

```vue
<script setup lang="ts">
const device = useNativeDevice()
const storage = useNativeStorage()
const theme = ref(storage.get('theme', 'system'))

function saveTheme() {
  storage.set('theme', theme.value)
}
</script>

<template>
  <section>
    <h1>{{ device?.model ?? 'Native device' }}</h1>
    <p>Android SDK {{ device?.sdkInt ?? 'unknown' }}</p>
    <button @click="saveTheme">Save theme</button>
  </section>
</template>
```

This is compiled into a native view tree and a JavaScript route script; it does not create a browser storage object or a WebView bridge.

Vue files under `app/components` are discovered by name and their templates are expanded into page IR. Nested files use deterministic Nuxt-style names (`forms/Button.vue` becomes `FormsButton`, `forms/index.vue` becomes `Forms`), and duplicate names fail the build instead of silently replacing one component. Static component attributes interpolate into template text, bound text props preserve native state expressions, and default/named slots are expanded into the component tree. A component `<script setup>` block is compiled into the page's embedded JavaScript bundle with instance-scoped ref and async-composable keys plus namespaced actions, so component state and handlers remain JavaScript state while the view remains native. `defineProps()`, `withDefaults()`, `defineEmits()`, `defineSlots()`, `defineExpose()`, `defineOptions()`, and default `defineModel()` are lowered into the component scope; a component used with `v-model` synchronizes its model ref with the parent expression. `<component :is="...">` compiles the discovered component set into native variants; the Android renderer selects the matching variant and remounts that subtree when the selector changes. Page templates also support native `v-if`/`v-else-if`/`v-else` branches and `v-for` loops over route state.

## Built-in components

These are framework primitives, not user components:

| Component | Native responsibility |
|---|---|
| `NuxtPage` | Hosts the active route screen |
| `NuxtLayout` | Hosts the active layout shell |
| `Head` / `Title` / `Meta` / `Link` | Applies route metadata; `Title` updates the native Android activity title and metadata nodes remain non-visual |
| `NuxtLink` | Performs native navigation/deep-link handling without app-specific handlers |
| `NuxtImg` / `NuxtPicture` | Load packaged, content, data, or remote sources into a native `ImageView` |
| `NuxtRouteAnnouncer` | Announces route changes through an Android polite accessibility live region |
| `NuxtLoadingIndicator` | Shows route/data loading state |
| `ClientOnly` | Defers a subtree until the client runtime exists |
| `NuxtClientFallback` | Uses the same client-only native fallback boundary; no browser hydration is required |
| `NuxtErrorBoundary` | Catches and renders component errors |
| `KeepAlive` | Retains a compiled native subtree while its parent branch changes |
| `Teleport` | Places content in a native portal/overlay host |
| `Suspense` | Coordinates async component state |

Their names and Vue-facing behavior should remain familiar. Their render targets are native Android primitives.

`NuxtRouteAnnouncer` renders a native `TextView` with a polite accessibility live region and announces the normalized route path after each native route render.

The Android renderer maps `NuxtLoadingIndicator` to a native `ProgressBar` whose visibility follows either the route's internal navigation-pending state or an active page `pending` ref. `ClientOnly` renders its children directly because the native host is already the client. `Teleport` mounts its children in a route-owned full-screen native overlay layer; `to` identifies the requested portal target for future host-specific layers, while `disabled` keeps the content inline. The overlay is removed with the route. `Suspense` switches to its `#fallback` slot while a pending state is active, then remounts its content when that state resolves. `NuxtErrorBoundary` catches render-time native subtree failures and renders its `#error` fallback when supplied; `KeepAlive` caches the native view associated with its IR node and reuses it when structural reconciliation revisits that subtree. Route and page-action failures still enter the framework-owned native error screen with a retry action. Image nodes map to `ImageView`, and static width/height/margin IR values map to native layout parameters.

## Auto-imports

The generator scans `app/composables`, `app/utils`, and `shared/utils` and bundles their JavaScript/TypeScript exports before each page setup block. Pages can call those functions without local import statements, preserving the Nuxt convention. Duplicate exported declarations are rejected with a deterministic `AUTO_IMPORT_COLLISION` diagnostic naming both source files, so file discovery order cannot silently change application behavior. Unreferenced discovered modules are omitted, while helper symbols referenced by selected modules pull in their transitive auto-import dependencies.

## Compatibility rule

Every framework primitive needs four things before it is considered supported:

1. an authoring contract;
2. a compiler/IR representation;
3. a native runtime implementation;
4. tests and documentation.

No page fixture should define behavior that belongs in the framework layer.

## Styling contract

The framework must not require users to choose from a fixed color list. The standard Tailwind color palette is available across slate, gray, zinc, neutral, stone, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, and rose shades; theme tokens, arbitrary values, and runtime inline values are separate supported inputs. Static values are compiled ahead of time; values arriving from application state remain runtime style bindings. Native interaction variants (`hover:`, `focus:`, `active:`, `pressed:`, `selected:`, and `disabled:`) use Android state-aware drawables/color lists for interactive color and border styling.

Native animation utilities `animate-fade-in`, `animate-slide-up`, and `animate-scale-in` compile to Android `ViewPropertyAnimator` transitions. They animate when a view is created or a structural branch is mounted; they do not emulate browser CSS keyframes. Native typography and surface utilities such as `text-center`, `italic`, `uppercase`, `underline`, `border-2`, theme border colors, `shadow-lg`/`shadow-xl`/`shadow-2xl`, `ring-*`, `tracking-*`, `object-cover`, `opacity-75`, and linear gradients (`bg-gradient-to-*` with `from-*`, optional `via-*`, and `to-*`) map to Android text, drawable, elevation, image-scale, and alpha properties rather than being discarded after compilation. Responsive `sm:`/`md:`/`lg:`/`xl:`/`2xl:` classes and `dark:`/`light:` classes are resolved natively from the Android screen configuration and system theme; one responsive/theme variant can compose with one interaction variant such as `md:hover:*`.

`relative` containers with `absolute` children use a native `FrameLayout`; edge insets and z-order are applied as Android layout parameters. Axis insets fill the corresponding native axis, and `overflow-hidden` clips child drawing at the container boundary. This supports badges, overlays, and anchored controls without introducing a browser document or CSS positioning engine.

`overflow-auto`, `overflow-y-auto`, and `overflow-y-scroll` create nested native vertical scroll surfaces for ordinary containers; `overflow-x-auto` and `overflow-x-scroll` use native horizontal scroll surfaces. Reusable panels, chip rows, and wide tables can scroll independently inside the page.

`<Transition name="fade|slide|scale" duration="220" easing="standard|linear|ease-in|ease-out" @before-enter="..." @after-enter="...">` is the declarative Nuxt-shaped form for structural transitions. Its child branch is rendered natively and animated when mounted or replaced; duration is in milliseconds, easing selects the Android interpolator, and lifecycle actions run before and after the enter animation.

Native form controls retain the familiar HTML/Vue authoring surface while mapping to Android widgets: `textarea` is multiline, checkbox/radio/switch controls write boolean `v-model` values, checkbox groups can bind to arrays, radio controls write their `value`, nested writable paths such as `profile.name` are supported, range inputs map to `SeekBar` with integer `min`/`max`/`step`, and `select` maps to `Spinner` with state-driven initial and updated selection. `v-model.trim` trims text before updating reactive state, `v-model.number` sends parseable numeric input across the native bridge as a JavaScript number and preserves non-numeric text as entered, and `v-model.lazy` commits editable text when focus leaves the native field. `ul` and `ol` render as vertically scrolling native lists, including structural `v-for` updates. Layout utilities such as `flex-row`, `flex-col`, `items-center`, `items-stretch`, `justify-center`, `justify-evenly`, `flex-1`, `grow`, and `shrink-0` map to native orientation, cross-axis gravity, and child weights rather than creating CSS boxes. `grid grid-cols-1` through `grid-cols-12` map to equal-width native cells with row wrapping and gap spacing.

Semantic HTML text and table elements are also supported. They map to native `TextView`, `LinearLayout`, and divider primitives; table rows are horizontal native layouts and table sections are vertical groups, so browser-specific table sizing and CSS layout algorithms are not reproduced.

The mounted route `screen` root is a native vertical `ScrollView` with a full-width content column. Nested layout/page `<main>` elements remain ordinary native containers, avoiding fragile nested scrolling while allowing page content to exceed the device viewport without an application-specific scroll wrapper; explicit nested list and scroll containers remain supported where a page needs them.

Form controls also support Vue-shaped `@input` and `@change` handlers. Native handlers receive `{ type, value }`; `@input` fires while editable/range values change, and `@change` fires when a selection, toggle, or range interaction commits. Method references and inline expressions such as `@click="count++"` and `@change="save($event)"` are lowered into declared route actions before the native bridge dispatches them. Common Vue event modifiers such as `.stop` and `.prevent` are accepted on native click, submit, input, change, touch, swipe, and long-press bindings; browser-only propagation/default behavior is naturally absent from the native surface while the handler remains active.

`form` is a native submission boundary. A `button type="submit"` dispatches the nearest form's `@submit` handler, with `@submit.prevent` retaining the familiar Nuxt/Vue authoring form while preventing browser-style navigation because there is no browser document. An explicit button `@click` runs before the form submission action.

Interaction modifiers remain native events: `@click` dispatches a click action on any rendered native view, while `@longpress`/`@long-press`, `@touchstart`, and `@touchend` attach Android long-click and touch listeners to the rendered view. `@swipeleft`, `@swiperight`, `@swipeup`, and `@swipedown` recognize native finger movement using a density-scaled threshold. Touch and swipe handlers receive a native event object with `type`, `x`, `y`, `dx`, and `dy`; ordinary click and long-press handlers remain zero-argument actions.

`useNativeGesture({ left, right, up, down, start, end })` returns a reusable native-event handler. Bind it from a page or component with `@swipeleft="onGesture"` (where `onGesture` is the returned handler); swipe names map to the corresponding composable keys and the native event object is passed through.

Accessibility attributes remain part of the native contract. `aria-label`, `aria-description`, `aria-hidden`, `aria-disabled`, `aria-live`, `role`, `tabindex`, and image `alt` values are applied to Android accessibility properties and node metadata; dynamic `:aria-*` values are refreshed with route state.

`img` maps to `ImageView`; local/content URIs are assigned directly and HTTPS sources load asynchronously with the Android network permission. Internal `<a href="/...">` links dispatch through the native router, while `NuxtLink` continues to use its `to` prop.

Nuxt-style `public/` files are copied into the generated Android assets bundle under `public/`, preserving nested paths and binary contents. An image such as `<img src="/images/logo.png">` is decoded from the packaged asset at runtime; HTTPS sources load asynchronously, `content://`, `file://`, and Android resource URIs are handed to the native image loader, and both base64 and URL-encoded `data:` images are decoded without a browser. Images preserve their aspect ratio by default, and stale asynchronous decodes are discarded when a reactive `src` changes. The generator records managed public files and removes stale copies on rebuild.

Runtime `:class` and `:style` bindings are retained in the IR and refreshed on state changes. Runtime classes support string, array, and object Vue forms (`:class="[baseClass, active && 'bg-blue-600']"` and `:class="{ 'font-bold': active }"`) plus the same common native color, typography, opacity, and flex-direction utilities as the static surface. Object `v-bind="attrs"` forwards native class/style values, accessibility attributes, disabled state, input placeholder/value, and image source values from a reactive object. The generated IR carries the complete standard palette and project-defined color tokens to the Android renderer, so reactive classes use the same color vocabulary as static classes; arbitrary runtime colors and inline style values are also accepted when they evaluate to explicit color or numeric values. Dynamic native properties are reconciled against their original static baseline, so switching classes removes stale background, text, opacity, and layout values instead of accumulating them. Browser-only selectors and CSS effects remain outside the native contract.
Native template conditionals use JavaScript-like truthiness for hydrated values: objects and arrays are truthy, numbers follow zero/non-zero behavior, and empty strings are false. This keeps expressions such as `device ? 'Available' : 'Unavailable'` correct when `device` comes from a native composable.
