# Architecture

pi-math is a display adapter between Markdown LaTeX and Pi's terminal-image support. Mathematical layout belongs to MathJax; terminal placement belongs to Pi TUI. The extension does not maintain a second text-based math layout engine.

## Rendering pipeline

```text
source Markdown
  │
  ├─ transform.ts
  │    scans delimiters/environments and protects code, comments, and verbatim text
  │
  ├─ renderer.ts
  │    normalizes message-level environments, labels, and explicit tags
  │
  ├─ svg-renderer.ts
  │    MathJax TeX → cached SVG → fixed-scale transparent Resvg PNG
  │
  ├─ markdown-patch.ts
  │    substitutes width-matched markers for one reversible Markdown render pass
  │
  └─ image-layout.ts / kitty-graphics.ts
       centers display images or inserts true inline terminal-image cells
```

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Extension initialization, lifecycle hooks, diagnostics, and `/math-render` commands |
| `src/config.ts` | Cross-platform environment configuration for macros, environments, and fonts |
| `src/markdown-patch.ts` | Reversible `Markdown.render()` integration and per-component transform caching |
| `src/transform.ts` | Comment-aware LaTeX delimiter/environment scanning while excluding Markdown, HTML code, and TeX verbatim commands |
| `src/renderer.ts` | Message-level normalization facade around the rasterizer |
| `src/svg-renderer.ts` | Safe MathJax initialization, SVG extraction, sizing, alpha-bound checks, Resvg rasterization, and two-level caches |
| `src/lru-cache.ts` | Entry- and byte-bounded weighted LRU storage |
| `src/image-layout.ts` | Protocol selection, display centering, row reservation, and inline placement |
| `src/kitty-graphics.ts` | Kitty Unicode virtual placements, payload chunking, and cell placeholders |

## Core invariants

### Source immutability

The Markdown patch temporarily replaces the component's internal text only during `Markdown.render()`. A `finally` block restores the exact source string before returning. Session data and provider context therefore retain the original delimiters and LaTeX.

### One display scale

The natural display scale is:

```text
basePixelsPerEx = terminalCellHeightPx × 0.50
```

Formula complexity does not influence this value. Superscripts, limits, and other TeX style levels may be smaller because MathJax defines them relative to the same base style.

### Minimum proportional fitting

For display formulas, the rasterizer chooses:

```text
pixelsPerEx = min(
  basePixelsPerEx,
  drawableContentWidthPx / svgWidthEx
)
```

Embedded inline formulas add a one-row height bound:

```text
pixelsPerEx = min(
  basePixelsPerEx,
  drawableContentWidthPx / svgWidthEx,
  drawableCellHeightPx / svgHeightEx
)
```

The same value is applied on both axes. Formulas are never independently stretched, and formulas that fit are never enlarged.

### Transparent bleed and alpha bounds

The SVG is centered in an integer-cell canvas with transparent safety bleed on every side. After rendering, the raw premultiplied RGBA buffer is scanned for exact half-open ink bounds. A raster is rejected if visible alpha reaches any canvas edge, preventing clipped roots, fraction bars, boxes, accents, or long stroke miters.

Small canvases use 2× device density. If 2× would exceed 4096 pixels but the logical cell canvas still fits, the renderer selects 1× rather than rejecting the formula. Display dimensions remain unchanged.

### Capability-first fallback

The Markdown patch checks Pi's current terminal capabilities before transforming source. If images are unavailable, the ordinary Markdown renderer receives the untouched message. Invalid TeX, missing protocol features, and safety-limit failures follow the same source-preserving path.

## Markdown transformation

`transform.ts` recognizes:

- `$...$` and `$$...$$`;
- `\(...\)` and `\[...\]`; and
- supported standalone math environments.

The scanner:

- skips fenced and indented code blocks, inline code spans, HTML `<code>`/`<pre>`, HTML comments, and TeX `\verb`/`\verb*`;
- ignores apparent closing delimiters and environments inside TeX `%` comments; and
- uses an environment stack so nested `\begin`/`\end` pairs cannot terminate an outer formula early.

