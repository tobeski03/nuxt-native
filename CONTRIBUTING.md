# Contributing

Nuxt-native is a documentation-first project. Every meaningful implementation change must update the relevant documentation.

## Development loop

```bash
npm install
npm test
npm run compile:example
npm run generate:ir -- examples/profile.vue android/app/src/main/assets/profile.ir.json
npm run generate:fixtures
```

The package is intentionally installable by an application. Runtime compiler
dependencies belong in `dependencies`; fixture-only packages belong in
`devDependencies`. Before publishing or changing the package allowlist, check
the packed contents without creating an archive:

```bash
npm pack --dry-run
```

The package must include the Android host template and QuickJS AAR, but must
not include Gradle caches, APK outputs, generated route assets, SDK paths, or
device screenshots. The generated starter project must also be usable without
the framework repository checked out.

`generate:fixtures` also emits page script assets, action manifests, and compiled server assets consumed by the native runtime work. Do not hand-edit generated `*.ir.json`, `*.script.js`, `*.script.json`, or `server-routes.json`; change the source or compiler instead.

The individual IR command is useful for one page. The complete native fixture uses one command and generates both IR assets plus `routes.json`:

```bash
npm run generate:fixtures
```

For Android builds, use the project or another Gradle wrapper:

```bash
gradlew.bat --offline --no-daemon --console=plain -p android :app:assembleDebug
```

## Change requirements

When changing compiler behavior:

1. Add or update a test.
2. Update `docs/compiler.md` or `docs/architecture.md`.
3. Run the relevant checks.
4. Verify the generated artifacts and runtime behavior when applicable.

The Android sample consumes `android/app/src/main/assets/profile.ir.json`. Regenerate it from the Vue fixture with `npm run generate:ir`; do not hand-edit the IR as the long-term workflow.

Generated Android build outputs and machine-specific SDK paths are ignored. `android/local.properties` must not be committed.
