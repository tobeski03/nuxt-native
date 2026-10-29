import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const files = {
  'app/app.vue': `<template>\n  <NuxtPage />\n</template>\n`,
  'app.config.ts': `export default defineAppConfig({\n  appName: 'Nuxt-native app'\n})\n`,
  'app/pages/index.vue': `<script setup lang="ts">\nconst message = ref('Hello from Nuxt-native')\n</script>\n\n<template>\n  <main class="flex-1 bg-slate-950 p-6">\n    <h1 class="text-2xl font-bold text-white">{{ message }}</h1>\n    <p class="mt-2 text-slate-300">Native Android apps with Nuxt-shaped Vue.</p>\n  </main>\n</template>\n`,
  'nuxt-native.config.json': `${JSON.stringify({
    android: { applicationId: 'com.example.nuxtnative', appName: 'Nuxt-native app' },
    capabilities: ['core', 'network', 'dialog'],
    permissions: [],
    runtimeConfig: { public: {} }
  }, null, 2)}\n`,
  'README.md': `# Nuxt-native app\n\nThis project uses Nuxt-shaped Vue and TypeScript to generate a native Android app.\n\n## Install the framework\n\nFrom this project directory:\n\n\`\`\`sh\nnpm install -D @tobeski03/nuxt-native\n\`\`\`\n\n## Commands\n\n\`\`\`sh\nnpx nuxt-native build .\nnpx nuxt-native dev .\nnpx nuxt-native run .\nnpx nuxt-native package . --profile release --format apk\n\`\`\`\n\n## Where to write code\n\n- \`app/pages/\` contains file-based routes.\n- \`app/components/\` contains reusable components.\n- \`app/composables/\` contains reusable helpers.\n- \`app/layouts/\` contains page layouts.\n- \`app/middleware/\` contains route guards.\n- \`server/api/\` contains API handlers.\n- \`shared/\` contains code shared by app and server.\n\nUse \`.vue\` files with JavaScript or TypeScript \`<script setup>\`. Use \`nuxt-native.config.json\` for Android identity, capabilities, permissions, and public runtime configuration.\n`
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
