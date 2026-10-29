import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const defaultTheme = { primary: '#2563EB', background: '#F9FAFB', onPrimary: '#FFFFFF', onBackground: '#111827', statusBar: '#F9FAFB' }

function color(value, field) {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)) throw new Error(`Android theme ${field} must be a #RRGGBB or #AARRGGBB color`)
  return value
}

export function normalizeAndroidResources(android = {}) {
  const configured = android.theme && typeof android.theme === 'object' ? android.theme : {}
  const theme = { ...defaultTheme, ...configured }
  for (const [field, value] of Object.entries(theme)) theme[field] = color(value, field)
  return { theme, icon: android.icon ?? null }
}

function lines(values) {
  return `${values.join('\n')}\n`
}

function renderColors(theme) {
  return lines(['<resources>', `    <color name="nn_primary">${theme.primary}</color>`, `    <color name="nn_background">${theme.background}</color>`, `    <color name="nn_on_primary">${theme.onPrimary}</color>`, `    <color name="nn_on_background">${theme.onBackground}</color>`, `    <color name="nn_status_bar">${theme.statusBar}</color>`, '</resources>'])
}

function renderStyles(splash = false) {
  const values = ['<resources>', '    <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">', '        <item name="android:fontFamily">sans</item>', '        <item name="android:colorAccent">@color/nn_primary</item>', '        <item name="android:windowBackground">@color/nn_background</item>', '        <item name="android:navigationBarColor">@color/nn_background</item>', '        <item name="android:statusBarColor">@color/nn_status_bar</item>', '        <item name="android:windowLightStatusBar">true</item>']
  if (splash) values.push('        <item name="android:windowSplashScreenBackground">@color/nn_background</item>', '        <item name="android:windowSplashScreenAnimatedIcon">@drawable/ic_launcher_foreground</item>')
  values.push('    </style>', '</resources>')
  return lines(values)
}

function renderForeground() {
  return lines(['<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">', '    <path android:fillColor="#FFFFFFFF" android:pathData="M31,28 L77,28 L77,38 L42,38 L42,49 L70,49 L70,59 L42,59 L42,70 L77,70 L77,80 L31,80 Z" />', '</vector>'])
}

function renderBackground(theme) {
  return lines(['<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">', `    <solid android:color="${theme.primary}" />`, '</shape>'])
}

function renderAdaptiveIcon() {
  return lines(['<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">', '    <background android:drawable="@drawable/ic_launcher_background" />', '    <foreground android:drawable="@drawable/ic_launcher_foreground" />', '</adaptive-icon>'])
}

export async function generateAndroidResources({ projectRoot, hostRoot, android }) {
  const resources = normalizeAndroidResources(android)
  const resRoot = join(hostRoot, 'app/src/main/res')
  await mkdir(join(resRoot, 'values'), { recursive: true })
  await mkdir(join(resRoot, 'values-v31'), { recursive: true })
  await mkdir(join(resRoot, 'drawable'), { recursive: true })
  await mkdir(join(resRoot, 'mipmap-anydpi-v26'), { recursive: true })
  await writeFile(join(resRoot, 'values/colors.xml'), renderColors(resources.theme), 'utf8')
  await writeFile(join(resRoot, 'values/styles.xml'), renderStyles(), 'utf8')
  await writeFile(join(resRoot, 'values-v31/styles.xml'), renderStyles(true), 'utf8')

  if (resources.icon) {
    const source = resolve(projectRoot, resources.icon)
    const extension = extname(source).toLowerCase()
    if (!['.png', '.webp', '.jpg', '.jpeg', '.xml'].includes(extension)) throw new Error(`Unsupported Android icon format: ${extension}`)
    const directory = extension === '.xml' ? 'drawable' : 'drawable-nodpi'
    await mkdir(join(resRoot, directory), { recursive: true })
    await copyFile(source, join(resRoot, directory, `ic_launcher${extension}`))
    return { iconResource: '@drawable/ic_launcher', theme: resources.theme }
  }

  await writeFile(join(resRoot, 'drawable/ic_launcher_foreground.xml'), renderForeground(), 'utf8')
  await writeFile(join(resRoot, 'drawable/ic_launcher_background.xml'), renderBackground(resources.theme), 'utf8')
  await writeFile(join(resRoot, 'mipmap-anydpi-v26/ic_launcher.xml'), renderAdaptiveIcon(), 'utf8')
  return { iconResource: '@mipmap/ic_launcher', theme: resources.theme }
}
