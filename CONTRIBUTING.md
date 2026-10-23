# Contributing

Nuxt-native is a documentation-first project. Every meaningful implementation change must update the relevant documentation and Git history.

## Development loop

```bash
npm install
npm test
npm run compile:example
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
4. Commit the change with a clear message.

Generated Android build outputs and machine-specific SDK paths are ignored. `android/local.properties` must not be committed.
