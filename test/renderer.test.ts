import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTerminalMathRenderer } from "../src/renderer.js";
import type { FormulaRasterLayout } from "../src/svg-renderer.js";

const layout: FormulaRasterLayout = {
  maxWidthCells: 120,
  maxHeightCells: 32,
  cellWidthPx: 9,
  cellHeightPx: 18,
};

function isPng(base64: string): boolean {
  return Buffer.from(base64, "base64").subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

function assertTransparentBleed(result: NonNullable<ReturnType<Awaited<ReturnType<typeof createTerminalMathRenderer>>["render"]>>): void {
  assert.ok(result.inkBounds.left > 0);
  assert.ok(result.inkBounds.top > 0);
  assert.ok(result.inkBounds.right < result.widthPx);
  assert.ok(result.inkBounds.bottom < result.heightPx);
}

test("rasterizes LaTeX through MathJax SVG", async () => {
  const renderer = await createTerminalMathRenderer();
  const result = renderer.render(
    String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    true,
    "#b5bd68",
    layout,
  );
  assert.ok(result);
  assert.ok(isPng(result.base64Data));
  assert.equal(result.widthPx, result.columns * layout.cellWidthPx * 2);
  assert.equal(result.heightPx, result.rows * layout.cellHeightPx * 2);
  assert.equal(result.pixelsPerEx, layout.cellHeightPx * 0.5);
  assert.equal(result.deviceScale, 2);
  assertTransparentBleed(result);
});

test("uses one fixed font scale for every formula", async () => {
  const renderer = await createTerminalMathRenderer();
  const formulas = [
    String.raw`(a+b)^2=a^2+2ab+b^2`,
    String.raw`a^2+b^2=c^2`,
    String.raw`\int_a^b f(x)\,dx=F(b)-F(a)`,
    String.raw`e^x=\sum_{n=0}^{\infty}\frac{x^n}{n!}`,
  ];
  const rasters = formulas.map((formula) => renderer.render(formula, true, "#ffffff", layout));
  assert.ok(rasters.every(Boolean));
  assert.deepEqual(
    rasters.map((raster) => raster!.pixelsPerEx),
    Array.from({ length: formulas.length }, () => layout.cellHeightPx * 0.5),
  );
});

test("uses the smallest width-only shrink needed for oversized formulas", async () => {
  const renderer = await createTerminalMathRenderer();
  const formula = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;
  const medium = renderer.render(formula, true, "#fff000", { ...layout, maxWidthCells: 12 });
  const narrow = renderer.render(formula, true, "#fff000", { ...layout, maxWidthCells: 8 });
  assert.ok(medium);
  assert.ok(narrow);
  assert.equal(narrow.columns, 8);
  assert.ok(narrow.pixelsPerEx < medium.pixelsPerEx);
  assert.ok(medium.pixelsPerEx <= layout.cellHeightPx * 0.5);
  assert.equal(narrow.widthPx, 8 * layout.cellWidthPx * 2);
});

test("fits embedded inline formulas into one row without distortion", async () => {
  const renderer = await createTerminalMathRenderer();
  const result = renderer.render(String.raw`\frac{x^2+1}{y_1}`, false, "#ffffff", {
    ...layout,
    maxHeightCells: 1,
    fitHeight: true,
  });
  assert.ok(result);
  assert.equal(result.rows, 1);
  assert.ok(result.pixelsPerEx < layout.cellHeightPx * 0.5);
  assertTransparentBleed(result);
});

test("supports configured macros, explicit tags, and Unicode text", async () => {
  const renderer = await createTerminalMathRenderer({
    macros: { RR: String.raw`\mathbb{R}` },
  });
  for (const formula of [
    String.raw`x\in\RR`,
    String.raw`\begin{equation}a=b\tag{1}\end{equation}`,
    String.raw`x\text{ 是正数}`,
  ]) {
    const result = renderer.render(formula, true, "#ffffff", layout);
    assert.ok(result, renderer.lastFailure?.message);
    assertTransparentBleed(result);
  }
});

test("renders formulas taller than the former 32-row limit", async () => {
  const renderer = await createTerminalMathRenderer();
  const rows = Array.from({ length: 40 }, (_, index) => `x_{${index}}`).join(String.raw`\\`);
  const result = renderer.render(String.raw`\begin{matrix}${rows}\end{matrix}`, true, "#ffffff", {
    ...layout,
    maxHeightCells: 100,
  });
  assert.ok(result, renderer.lastFailure?.message);
  assert.ok(result.rows > 32);
  assertTransparentBleed(result);
});

test("drops raster density rather than rejecting very wide terminal canvases", async () => {
  const renderer = await createTerminalMathRenderer();
  const formula = Array.from({ length: 700 }, (_, index) => `x_{${index}}`).join("+");
  const result = renderer.render(formula, true, "#ffffff", {
    ...layout,
    maxWidthCells: 300,
    maxHeightCells: 100,
  });
  assert.ok(result, renderer.lastFailure?.message);
  assert.equal(result.columns, 300);
  assert.equal(result.deviceScale, 1);
  assert.equal(result.widthPx, 300 * layout.cellWidthPx);
  assertTransparentBleed(result);
});

test("rejects invalid LaTeX with structured diagnostics", async () => {
  const renderer = await createTerminalMathRenderer();
  assert.equal(renderer.render(String.raw`\definitelyUnknown{x}`, true, "#fff000", layout), undefined);
  assert.equal(renderer.lastFailure?.code, "tex-error");
  assert.equal(renderer.render(String.raw`\frac{x}{`, true, "#fff000", layout), undefined);
  assert.equal(renderer.lastFailure?.code, "tex-error");
});

test("rasterizes the deeply nested regression without clipping", async () => {
  const renderer = await createTerminalMathRenderer();
  const source = readFileSync(new URL("./fixtures/field-theory.tex", import.meta.url), "utf8");
  const result = renderer.render(source, true, "#b5bd68", layout);
  assert.ok(result);
  assert.ok(isPng(result.base64Data));
  assert.ok(result.columns <= layout.maxWidthCells);
  assert.ok(result.rows <= layout.maxHeightCells);
  assert.ok(result.widthPx <= 4096);
  assert.ok(result.heightPx <= 4096);

  const cached = renderer.render(source, true, "#b5bd68", layout);
  assert.equal(cached, result);
  assert.ok(renderer.cacheSize >= 1);
  assert.ok(renderer.cacheBytes > 0);
  renderer.clear();
  assert.equal(renderer.cacheSize, 0);
});
