import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const files = {
  'app/app.vue': `<template>\n  <NuxtPage />\n</template>\n`,
  'app.config.ts': `export default defineAppConfig({\n  appName: 'Nuxt-native app'\n})\n`,
  'app/pages/index.vue': `<script setup lang="ts">\nconst message = ref('Hello from Nuxt-native')\n</script>\n\n<template>\n  <main class="flex-1 p-6 bg-slate-950">\n    <h1 class="text-2xl font-bold text-white">{{ message }}</h1>\n    <p class="mt-2 text-slate-300">Native Android views, Nuxt-shaped authoring.</p>\n  </main>\n</template>\n`,
  'nuxt-native.config.json': `${JSON.stringify({
    android: { applicationId: 'com.example.nuxtnative', appName: 'Nuxt-native app' },
    capabilities: ['core', 'network', 'dialog'],
    permissions: [],
    runtimeConfig: { public: {} }
  }, null, 2)}\n`,
  'README.md': `# Nuxt-native app\n\nThis project uses Nuxt-shaped Vue and TypeScript to generate a real native Android app. It does not render a website inside a WebView.\n\n## Install the framework\n\nFrom this project directory, install the CLI as a development dependency:\n\n\`\`\`sh\nnpm install -D nuxt-native\n\`\`\`\n\nThe commands below work through the local binary with \`npx\`. You can also install it globally with \`npm install -g nuxt-native\`.\n\n## Project commands\n\n\`\`\`sh\n# Compile Vue pages, scripts, server routes, and native assets\nnpx nuxt-native build .\n\n# Rebuild automatically while editing\nnpx nuxt-native dev .\n\n# Build, install, and launch on a connected Android device\nnpx nuxt-native run .\n\n# Create a release APK or Android App Bundle\nnpx nuxt-native package . --profile release --format apk\nnpx nuxt-native package . --profile release --format aab\n\n# Run the framework test suite (from a framework checkout)\nnpm test\n\`\`\`\n\n## Where to write code\n\n- \`app/pages/\` contains file-based routes.\n- \`app/components/\` contains auto-imported components.\n- \`app/composables/\` contains auto-imported client helpers.\n- \`app/layouts/\` contains reusable page shells.\n- \`app/middleware/\` contains route guards.\n- \`app/plugins/\` contains startup plugins.\n- \`server/api/\` contains Nitro-shaped server handlers.\n- \`shared/\` contains code safe for both client and server.\n\nUse \`.vue\` files with either JavaScript or TypeScript \`<script setup>\`. Tailwind-shaped classes are compiled to native Android properties. Use \`nuxt-native.config.json\` for capabilities, permissions, runtime configuration, theme tokens, and Android identity.\n\n## Native boundary\n\nThe compiler turns a Vue template into a platform-neutral native IR. The Android host turns that IR into Android Views such as \`TextView\`, \`EditText\`, \`Button\`, \`ScrollView\`, \`Spinner\`, and \`SeekBar\`. Page JavaScript runs in the embedded QuickJS runtime. It never creates a DOM and there is no WebView.\n\nThe embedded server is the default for local app data. Set \`runtimeConfig.public.apiBase\` when the app should call a separately deployed HTTP API. Private runtime values are never bundled into the APK.\n\nRead the framework documentation in the installed package under \`docs/\`, especially \`docs/getting-started.md\`, \`docs/framework-surface.md\`, \`docs/routing.md\`, and \`docs/runtime.md\`.\n`
}

export async function initProject(directory) {
  const root = resolve(directory)
  await mkdir(root, { recursive: true })
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative)
    try {
      await access(target)
      throw new Error(`Refusing to overwrite existing file: ${target}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return { root, files: Object.keys(files) }
}
