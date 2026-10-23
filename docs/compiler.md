# Compiler

The compiler entry point is `src/compiler.mjs`.

## Pipeline

1. Vue's template AST parser reads the contents of a `<template>` block.
2. Supported elements are mapped to platform-neutral native node types.
3. Attributes and Vue directives are preserved as runtime props.
4. Tailwind-like classes are converted into native style declarations.
5. Unsupported utilities are returned as diagnostics.
6. The resulting IR is consumed by a platform renderer.

## Example

```vue
<button class="rounded-xl bg-blue-600 px-4 py-3 text-white" @click="save">
  Save
</button>
```

Conceptually becomes:

```json
{
  "type": "button",
  "tag": "button",
  "props": { "class": "...", "@click": "save" },
  "style": {
    "borderRadius": 12,
    "backgroundColor": "#2563eb",
    "paddingHorizontal": 16,
    "paddingVertical": 12,
    "color": "#ffffff"
  }
}
```

## Compatibility policy

The compiler supports a deliberate native subset rather than pretending all web HTML and CSS are identical to Android. Every new mapping should include:

- a compiler implementation;
- a renderer mapping;
- a test;
- documentation explaining platform differences.

Tailwind variants such as `hover:` are currently diagnosed because Android state selectors have not been implemented yet.
