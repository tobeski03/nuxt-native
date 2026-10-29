# Nuxt-native

Build native Android apps with a Nuxt-shaped Vue project. Write pages and components with Vue, JavaScript, or TypeScript, then generate and run an Android app from the same project.

## Install

Inside the application you want to build:

```bash
npm install -D nuxt-native
```

Create a starter project:

```bash
npx nuxt-native init my-app
cd my-app
npx nuxt-native run .
```

For local development, Node.js 20 or newer and an Android SDK are required. `run` also needs Gradle and ADB, plus a connected Android device or emulator.

## Commands

```bash
# Compile the project
npx nuxt-native build .

# Rebuild automatically while editing
npx nuxt-native dev .

# Build, install, and open the app on Android
npx nuxt-native run .

# Create a release APK
npx nuxt-native package . --profile release --format apk

# Create an Android App Bundle
npx nuxt-native package . --profile release --format aab
```

Run `npx nuxt-native help` for all options. If Android tools are not found automatically, pass `--gradle`, `--adb`, or `--serial`, or configure `NUXT_NATIVE_ANDROID_SDK`, `NUXT_NATIVE_GRADLE`, and `NUXT_NATIVE_ADB`.

## Project structure

```text
my-app/
├─ app/
│  ├─ app.vue
│  ├─ pages/           # file-based routes
│  ├─ components/      # reusable components
│  ├─ composables/     # reusable composables
│  ├─ layouts/         # page layouts
│  ├─ middleware/      # route middleware
│  └─ plugins/         # app startup plugins
├─ server/
│  ├─ api/             # API handlers
│  ├─ routes/          # server routes
│  ├─ middleware/      # server middleware
│  └─ plugins/         # server plugins
├─ shared/             # code shared by app and server
├─ public/             # static assets
├─ app.config.ts
└─ nuxt-native.config.json
```

Root-level `pages/`, `components/`, `composables/`, `layouts/`, `middleware/`, `plugins/`, and `app.vue` are also supported.

## Write a page

Pages can use JavaScript or TypeScript:

```vue
<script setup lang="ts">
const count = ref(0)
</script>

<template>
  <main class="flex-1 bg-slate-950 p-6">
    <h1 class="text-3xl font-bold text-white">Hello, native Android</h1>
    <p class="mt-2 text-slate-300">Count: {{ count }}</p>
    <button
      class="mt-6 rounded-xl bg-indigo-500 px-4 py-3 text-white"
      @click="count++"
    >
      Increment
    </button>
  </main>
</template>
```

Save this as `app/pages/index.vue`, then run:

```bash
npx nuxt-native build .
```

Common Vue state, events, forms, components, composables, and supported Tailwind-style utilities are available. Use the framework documentation for the supported component and utility surface.

## Routing

Routes are created from page filenames:

```text
app/pages/index.vue          → /
app/pages/settings.vue       → /settings
app/pages/posts/[id].vue     → /posts/:id
```

Navigate with familiar Nuxt APIs:

```vue
<NuxtLink to="/settings">Settings</NuxtLink>
```

```ts
const route = useRoute()
const router = useRouter()

await navigateTo('/settings')
router.back()
```

## Server data and APIs

Create an API handler such as `server/api/hello.get.ts`:

```ts
export default defineEventHandler(() => ({
  message: 'Hello from the server'
}))
```

Use it from a page:

```vue
<script setup lang="ts">
const { data } = await useFetch('/api/hello')
</script>

<template>
  <p>{{ data?.message }}</p>
</template>
```

The default setup can serve these handlers from the app package. To use a separately deployed backend, configure its public base URL:

```json
{
  "runtimeConfig": {
    "public": {
      "apiBase": "https://api.example.com"
    }
  }
}
```

Only values under `runtimeConfig.public` are available in the app. Do not put secrets there.

## Native configuration

Use `nuxt-native.config.json` for Android identity, capabilities, permissions, theme values, and public runtime configuration:

```json
{
  "android": {
    "applicationId": "com.example.myapp",
    "label": "My App",
    "versionName": "1.0.0"
  },
  "capabilities": ["core", "network", "storage"],
  "permissions": [],
  "runtimeConfig": {
    "public": {}
  }
}
```

Only request the capabilities and Android permissions your app needs.

## Release builds

Set signing values in the build environment rather than committing them:

```text
NUXT_NATIVE_RELEASE_STORE_FILE
NUXT_NATIVE_RELEASE_STORE_PASSWORD
NUXT_NATIVE_RELEASE_KEY_ALIAS
NUXT_NATIVE_RELEASE_KEY_PASSWORD
```

Then package the release:

```bash
npx nuxt-native package . --profile release --format aab --require-signing
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Framework surface](docs/framework-surface.md)
- [Routing](docs/routing.md)
- [Compiler and styling](docs/compiler.md)
- [Runtime APIs](docs/runtime.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

The project is an early release. The documentation identifies supported behavior and platform differences as the framework evolves.
