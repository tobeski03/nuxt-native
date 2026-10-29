# Architecture

Nuxt-native is designed to preserve Nuxt's authoring model while producing real native Android UI. It is not a WebView wrapper.

## Runtime layers

```text
Nuxt/Vue source
      ↓
Vue template compiler
      ↓
Native UI intermediate representation (IR)
      ↓
Android renderer
      ↓
Android Views / native APIs
```

Page logic runs beside this pipeline in an embedded JavaScript runtime. It can update state and dispatch actions, but it never renders HTML or inserts a WebView.

The project also has a server boundary:

```text
app/       Native client pages, components, and composables
server/    Nitro-compatible server routes
shared/    Types and logic safe to use in both targets
android/   Android renderer and platform integration
```

The client and server may live in one repository and share types. Server-only secrets must never be bundled into the APK. Route source is compiled into a separate server asset set; packaging it for an embedded server is an explicit deployment choice.

## Rendering principles

- Common elements such as `button`, `input`, `main`, and `section` map to native nodes.
- Static markup and styles should be compiled ahead of time.
- Dynamic Vue bindings remain expressions in the IR and are evaluated by the runtime.
- Native-only capabilities are exposed through composables or explicit components.
- Unsupported browser behavior should produce diagnostics instead of silently becoming a WebView feature.

## Framework first

The framework surface is defined in `src/framework/contract.mjs`. It owns the Nuxt-shaped directory contract, built-in components, and auto-import inventory. Application fixtures must consume that contract; they must not invent replacements for `NuxtPage`, `NuxtLayout`, or navigation.

## Current status

The compiler produces Android-native IR assets. The Android module has a generic `NativeRenderer` and `NativeRouter`: route assets are loaded into a native screen host, and real `TextView`, `EditText`, `Button`, and `LinearLayout` instances are created from IR. Page scripts are emitted separately and executed through route-scoped `ScriptRuntime` instances; Nitro-shaped server routes are also compiled into server assets and `server-routes.json`. The activity no longer contains page-specific view trees or action-name branches.
