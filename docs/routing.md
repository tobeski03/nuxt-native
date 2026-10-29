# Routing

Nuxt-native uses Nuxt-style file-based routing. The route manifest is generated from `app/pages/` and consumed by the native router.

## File-to-route mapping

```text
app/pages/index.vue              → /
app/pages/settings.vue           → /settings
app/pages/posts/[id].vue         → /posts/:id
app/pages/docs/[...path].vue     → /docs/*path
```

Static routes take precedence over dynamic routes. For example, `/posts/new` wins over `/posts/[id]`.

## Navigation API

The runtime contract is:

```ts
const route = useRoute()
const router = useRouter()

route.params.id
await navigateTo('/settings')
router.back()
router.forward()
router.go(-2)
```

These APIs are injected into every generated page script. `useRoute()` returns one stable route object per runtime; its `path`, `fullPath`, decoded dynamic `params`, decoded `query`, `hash`, `name`, and `meta` fields read the active native route snapshot when accessed, so long-lived app and layout bindings do not retain an obsolete route object. `navigateTo()` and `useRouter()` dispatch through the Android router bridge. `router.go(n)` traverses native history through one guarded delta transaction. Repeated query keys become arrays. Navigation requested during a page action is queued until that JS invocation finishes, then applied on Android's main thread so replacing a route cannot deadlock the JS worker.

`<NuxtLink to="/settings">Settings</NuxtLink>` resolves to a native navigation action without requiring an application-specific click handler. Reactive `:to` and `:href` bindings are evaluated at click time, so a destination derived from route or page state stays current. `NuxtPage` hosts the active screen, while Android back gestures and buttons call `router.back()`.

`definePageMeta()` is accepted during page setup compilation and remains available for route metadata expansion. `useRuntimeConfig()` reads the public portion of `runtimeConfig` from `nuxt-native.config.json`; private or server-only keys are intentionally not bundled into the APK.

```json
{
  "runtimeConfig": {
    "public": {
      "apiBase": "https://api.example.test",
      "releaseChannel": "beta"
    },
    "privateToken": "server-only"
  }
}
```

The bundled runtime exposes `{ public: { ... } }` to pages, plugins, middleware, and embedded server handlers. Treat public values as shipped application data, not secrets.

## Route middleware

Files under `app/middleware/` are compiled into native guard assets. A file named `auth.global.ts` runs for every route; a named guard such as `auth.ts` runs when listed in page metadata:

```ts
// app/middleware/auth.ts
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/private') return navigateTo('/login')
})
```

```ts
definePageMeta({ middleware: ['auth'] })
```

Guards run before the native screen is replaced. Returning `navigateTo()` redirects through the same guard pipeline, while returning `false` aborts the transition. Middleware may return a Promise and await `$fetch()` or other bridged native work; middleware files execute in their own isolated runtime. Redirect loops are capped by the native host.

Routes with no page-scoped guards use the synchronous guard path, so ordinary navigation commits immediately. The async continuation bridge is reserved for guards that actually return a Promise.

Page-scoped guards are also available:

```ts
onBeforeRouteLeave((to, from) => {
  if (form.value.dirty && to.path !== from.path) return false
})

onBeforeRouteUpdate((to) => {
  if (!to.params.id) return '/posts'
})
```

These guards run in the active page runtime before the native view is replaced. They may return `false`, a path, `navigateTo(path)`, or a Promise resolving to one of those values. While a guard Promise is pending, native history and the destination screen remain unchanged; the route loading indicator can remain visible. Rejected guard Promises abort the transition safely.

## Native behavior

- Route transitions replace the active screen host.
- The history stack is separate from the Android process, but synchronized with it.
- Deep links resolve through the same route manifest, including static, dynamic, optional, and catch-all path patterns. Configure Android intent filters in `nuxt-native.config.json`:

```json
{
  "android": {
    "deepLinks": [
      { "scheme": "myapp", "host": "open", "pathPrefix": "/" }
    ]
  }
}
```

The generated activity uses `singleTop`; cold-start and new-intent URLs both enter the native router with their path, query, and hash.
- Back navigation returns to the previous route and restores route state where possible.
- Layout and middleware metadata attach to route records rather than individual Android activities.

The current implementation provides route discovery, matching, parameters, ranking, in-memory history, generated route IR assets, application-shell/layout composition, a native screen host, and Android back-stack integration. `npm run generate:fixtures` scans `app/pages`, resolves `app/app.vue`/layouts, generates the route manifest and IR assets, and packages page scripts alongside them. The sample app demonstrates `/` and `/settings` as separate generated screens; `examples/` remains reference material only.
## Navigation transactions

Every `push`, `replace`, `back`, `forward`, and `go` request creates a navigation
transaction. Page guards and route middleware may await embedded `$fetch()` or
native Promises, but only the newest transaction is allowed to redirect, abort,
mount a route, update history, or clear the loading state. A stale completion
is discarded after a newer request begins. This mirrors the cancellation
expectation of a browser router without allowing an old native callback to
replace the current Android view.

Navigation helpers accept either a string path or a Nuxt-shaped route-location object:

```ts
await navigateTo({ path: '/settings', query: { compact: true }, hash: 'preferences' })
const router = useRouter()
router.push({ path: '/users', query: { tag: ['native', 'nuxt'] } })
```

The native router receives the normalized path (`/settings?compact=true#preferences`); query values are URI encoded and array values are repeated. Named locations are also resolved from the generated route manifest: `navigateTo({ name: 'profile-id', params: { id: '42' }, query: { tab: 'activity' } })` expands the route pattern before native navigation, preserving query arrays and hash fragments. Unknown names are converted to an invalid native path so the route-not-found boundary can handle them; only a location with no usable path or name falls back to `/`. Malformed required params remain visible in the resulting path and are rejected by the native route matcher.

