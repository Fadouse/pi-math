import {
  createSvgMathRenderer,
  type FormulaRaster,
  type FormulaRasterLayout,
  type FormulaRenderFailure,
  type SvgMathRenderer,
  type SvgMathRendererOptions,
} from "./svg-renderer.js";

const STRIPPABLE_ENVIRONMENTS = new Set(["equation", "equation*", "displaymath", "math"]);

export interface TerminalMathRenderer {
  render(
    latex: string,
    display: boolean,
    color: string | undefined,
    layout: FormulaRasterLayout,
  ): FormulaRaster | undefined;
  clear(): void;
  readonly cacheSize: number;
  readonly cacheBytes: number;
  readonly lastFailure: FormulaRenderFailure | undefined;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) backslashes++;
  return backslashes % 2 === 1;
}

function findMatchingBrace(text: string, opening: number): number {
  let depth = 0;
  for (let index = opening; index < text.length; index++) {
    if (isEscaped(text, index)) continue;
    if (text[index] === "{") depth++;
    if (text[index] === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function replaceBracedCommand(
  input: string,
  command: "label" | "tag",
  replacement: (body: string, starred: boolean) => string,
): string {
  let output = input;
  let searchFrom = 0;
  const marker = `\\${command}`;
  while (searchFrom < output.length) {
    const start = output.indexOf(marker, searchFrom);
    if (start < 0) break;
    let cursor = start + marker.length;
    const starred = command === "tag" && output[cursor] === "*";
    if (starred) cursor++;
    if (/[A-Za-z]/.test(output[cursor] ?? "")) {
      searchFrom = cursor;
      continue;
    }
    while (/\s/.test(output[cursor] ?? "")) cursor++;
    if (output[cursor] !== "{") {
      searchFrom = cursor;
      continue;
    }
    const closing = findMatchingBrace(output, cursor);
    if (closing < 0) break;
    const body = output.slice(cursor + 1, closing);
    const rendered = replacement(body, starred);
    output = output.slice(0, start) + rendered + output.slice(closing + 1);
    searchFrom = start + rendered.length;
  }
  return output;
}

function unwrapOuterEnvironment(input: string): string | undefined {
  const opening = /^\\begin\{([^}]+)\}/.exec(input);
  if (!opening || !STRIPPABLE_ENVIRONMENTS.has(opening[1]!)) return undefined;
  const closing = `\\end{${opening[1]!}}`;
  if (!input.endsWith(closing)) return undefined;
  return input.slice(opening[0].length, -closing.length);
}

function normalizeLatex(input: string): string {
  let latex = replaceBracedCommand(input.trim(), "label", () => "");
  latex = replaceBracedCommand(latex, "tag", (body, starred) =>
    starred ? `\\qquad\\mathrm{${body}}` : `\\qquad\\mathrm{(${body})}`,
  )
    .replace(/\\(?:notag|nonumber)\b/g, "")
    .trim();
  for (;;) {
    const body = unwrapOuterEnvironment(latex);
    if (body === undefined) break;
    latex = body.trim();
  }
  return latex;
}

function wrapRenderer(renderer: SvgMathRenderer): TerminalMathRenderer {
  return {
    render(latex, display, color, layout) {
      const normalized = normalizeLatex(latex);
      return normalized ? renderer.render(normalized, display, color, layout) : undefined;
    },
    clear: () => renderer.clear(),
    get cacheSize() {
      return renderer.cacheSize;
    },
    get cacheBytes() {
      return renderer.cacheBytes;
    },
    get lastFailure() {
      return renderer.lastFailure;
    },
  };
}

export async function createTerminalMathRenderer(
  options: SvgMathRendererOptions = {},
): Promise<TerminalMathRenderer> {
  return wrapRenderer(await createSvgMathRenderer(options));
}
