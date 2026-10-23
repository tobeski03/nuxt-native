# Nuxt-native

Nuxt-native explores a Nuxt/Vue authoring experience that produces real native Android UI rather than a WebView application.

## First milestone

This repository currently contains an executable compiler spike. It proves the first architectural boundary:

```text
Vue/Nuxt template -> native UI intermediate representation -> Android renderer
```

The compiler now uses Vue's template AST instead of regular expressions. It supports familiar structural and control elements, nested children, text interpolation nodes, Vue attributes/directives, diagnostics for unsupported utilities, and a broader Tailwind-like utility subset compiled into platform-neutral style values.

It intentionally does not claim to build an APK yet. Android rendering and the JS/Kotlin bridge are the next layer after the intermediate representation is stable.

## Commands

```bash
npm test
npm run compile:example
```

The compiler dependency is `@vue/compiler-dom`. If dependencies are not already cached, run `npm install` before the commands above.

## Direction

- Nuxt-style `app/`, `server/`, `components/`, and `composables/` structure.
- JavaScript and TypeScript are both first-class authoring languages.
- Static markup and utility classes are compiled ahead of time.
- Server routes may target a remote Nitro deployment or an embedded local runtime later.
- Native Android rendering is the target; WebView is not part of the runtime design.

## Documentation

- [Architecture](docs/architecture.md)
- [Compiler](docs/compiler.md)
- [Contributing](CONTRIBUTING.md)

Documentation is part of the implementation contract. Changes to compiler behavior, runtime architecture, or native mappings should update the relevant documentation and Git history.
