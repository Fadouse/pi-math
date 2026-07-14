import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalMathRenderer } from "../src/renderer.js";

test("libtexprintf renders common terminal math layouts", async () => {
  const renderer = await createTerminalMathRenderer();

  const fraction = renderer.render(String.raw`\frac{x^2+1}{\sqrt{y}}`, true);
  assert.ok(fraction);
  assert.match(fraction, /[─━]/u);
  assert.match(fraction, /√|╲/u);

  const theorem = renderer.render(
    String.raw`x-a\text{ 是 }f(x)\text{ 的因式}\iff f(a)=0`,
    false,
  );
  assert.equal(theorem, "x-a 是 f(x) 的因式⟺f(a)=0");

  const boxed = renderer.render(String.raw`\boxed{x=1}`, true);
  assert.ok(boxed?.startsWith("┌"));
  assert.ok(boxed?.endsWith("┘"));

  const boxedWithPeriod = renderer.render(String.raw`\boxed{f(a)}.`, true);
  assert.equal(boxedWithPeriod, "┌──────┐\n│ f(a) │.\n└──────┘");

  const boxedTheoremWithPeriod = renderer.render(
    String.raw`\boxed{x-a\text{ 是 }f(x)\text{ 的因式}\iff f(a)=0}.`,
    true,
  );
  assert.match(boxedTheoremWithPeriod ?? "", /│ x-a 是 f\(x\) 的因式⟺f\(a\)=0 │\./u);

  const equation = renderer.render(
    String.raw`\begin{equation}a=b\end{equation}`,
    true,
  );
  assert.equal(equation, "a=b");

  assert.equal(renderer.render(String.raw`\definitelyUnknown{x}`, false), undefined);
  assert.ok(renderer.cacheSize >= 5);

  renderer.clear();
  assert.equal(renderer.cacheSize, 0);
});
