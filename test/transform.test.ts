import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_MATH_LANGUAGE,
  expandMathInMarkdown,
  stripGeneratedMathFenceLines,
  type MathRender,
} from "../src/transform.js";

const renderOneLine: MathRender = (latex) => `⟦${latex.trim()}⟧`;

test("renders dollar and parenthesized inline math", () => {
  const source = String.raw`A $x^2+1$ and \(y_1\).`;
  assert.equal(
    expandMathInMarkdown(source, renderOneLine),
    "A `⟦x^2+1⟧` and `⟦y_1⟧`.",
  );
});

test("renders display delimiters as protected generated blocks", () => {
  const source = String.raw`Before
$$\frac{1}{2}$$
After`;
  const output = expandMathInMarkdown(source, renderOneLine);

  assert.match(output, new RegExp(`\`{4}${GENERATED_MATH_LANGUAGE}`));
  assert.match(output, /⟦\\frac\{1\}\{2\}⟧/);
  assert.doesNotMatch(output, /\$\$/);
});

test("promotes multiline inline output to a display block", () => {
  const output = expandMathInMarkdown("value $x/y$ here", () => " x\n───\n y");
  assert.match(output, new RegExp(GENERATED_MATH_LANGUAGE));
  assert.match(output, /───/);
});

test("can force inline math into an image block marker", () => {
  const output = expandMathInMarkdown("value $x/y$ here", () => ({
    text: "__PI_MATH_IMAGE_1__",
    forceBlock: true,
  }));
  assert.match(output, new RegExp(GENERATED_MATH_LANGUAGE));
  assert.match(output, /__PI_MATH_IMAGE_1__/u);
});

test("leaves fenced, inline, and HTML code untouched", () => {
  const source = [
    "```ts",
    "const formula = '$not_math$';",
    "```",
    "`$also_not_math$` and $yes$",
    "<code>$still_not_math$</code>",
  ].join("\n");
  const output = expandMathInMarkdown(source, renderOneLine);

  assert.match(output, /\$not_math\$/);
  assert.match(output, /`\$also_not_math\$` and `⟦yes⟧`/);
  assert.match(output, /<code>\$still_not_math\$<\/code>/);
});

test("leaves indented Markdown code blocks untouched", () => {
  const source = [
    "    $x^2$",
    "",
    "    \\(y_1\\)",
    "$z$",
  ].join("\n");
  const output = expandMathInMarkdown(source, renderOneLine);

  assert.match(output, /^    \$x\^2\$/u);
  assert.match(output, /    \\\(y_1\\\)/u);
  assert.match(output, /`⟦z⟧`$/u);
});

test("leaves escaped dollars, ordinary prices, incomplete spans, and failures untouched", () => {
  const source = String.raw`Pay \$5 or $10 today; incomplete $x and $bad$.`;
  const output = expandMathInMarkdown(source, (latex) =>
    latex.trim() === "bad" ? undefined : `⟦${latex.trim()}⟧`,
  );

  assert.equal(output, source);
});

test("recognizes standalone equation environments", () => {
  const source = String.raw`\begin{equation}a=b\end{equation}`;
  const output = expandMathInMarkdown(source, renderOneLine);
  assert.match(output, new RegExp(GENERATED_MATH_LANGUAGE));
  assert.doesNotMatch(output, /^\\begin/u);
});

test("strips only synthetic rendered-math fences", () => {
  const lines = [
    `\x1b[38;5;8m\`\`\`${GENERATED_MATH_LANGUAGE}\x1b[0m`,
    "  numerator",
    "  ─────────",
    "  denominator",
    "\x1b[38;5;8m```\x1b[0m",
    "ordinary line",
  ];

  assert.deepEqual(stripGeneratedMathFenceLines(lines), [
    "  numerator",
    "  ─────────",
    "  denominator",
    "ordinary line",
  ]);
});

test("removes Markdown-only blank margins around generated math", () => {
  const lines = [
    "before",
    "",
    `\`\`\`${GENERATED_MATH_LANGUAGE}`,
    "  x=1",
    "```",
    "",
    "after",
  ];
  assert.deepEqual(stripGeneratedMathFenceLines(lines), ["before", "  x=1", "after"]);
});
