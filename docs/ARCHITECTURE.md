# Architecture

pi-math is a display adapter between Markdown LaTeX and Pi's terminal-image support. Mathematical layout belongs to MathJax; terminal placement belongs to Pi TUI. The extension does not maintain a second Unicode math layout engine.

## Rendering pipeline

```text
source Markdown
  │
  ├─ transform.ts
  │    finds complete math spans and protects code regions
  │
  ├─ renderer.ts
  │    removes message-only annotations and outer equation wrappers
  │
  ├─ svg-renderer.ts
  │    MathJax TeX → SVG → fixed-scale, transparent Resvg PNG
  │
  ├─ markdown-patch.ts
  │    substitutes protected image markers for one Markdown render pass
  │
  └─ image-layout.ts
       centers and places the PNG with Kitty or iTerm2 escape sequences
```

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Extension initialization, lifecycle hooks, and `/math-render` commands |
| `src/markdown-patch.ts` | Reversible `Markdown.render()` integration and per-component transform caching |
| `src/transform.ts` | LaTeX delimiter/environment detection while excluding Markdown and HTML code |
| `src/renderer.ts` | Small normalization facade around the rasterizer |
| `src/svg-renderer.ts` | MathJax initialization, SVG extraction, sizing, transparent canvas construction, Resvg rasterization, and raster cache |
| `src/image-layout.ts` | Protocol-neutral centering plus Kitty/iTerm2 row reservation |

## Core invariants

### Source immutability

The Markdown patch temporarily replaces the component's internal text only during `Markdown.render()`. A `finally` block restores the exact source string before returning. Session data and provider context therefore retain the original delimiters and LaTeX.

### One base scale

The natural scale is:

```text
basePixelsPerEx = terminalCellHeightPx × 0.50
```

Formula complexity does not influence this value. Superscripts, limits, and other TeX style levels may be smaller because MathJax defines them relative to the same base style.

### Minimum width fit

MathJax reports the natural SVG width in `ex`. The rasterizer chooses:

```text
pixelsPerEx = min(
  basePixelsPerEx,
  availableContentWidthPx / svgWidthEx
)
```

This has three consequences:

1. formulas that fit are not scaled;
2. formulas are never enlarged; and
3. an overwide formula receives only the reduction required to fit.

The same `pixelsPerEx` is applied on both axes. No independent row/column scaling is allowed.

### Integer-cell canvas

The scaled SVG content is centered inside a transparent canvas whose dimensions are exact multiples of terminal cell width and height. The PNG is rasterized at 2× device density. Pi then maps that canvas back to the declared cell rectangle, so rounding cannot distort the formula's aspect ratio.

### Capability-first fallback

The Markdown patch checks Pi's current terminal capabilities before transforming source. If images are unavailable, the ordinary Markdown renderer receives the untouched message. Invalid TeX and safety-limit failures follow the same source-preserving path.

## Markdown transformation

`transform.ts` recognizes:

- `$...$` and `$$...$$`;
- `\(...\)` and `\[...\]`; and
- supported standalone display environments.

It skips fenced code blocks, indented code blocks, inline code spans, and HTML `<code>`/`<pre>` regions. Incomplete delimiters and failed render callbacks are copied unchanged.

Generated markers are wrapped in a private fenced-code language so Pi Markdown does not reinterpret their characters. After Markdown rendering, the synthetic fences and margins are removed and marker rows are replaced with image sequences.

Inline formulas currently use `forceBlock` because terminal image protocols cannot compose reliably with Markdown text wrapping.

## Terminal placement

`image-layout.ts` centers each formula inside the Markdown content width after accounting for component padding.

- **Kitty graphics:** the sequence is emitted on the first occupied row; remaining rows are reserved as empty lines. Stable image IDs are reused by cached Markdown renders.
- **iTerm2:** preceding rows are reserved first, then the sequence is emitted with a cursor-up offset and `height=auto` to preserve aspect ratio.

Pi owns protocol encoding and cell-size calculation through `renderImage()`.

## Caches and lifecycle

The SVG renderer keeps an LRU-style cache of up to 256 entries. Its key includes:

- display or inline TeX mode;
- foreground color;
- content width and safety height;
- terminal cell pixel dimensions; and
- normalized LaTeX.

The Markdown patch uses a `WeakMap` keyed by the `Markdown` component. It stores the transformed marker text and image placements for one source/layout combination, allowing redraws to reuse image IDs without retaining destroyed components.

`/math-render clear` clears both caches. `session_shutdown` removes the prototype patch and releases its transform cache.

## Initialization and runtime

MathJax is initialized once when Pi loads the extension. Formula conversion and Resvg rasterization are synchronous after that asynchronous extension initialization step.

The runtime performs no HTTP requests and launches no child processes. MathJax data and the Resvg native binary are loaded from installed npm packages.

## Safety limits

The rasterizer currently limits:

- input length to 20,000 characters;
- cache size to 256 formulas;
- PNG canvas dimensions to 4096 × 4096 pixels;
- encoded PNG size to 12 MiB; and
- formula placement height to 32 terminal rows.

Crossing a limit returns control to the original Markdown renderer rather than emitting a partial or malformed image.
