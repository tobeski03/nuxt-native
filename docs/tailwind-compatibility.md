# Tailwind compatibility

Nuxt Native treats Tailwind classes as a design language for native views. It does not run a browser stylesheet and it does not render the page inside a WebView. The compiler resolves familiar class names into a platform-neutral style contract, then the Android renderer applies that contract to native controls and layouts.

The goal is broad Tailwind authoring compatibility. The renderer maps a utility when Android has a meaningful equivalent, and reports a diagnostic when a utility depends on browser behavior that native views do not have. A class should never be accepted merely to make a warning disappear if its visual or interaction meaning would be lost.

## Supported families

| Family | Examples | Native behavior |
| --- | --- | --- |
| Layout | `flex`, `grid`, `flex-col`, `flex-wrap`, `items-center`, `justify-between`, `self-center`, `place-items-center` | Native linear and flow layouts |
| Spacing | `p-4`, `px-6`, `mt-8`, `-mt-2`, `gap-4`, `space-y-3` | Native padding, margins, and container gaps |
| Sizing | `w-full`, `w-screen`, `w-auto`, `max-w-xl`, `min-h-screen`, arbitrary `w-[15rem]` | Native layout parameters and view constraints |
| Typography | `font-semibold`, `font-sans`, `text-4xl`, `tracking-wide`, `leading-relaxed`, `truncate`, `whitespace-nowrap` | Native typeface, size, spacing, line height, and ellipsis |
| Color | Palette colors, project colors, arbitrary hex/RGB-like values, opacity modifiers | Native text, surface, border, gradient, and control colors |
| Surfaces | `rounded-xl`, `rounded-[7px]`, `shadow-lg`, `ring-2`, gradients | Native drawable, elevation, and gradient surfaces |
| Borders | `border`, `border-2`, `border-t`, `border-b-2`, border colors | Native drawable borders and edge separators |
| Positioning | `relative`, `absolute`, `inset-*`, `top-*`, `z-*` | Native frame layout and elevation |
| Overflow | `overflow-hidden`, `overflow-y-auto`, `overflow-x-auto` | Native clipping and scroll containers |
| Images | `object-contain`, `object-cover`, `object-fill`, `object-none` | Native `ImageView` scale behavior |
| Transforms | `rotate-6`, `scale-105`, `scale-x-95`, `translate-x-4` | Native view rotation, scale, and translation |
| Animation presets | `animate-spin`, `animate-pulse`, `animate-bounce` | Native repeating property animations |
| Forms | `accent-*`, disabled/focus/checked styling, native input and select classes | Native Android controls and state lists |
| Variants | `sm:` through `2xl:`, `max-sm:`, `max-[560px]:`, `dark:`, `light:`, `hover:`, `focus:`, `active:`, `disabled:` | Screen, theme, and native interaction state resolution |

## Native interpretation rules

Buttons and links are content-sized in vertical layouts by default. `w-full` explicitly opts into stretching. `mx-auto` centers a content-sized child. Android does not have a browser cursor, so `cursor-pointer` is accepted as a harmless compatibility utility. `box-border` is also a no-op because Android view sizing is already border-box-like.

Font stacks use the first family name available to Android. Browser-only fallback ordering cannot be reproduced exactly. Percent dimensions, CSS custom properties, background image URLs, filters, pseudo-elements, and complex transforms require a native implementation before they can be considered equivalent.

## Variants and arbitrary values

Arbitrary values use Tailwind's bracket form where the value has a native meaning:

```vue
<button class="mx-auto max-w-[340px] rounded-[7px] bg-[#5969d8] px-[18px] py-[10px] font-[Inter,ui-sans-serif] text-[14px] font-semibold tracking-[.02em]">
  Save changes
</button>
```

Responsive classes are compiled into style overrides, not CSS media queries. Standard `sm:`/`md:`/`lg:`/`xl:`/`2xl:` and `max-sm:`/`max-md:`/`max-lg:`/`max-xl:`/`max-2xl:` are supported, as are arbitrary max breakpoints such as `max-[560px]:px-4`.

## Deliberately diagnosed families

These families are not silently treated as supported yet because their browser meaning has no direct Android equivalent or requires additional renderer primitives:

- `group-*`, `peer-*`, and complex selector variants;
- pseudo-elements such as `before:` and `after:`;
- CSS background images and arbitrary CSS gradients beyond the native gradient model;
- filters, backdrop filters, blend modes, and CSS masks;
- arbitrary transforms and 3D transforms;
- browser transition timing and keyframe semantics beyond the native animation presets;
- CSS grid track expressions that need browser measurement rules;
- custom CSS variables and arbitrary declarations that depend on the DOM cascade.

The compatibility suite tracks each family as it gains a native implementation. See `docs/compiler.md` for the renderer boundary and `test/compiler.test.mjs` for executable coverage.