Display markers use a private fenced-code language so Markdown cannot reinterpret them. Inline markers use unique private-use characters repeated to exactly the formula's target cell width; this lets Markdown wrap the surrounding sentence correctly before the marker is replaced.

## Terminal placement

### Kitty and Ghostty inline formulas

One-row formulas use Kitty Unicode virtual placements:

1. transmit the PNG and create a `U=1` virtual placement with a 24-bit image/placement ID;
2. emit one U+10EEEE placeholder grapheme per occupied cell;
3. encode row and column through Kitty's canonical combining-diacritic table; and
4. encode image and placement IDs through foreground and underline colors.

The placeholders are real terminal cells. They participate in Pi width measurement, line wrapping, scrolling, overwriting, and differential redraw. Pi extracts the image ID from the APC sequence and frees image data when the line disappears.

Known Kitty/Ghostty environments use placeholders. Other Kitty-protocol terminals retain a cursor-overlay compatibility path. iTerm2 uses display blocks because OSC 1337 has no reusable virtual placement or stable inline-cell model.

### Display formulas

Display and standalone formulas are centered inside the Markdown content width after component padding. Kitty emits the image sequence on the first occupied row and reserves the remaining rows. iTerm2 reserves preceding rows and emits its image with a cursor-up offset and `height=auto`.

## MathJax safety and compatibility

MathJax loads its local package configurations once. `html`, `noerrors`, and `noundefined` are excluded. SafeHandler rejects URLs and arbitrary styles while allowing constrained equation IDs.

Parser limits are explicit:

- original source: 20,000 characters;
- MathJax internal buffer: 20,000 characters; and
- macro/environment substitutions: 1,000 per formula.

`configmacros` definitions can be supplied through `PI_MATH_MACROS` and `PI_MATH_ENVIRONMENTS`. Labels are removed because formulas are isolated render units; explicit `\tag` values are rewritten as visible local annotations instead of triggering MathJax's full-width equation table output.

MathJax math glyphs are SVG paths. When MathJax emits external `<text>` for Unicode or CJK content, Resvg loads either explicitly configured font files or its cross-platform system-font database. Ordinary path-only formulas do not pay the system-font discovery cost.

## Caches and lifecycle

The renderer has two weighted LRU caches:

- SVG formulas: up to 512 entries and 8 MiB, keyed by normalized LaTeX and display mode;
- PNG rasters: up to 256 entries and 64 MiB, keyed by SVG identity, color, terminal geometry, and fitting policy.

This avoids repeating MathJax conversion when only color or terminal width changes. Failed conversions are negatively cached with structured failure codes.

The Markdown patch uses a `WeakMap` keyed by each `Markdown` component. It stores transformed marker text and image placements for one source/layout/protocol combination, allowing redraws to reuse IDs without retaining destroyed components.

`/math-render clear` clears both renderer caches and the transform cache. `session_shutdown` removes the prototype patch. Pi's differential renderer deletes Kitty images whose IDs disappear from rendered lines.

## Initialization and runtime

MathJax is initialized once when Pi loads the extension. Formula conversion and Resvg rasterization are synchronous after the asynchronous extension initialization step.

pi-math itself performs no HTTP requests and launches no child processes. MathJax data, native Resvg code, optional font files, and Kitty's diacritic table are all local.

## Resource limits

The rasterizer limits:

- input and MathJax buffers to 20,000 characters;
- macro substitutions to 1,000;
- SVG cache retention to 8 MiB;
- PNG cache retention to 64 MiB;
- PNG canvas dimensions to 4096 × 4096 pixels; and
- encoded PNG size to 12 MiB.

Block height is derived from terminal cell pixels and the 4096-pixel canvas ceiling rather than a fixed row count. Crossing a limit returns control to the original Markdown renderer instead of emitting a partial image.
