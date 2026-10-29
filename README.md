# Nuxt-native

Nuxt-native is a Nuxt-shaped framework for building real native Android apps with Vue, JavaScript, and TypeScript. It compiles Vue templates into native Android views rather than rendering the application inside a WebView.

> **MVP status:** Nuxt-native is an early native runtime and compiler release. It is suitable for experiments, prototypes, and framework development; it is not yet a drop-in replacement for all of Nuxt, Vue, Nitro, HTML, or CSS.

Repository: [github.com/tobeski03/nuxt-native](https://github.com/tobeski03/nuxt-native)

## What it does

The core pipeline is:

```text
Vue/Nuxt template -> native UI intermediate representation -> Android renderer
```

The compiler uses Vue's template AST and esbuild to produce a native UI intermediate representation. It supports familiar structural and control elements, nested children, text interpolation, Vue attributes/directives, diagnostics for unsupported utilities, and a Tailwind-like utility subset compiled into platform-neutral style values.

The Android prototype now builds a native APK, loads generated route assets, and executes generated page actions through an embedded JavaScript runtime. It remains an early runtime slice, not a production-ready Nuxt implementation.

The checked-in demo is also the framework showcase: `app/pages/index.vue` demonstrates embedded server data, an object-style Nitro server-plugin request hook, reactive state, native inputs/selects/sliders, a native dialog, notifications, reusable components, supported Tailwind-like visual utilities, deliberate below-the-fold content for native scrolling, and Nuxt-style navigation. `/settings` demonstrates a second route, middleware, lifecycle state, device capability detection, and persistent native storage. It is intentionally written like a small Nuxt app so the generated APK is useful as an end-to-end smoke test as well as a visual demo.

## Installation

Install the CLI in the application that will use it:

```bash
npm install -D nuxt-native
```

Then run it through the local project binary:

```bash
npx nuxt-native init my-native-app
cd my-native-app
npx nuxt-native run .
```

The package also supports a global install with `npm install -g nuxt-native`, but a local dependency is recommended so the project lockfile pins the framework version. The package includes the compiler, Android host template, CLI, and documentation required by the build; it does not include an Android SDK or Gradle installation.

## Quick command reference

```bash
npm test
npm run build
npm run compile:example
npm run generate:fixtures
```

Those commands are for working inside the Nuxt-native framework repository. In an application installed from npm, use the project-local binary through `npx`:

```bash
npx nuxt-native build .
npx nuxt-native dev .
npx nuxt-native run .
npx nuxt-native package . --profile release --format apk
```

`build` is the framework entry point. It discovers the Nuxt-shaped project, compiles pages/components/scripts/server handlers, and writes the native asset manifest:

```bash
npm run build -- <project-root> <android-assets-output>
```

Both arguments are optional; they default to the current directory and `<project-root>/android/app/src/main/assets`. The same command is available as `nuxt-native build` after installing the package locally.

To create a starter project with the standard Nuxt-shaped directories:

```bash
nuxt-native init my-native-app
cd my-native-app
nuxt-native build .
```

`init` creates `app/app.vue`, `app/pages/index.vue`, `nuxt-native.config.json`, a project README, and a generated Android host. It never overwrites an existing file or an unmarked Android directory.

For application development, use the watch command:

```bash
nuxt-native dev .
```

It performs an initial build, then watches `app/`, `server/`, `middleware/`, `plugins/`, `shared/`, conventional `app.config.*` files, and `nuxt-native.config.json`. Changes are debounced and regenerate the native assets automatically. Use `--once` to exercise the same initial-build path in scripts or CI without staying resident.

To generate an independent Android host directory from the checked-in host template, pass `--android-output`:

```bash
nuxt-native build <project-root> --android-output <android-output>
```

The generated host contains the native renderer/runtime and fresh route assets, while build state and machine-specific `local.properties` are excluded. Existing directories are only refreshed when they contain the `.nuxt-native-host.json` marker created by this command. The generated host still requires a configured Android SDK and a Gradle installation or wrapper supplied by the host environment.

The native router also persists validated navigation history in app-private storage and displays a retry screen for startup, route, middleware, plugin, and action failures.

For the complete device loop, use `run`:

```bash
nuxt-native run <project-root> --android-output <android-output> --serial <device-id>
```

It generates the host, writes a local SDK path for the run (without committing it), assembles `app-debug.apk`, installs it with ADB, and launches the native activity. `--gradle` and `--adb` override tool discovery. For a machine-wide one-time setup, set `NUXT_NATIVE_ANDROID_SDK`, `NUXT_NATIVE_ADB`, and `NUXT_NATIVE_GRADLE`; explicit CLI flags still take precedence. Without those overrides, Gradle resolution checks the generated project wrapper, `GRADLE_HOME`, the system `PATH`, and the standard Windows Gradle wrapper cache; Android discovery checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the standard Windows Android SDK location.

Release packaging is explicit:

```bash
nuxt-native package <project-root> --android-output <android-output> --profile release --format apk
nuxt-native package <project-root> --android-output <android-output> --profile release --format aab --require-signing
```

Release signing never stores secrets in project files. Set `NUXT_NATIVE_RELEASE_STORE_FILE`, `NUXT_NATIVE_RELEASE_STORE_PASSWORD`, `NUXT_NATIVE_RELEASE_KEY_ALIAS`, and `NUXT_NATIVE_RELEASE_KEY_PASSWORD` in the build environment. `--require-signing` makes missing signing variables a hard error; without it, release artifacts may be unsigned for inspection or CI staging. Release packaging skips the Android lint-vital tasks so artifact generation is deterministic; run lint separately in CI when required.

`generate:fixtures` accepts optional absolute or relative arguments for a project root and generated asset directory:

```bash
node src/generate-fixtures.mjs <project-root> <android-assets-output>
```

When omitted, the project root is the current working directory and the output defaults to `<project-root>/android/app/src/main/assets`. This keeps path resolution centralized instead of requiring compiler callers to change directories or edit source paths.

The compiler dependency is `@vue/compiler-dom`. If dependencies are not already cached, run `npm install` before the commands above.

`app/pages` or root-level `pages` is the application route source. `generate:fixtures` compiles those pages, their JS/TS setup blocks, and `server/` handlers into Android assets. The checked-in `examples/` files are reference fixtures only.

`nuxt-native.config.json` is the native host contract. Its `capabilities` array controls which native service composables are available at runtime, and its `permissions` array declares the Android permissions needed by those services. The build packages this configuration as `native-config.json` and updates the marked permission block in `android.manifest` (defaulting to `android/app/src/main/AndroidManifest.xml`). Set `android.manifest` to `false` when the host owns manifest generation elsewhere. It does not silently grant capabilities that the project did not request.

Public Nuxt-style runtime configuration belongs under `runtimeConfig.public`:

```json
{
  "runtimeConfig": {
    "public": { "apiBase": "https://api.example.test" },
    "privateToken": "never bundled"
  }
}
```

`useRuntimeConfig()` exposes only the public object in the packaged app. When `public.apiBase` is set, native `$fetch()` forwards requests to that origin; when it is absent, requests use the embedded server packaged in the APK. Do not place secrets in this file expecting APK packaging to protect them.

The same `android` section controls generated identity metadata: `applicationId`, `label`, `versionCode`, `versionName`, `minSdk`, and `targetSdk`. The native Java implementation remains framework-owned, while the installed Android package and user-facing app metadata belong to the project.

Theme and resource options are also project-owned:

```json
{
  "android": {
    "theme": {
      "primary": "#2563EB",
      "background": "#F9FAFB",
      "onPrimary": "#FFFFFF",
      "onBackground": "#111827",
      "statusBar": "#F9FAFB"
    },
    "icon": "public/icon.png"
  }
}
```

Without an icon override, the build generates an adaptive vector launcher icon and an API 31 splash theme. PNG, WebP, JPEG, and Android drawable XML icon overrides are supported.

## How it works

Nuxt-native keeps the Nuxt mental model but changes the output target:

```text
Vue/Nuxt source
    -> Vue template AST + esbuild script compilation
    -> native UI intermediate representation
    -> Android Views and platform services
```

There is no DOM and no WebView. `main`, `section`, `button`, `input`, `select`, `ScrollView` surfaces, text, forms, navigation, and supported Tailwind-shaped utilities are mapped to native Android behavior. JavaScript and TypeScript run in the embedded QuickJS runtime, while the Android host owns rendering, navigation, permissions, storage, and other platform boundaries.

The server boundary can be embedded or remote. By default, server routes are packaged as assets and handled inside the app. If `runtimeConfig.public.apiBase` is configured, native `$fetch()` calls use that HTTP(S) origin instead. A remote API is deployed separately; it is not bundled into the APK. Private runtime configuration is server-only and is never exposed through the packaged public config.

For a guided first run, see [Getting started](docs/getting-started.md). For the contract and limitations, see [Framework surface](docs/framework-surface.md).

## Direction

- Nuxt-style `app/`, `server/`, `components/`, and `composables/` structure.
- JavaScript and TypeScript are both first-class authoring languages.
- Static markup and utility classes are compiled ahead of time.
- Server routes can use the embedded local runtime by default or a remote HTTP backend through `runtimeConfig.public.apiBase`.
- Native Android rendering is the target; WebView is not part of the runtime design.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Compiler](docs/compiler.md)
- [Framework surface](docs/framework-surface.md)
- [Routing](docs/routing.md)
- [Runtime](docs/runtime.md)
- [Contributing](CONTRIBUTING.md)

Documentation is part of the implementation contract. Changes to compiler behavior, runtime architecture, or native mappings must update the relevant documentation.
