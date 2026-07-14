# pi-math

Render LaTeX in the Pi TUI as real, transparent terminal images.

pi-math uses MathJax for mathematical typesetting and Resvg for rasterization. It does not approximate formulas with Unicode glyphs or hand-built character geometry.

![MathJax formulas rendered in Ghostty through Pi Markdown](docs/images/formula-gallery.png)

## Features

- Genuine LaTeX layout through MathJax SVG
- Transparent, theme-colored PNG output through Resvg
- Kitty graphics and iTerm2 image placement through Pi TUI
- Inline delimiters: `$...$` and `\(...\)`
- Display delimiters: `$$...$$` and `\[...\]`
- Common display environments, including `equation`, `align`, `aligned`, `gather`, matrices, and cases
- Native MathJax support for fractions, roots, scripts, limits, scalable fences, `\boxed`, and nested structures
- One consistent base formula size across messages
- Minimum necessary proportional shrinking when a formula exceeds the content width
- Cell-aware centering and automatic rerendering after terminal resize
- Original LaTeX fallback when image rendering or a formula is unsupported
- Display-only transformation: stored messages and model context are never rewritten
- Local, in-process rendering with no browser, network request, or child process at runtime

## Requirements

- Pi 0.80.6 or newer
- Node.js 22.19 or newer
- A terminal image protocol recognized by Pi:
  - Kitty graphics: Ghostty, Kitty, WezTerm, and Warp
  - iTerm2 inline images: iTerm2

Pi intentionally disables terminal images inside tmux and screen. In those environments, and in terminals without a supported image protocol, pi-math leaves the original LaTeX visible.

## Installation

Clone the repository into Pi's global extension directory:

```bash
git clone https://github.com/Fadouse/pi-math.git \
  ~/.pi/agent/extensions/pi-math
cd ~/.pi/agent/extensions/pi-math
npm install --omit=dev
```

Or keep the checkout elsewhere and symlink it:

```bash
cd /path/to/pi-math
npm install --omit=dev
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-math
```

Reload Pi after installation:

```text
/reload
```

Pi discovers `src/index.ts` through the `pi.extensions` field in `package.json`.

## Usage

Use normal LaTeX delimiters in user or assistant messages:

```markdown
Euler's identity is $e^{i\pi}+1=0$.

\[
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}
\]

\[
\begin{aligned}
f(x)&=(x-a)q(x)+r,\\
f(a)&=r.
\end{aligned}
\]
```

Terminal images cannot participate safely in ordinary text wrapping, so inline formulas are currently promoted to centered image blocks. The Markdown source itself remains unchanged.

## Commands

```text
/math-render status   Show renderer state, protocol, and cache size
/math-render on       Enable image rendering
/math-render off      Disable image rendering
/math-render clear    Clear formula and Markdown transform caches
```

Rendering is enabled by default.

## Sizing behavior

Every formula starts at the same base scale: `0.50 × terminal cell height` pixels per MathJax `ex`.

- Formulas that fit use that scale unchanged.
- Formulas are never enlarged to fill available space.
- An overwide formula is reduced only enough to fit the current Markdown content width.
- Width and height always use the same scale, preserving the complete formula's aspect ratio.
- The raster is padded, not stretched, to an exact integer number of terminal cells.

Resizing the terminal creates a layout-specific render. A formula returns to the base scale whenever the wider content area can contain it.

## Fallback behavior

pi-math leaves the original delimiters and LaTeX visible when:

- Pi reports no supported image protocol;
- rendering is disabled with `/math-render off`;
- MathJax rejects incomplete or unsupported input;
- a safety limit is exceeded; or
- the renderer cannot initialize on the current platform.

Fallback is source-preserving; there is no Unicode approximation path.

## How it works

```text
Markdown LaTeX
    ↓ protected span detection
MathJax TeX → SVG
    ↓ fixed scale or minimum width fit
Resvg → transparent PNG on an integer-cell canvas
    ↓
Pi TUI renderImage()
    ↓
Kitty graphics or iTerm2 image protocol
```

Pi does not currently expose a renderer override for ordinary user and assistant messages. pi-math therefore installs a reversible wrapper around `Markdown.render()`. It swaps protected markers into the render pass, inserts terminal image sequences, and restores the original Markdown before returning.

See [Architecture](docs/ARCHITECTURE.md) for module boundaries, cache behavior, sizing invariants, and failure handling.

## Development

```bash
npm install
npm run check
npm run visual -- gallery
npm run visual -- radical
npm run visual -- aligned
npm run visual -- complex
npm run visual -- theory
```

Set `MATH_WIDTH` to exercise a specific Markdown width:

```bash
MATH_WIDTH=60 npm run visual -- theory
```

The automated suite covers LaTeX rasterization, fixed and width-limited scales, invalid-input fallback, deep nested formulas, Markdown code-region exclusion, Kitty/iTerm2 placement, terminal capability fallback, resize layout, command toggling, cache behavior, source restoration, and patch removal.

## Runtime dependencies

- [MathJax 3](https://github.com/mathjax/MathJax-src) — TeX parsing and SVG layout, Apache-2.0
- [Resvg JS](https://github.com/yisibl/resvg-js) — in-process SVG rasterization, MPL-2.0

`@resvg/resvg-js` uses platform-specific native packages. Installation must include the matching optional dependency for the target operating system and architecture.

## License

pi-math is available under the [MIT License](LICENSE).

Copyright (c) 2026 Fadouse.
