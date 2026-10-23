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

The project also has a server boundary:

```text
app/       Native client pages, components, and composables
server/    Nitro-compatible server routes
shared/    Types and logic safe to use in both targets
android/   Android renderer and platform integration
```

The client and server may live in one repository and share types, but server-only secrets must never be bundled into the APK.

## Rendering principles

- Common elements such as `button`, `input`, `main`, and `section` map to native nodes.
- Static markup and styles should be compiled ahead of time.
- Dynamic Vue bindings remain expressions in the IR and are evaluated by the runtime.
- Native-only capabilities are exposed through composables or explicit components.
- Unsupported browser behavior should produce diagnostics instead of silently becoming a WebView feature.

## Current status

The compiler spike produces an Android-native IR and the Android module renders the first profile page with real `TextView`, `EditText`, `Button`, and `LinearLayout` instances. The next major layer is generating that Android view tree from the IR rather than maintaining the first page manually in Java.
