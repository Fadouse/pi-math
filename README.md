# pi-math

Render LaTeX formulas in the Pi TUI as readable Unicode and plain-text terminal layouts.

```text
     ┌──────┐
-b ±╲│b²-4ac
─────────────
      2a
```

## Features

- Inline math with `$...$` and `\(...\)`
- Display math with `$$...$$` and `\[...\]`
- Common environments such as `equation`, `align`, `gather`, matrices, and cases
- Multiline Unicode layouts for fractions, roots, sums, integrals, scripts, matrices, and common symbols
- Cell-width-aware centering for display and promoted multiline formulas
- Automatic reflow when the terminal width changes
- Math detection outside fenced, indented, inline, `<code>`, and `<pre>` code regions
- Safe fallback to the original source for incomplete, unsupported, or oversized formulas
- Display-only transformation: session files and model context retain the original LaTeX
- Local WASM rendering with no network requests or child processes

## Requirements

- Pi 0.80.6 or newer
- Node.js 22.19 or newer
- A terminal font with good Unicode math and box-drawing coverage

## Installation

Clone the repository directly into Pi's global extension directory:

```bash
git clone https://github.com/Fadouse/pi-math.git \
  ~/.pi/agent/extensions/pi-math
cd ~/.pi/agent/extensions/pi-math
npm install --omit=dev
```

Alternatively, keep the checkout elsewhere and symlink it:

```bash
cd /path/to/pi-math
npm install --omit=dev
ln -sfn "$PWD" ~/.pi/agent/extensions/pi-math
```

Reload Pi after installation:

```text
/reload
```

Pi discovers `src/index.ts` through the `pi.extensions` entry in `package.json`.

## Commands

```text
/math-render status   # Show renderer state and cache size
/math-render on       # Enable rendering
/math-render off      # Disable rendering
/math-render clear    # Clear formula and transform caches
```

Rendering is enabled by default. An inline expression that requires a multiline layout, such as `\frac`, is automatically promoted to a display block.

## Examples

```markdown
The remainder is $f(a)$.

$$
f(x)=(x-a)q(x)+r
$$

\[
\frac{-b \pm \sqrt{b^2-4ac}}{2a}
\]

\[
\boxed{x-a\text{ is a factor of }f(x)\iff f(a)=0}.
\]
```

## How it works

Pi 0.80.6 exposes renderers for custom extension messages, but not for ordinary user and assistant messages. pi-math therefore installs a reversible wrapper around the shared `Markdown.render()` method.

For each render pass, the wrapper:

1. Finds complete math spans outside code regions.
2. Renders them synchronously through the bundled `libtexprintf` WASM module.
3. Applies responsive terminal-cell layout without changing the source message.
4. Restores the original Markdown text immediately after rendering.

The wrapper is removed during `session_shutdown`. Conversation history and provider context are never rewritten.

## Development

```bash
npm install
npm run check
```

The test suite covers delimiter parsing, code-region exclusion, fallback behavior, Unicode cell-width centering, terminal resize reflow, real WASM output, command toggling, cache behavior, and prototype restoration.

## License

pi-math is available under the [MIT License](LICENSE).

Formula layout is provided by [`libtexprintf`](https://github.com/bartp5/libtexprintf), which is licensed under GPL-3.0-or-later. See the license included with that dependency for details.
