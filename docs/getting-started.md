# Getting started

Nuxt-native is a Node.js CLI and an Android host runtime. It lets a team keep a familiar Nuxt-shaped project structure while compiling Vue templates and JavaScript or TypeScript into real Android UI.

## Requirements

- Node.js 20 or newer.
- npm 10 or newer is recommended.
- Android SDK with a platform and build tools matching the generated host.
- Gradle, or a Gradle wrapper supplied by the generated host.
- A physical Android device or emulator for `run`.

The compiler itself can generate assets without an Android device. Device builds additionally need ADB and an Android SDK. The CLI looks for `NUXT_NATIVE_ANDROID_SDK`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and the standard Windows SDK location. `NUXT_NATIVE_ADB` and `NUXT_NATIVE_GRADLE` can pin executable paths.

## Install

For an application, install the framework locally:

```sh
npm install -D nuxt-native
```

Then use the project-local CLI:

```sh
npx nuxt-native init my-app
cd my-app
npx nuxt-native build .
```

Installing locally is recommended because it records the framework version in the application lockfile. A global installation is also supported:

```sh
npm install -g nuxt-native
nuxt-native init my-app
```

When developing the framework from a checkout, `npm install` in the checkout provides the same `nuxt-native` binary through `npm run` or `node src/cli.mjs`.

## First app

`init` creates a safe starter project and an Android host. It refuses to overwrite an existing file. The important files are:

```text
my-app/
├─ app/
│  ├─ app.vue
│  └─ pages/index.vue
├─ android/
├─ app.config.ts
├─ nuxt-native.config.json
└─ package.json              # add your own application dependencies
```

Edit `app/pages/index.vue`:

```vue
<script setup lang="ts">
const count = ref(0)
</script>

<template>
  <main class="flex-1 bg-slate-950 p-6">
    <h1 class="text-3xl font-bold text-white">Hello, native Android</h1>
    <p class="mt-2 text-slate-300">Count: {{ count }}</p>
    <button class="mt-6 rounded-xl bg-indigo-500 px-4 py-3 text-white" @click="count++">
      Increment
    </button>
  </main>
</template>
```

Compile it:

```sh
npx nuxt-native build .
```

The generated route assets are written to `android/app/src/main/assets/`. They are build artifacts; edit the Vue source instead of editing generated JSON or script files.

## The development loop

Use `dev` while changing pages, components, server handlers, middleware, plugins, shared utilities, or configuration:

```sh
npx nuxt-native dev .
```

Use `run` for the complete device loop:

```sh
npx nuxt-native run . --serial <device-id>
```

This compiles the project, writes a local SDK path when one is discoverable, assembles the debug APK, installs it with ADB, and launches the configured Android activity. The `--serial`, `--adb`, and `--gradle` options are optional when the machine has one discoverable device and standard tools.

## Production artifacts

```sh
npx nuxt-native package . --profile release --format apk
npx nuxt-native package . --profile release --format aab
```

Signing is controlled by environment variables rather than source files:

```text
NUXT_NATIVE_RELEASE_STORE_FILE
NUXT_NATIVE_RELEASE_STORE_PASSWORD
NUXT_NATIVE_RELEASE_KEY_ALIAS
NUXT_NATIVE_RELEASE_KEY_PASSWORD
```

Add `--require-signing` when an unsigned artifact must be rejected by CI. Never commit keystore passwords or private runtime configuration.

## How a build works

1. The CLI resolves the project root once and discovers the Nuxt-shaped directories.
2. Vue's template AST is compiled into native intermediate representation.
3. Tailwind-shaped utilities and project theme tokens become platform-neutral style values.
4. Page, component, plugin, middleware, and server JavaScript or TypeScript is lowered and bundled with esbuild.
5. Route, server, configuration, and resource manifests are written into Android assets.
6. The Android renderer creates native Views and the embedded JavaScript runtime evaluates route behavior.

The server boundary is selectable. With no public `apiBase`, `$fetch` and server routes use the embedded request bridge in the APK. With `runtimeConfig.public.apiBase`, requests go to that HTTP(S) origin. The server source can remain in the same repository, but a remote API is hosted wherever the team deploys it; it is not magically hosted by the Android package.

## What it is and is not

Nuxt-native is native Android rendering with a Nuxt-shaped authoring model. It is not a browser, a DOM implementation, or a WebView wrapper. The current MVP is intentionally a supported native subset rather than complete Nuxt, Vue, Nitro, HTML, or CSS compatibility. Check [Framework surface](framework-surface.md) and [Compiler](compiler.md) before depending on a browser-only API or CSS feature.
