import { visibleWidth } from "@earendil-works/pi-tui";
import { createRender, loadInstance, type RenderFunction } from "libtexprintf";
import type { MathRender } from "./transform.js";

const MAX_CACHE_ENTRIES = 512;
const MAX_INPUT_LENGTH = 20_000;
const MAX_OUTPUT_LINES = 80;
const MAX_OUTPUT_WIDTH = 400;
const STRIPPABLE_ENVIRONMENTS = new Set(["equation", "equation*", "displaymath", "math"]);

export interface TerminalMathRenderer {
  render: MathRender;
  clear(): void;
  readonly cacheSize: number;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) {
    backslashes++;
  }
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

function removeAnnotationCommand(input: string, command: "label" | "tag"): string {
  let output = input;
  let searchFrom = 0;
  const marker = `\\${command}`;

  while (searchFrom < output.length) {
    const start = output.indexOf(marker, searchFrom);
    if (start < 0) break;

    let cursor = start + marker.length;
    if (command === "tag" && output[cursor] === "*") cursor++;
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
    output = output.slice(0, start) + output.slice(closing + 1);
    searchFrom = start;
  }

  return output;
}

interface UnwrappedCommand {
  body: string;
  suffix: string;
}

function unwrapLeadingCommand(input: string, command: string): UnwrappedCommand | undefined {
  const marker = `\\${command}`;
  if (!input.startsWith(marker)) return undefined;

  let cursor = marker.length;
  if (/[A-Za-z]/.test(input[cursor] ?? "")) return undefined;
  while (/\s/.test(input[cursor] ?? "")) cursor++;
  if (input[cursor] !== "{") return undefined;

  const closing = findMatchingBrace(input, cursor);
  if (closing < 0) return undefined;
  return {
    body: input.slice(cursor + 1, closing),
    suffix: input.slice(closing + 1),
  };
}

function unwrapWholeCommand(input: string, command: string): string | undefined {
  const unwrapped = unwrapLeadingCommand(input, command);
  if (!unwrapped || unwrapped.suffix.trim() !== "") return undefined;
  return unwrapped.body;
}

function unwrapOuterEnvironment(input: string): string | undefined {
  const opening = /^\\begin\{([^}]+)\}/.exec(input);
  if (!opening || !STRIPPABLE_ENVIRONMENTS.has(opening[1]!)) return undefined;

  const closing = `\\end{${opening[1]!}}`;
  if (!input.endsWith(closing)) return undefined;
  return input.slice(opening[0].length, -closing.length);
}

function normalizeLatex(input: string): { latex: string; boxDepth: number; suffix: string } {
  let latex = removeAnnotationCommand(removeAnnotationCommand(input.trim(), "label"), "tag")
    .replace(/\\(?:notag|nonumber)\b/g, "")
    .trim();
  let boxDepth = 0;
  let suffix = "";

  for (;;) {
    const environmentBody = unwrapOuterEnvironment(latex);
    if (environmentBody !== undefined) {
      latex = environmentBody.trim();
      continue;
    }

    // libtexprintf does not implement \\boxed. Render its body, draw the box
    // ourselves, and keep punctuation such as the final period outside it.
    if (!suffix) {
      const leadingBox = unwrapLeadingCommand(latex, "boxed");
      if (leadingBox && leadingBox.suffix.trim() !== "") {
        boxDepth++;
        latex = leadingBox.body.trim();
        suffix = leadingBox.suffix.trim();
        continue;
      }
    }

    const boxedBody = unwrapWholeCommand(latex, "boxed");
    if (boxedBody !== undefined) {
      boxDepth++;
      latex = boxedBody.trim();
      continue;
    }

    break;
  }

  return { latex, boxDepth, suffix };
}

function cleanOutput(output: string): string {
  const lines = output.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
  return lines.map((line) => line.replace(/[ \t]+$/g, "")).join("\n");
}

function drawBox(content: string): string {
  const lines = content.split("\n");
  const width = Math.max(1, ...lines.map((line) => visibleWidth(line)));
  const top = `┌${"─".repeat(width + 2)}┐`;
  const bottom = `└${"─".repeat(width + 2)}┘`;
  const body = lines.map((line) => {
    const padding = " ".repeat(Math.max(0, width - visibleWidth(line)));
    return `│ ${line}${padding} │`;
  });
  return [top, ...body, bottom].join("\n");
}

function appendSuffixAtBaseline(content: string, suffix: string): string | undefined {
  if (suffix.includes("\n")) return undefined;
  const lines = content.split("\n");
  const baseline = Math.floor((lines.length - 1) / 2);
  lines[baseline] = `${lines[baseline]!}${suffix}`;
  return lines.join("\n");
}

function withinOutputLimits(output: string): boolean {
  const lines = output.split("\n");
  return (
    lines.length <= MAX_OUTPUT_LINES &&
    lines.every((line) => visibleWidth(line) <= MAX_OUTPUT_WIDTH)
  );
}

function cacheSet(cache: Map<string, string | null>, key: string, value: string | null): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function createCachedRenderer(renderTex: RenderFunction): TerminalMathRenderer {
  const cache = new Map<string, string | null>();

  const render: MathRender = (input) => {
    const key = input.trim();
    if (!key || key.length > MAX_INPUT_LENGTH) return undefined;

    if (cache.has(key)) {
      const cached = cache.get(key)!;
      cache.delete(key);
      cache.set(key, cached);
      return cached ?? undefined;
    }

    const { latex, boxDepth, suffix } = normalizeLatex(key);
    if (!latex) {
      cacheSet(cache, key, null);
      return undefined;
    }

    try {
      const result = renderTex(latex);
      if (result.errors.length > 0) {
        cacheSet(cache, key, null);
        return undefined;
      }

      let output = cleanOutput(result.output);
      if (!output) {
        cacheSet(cache, key, null);
        return undefined;
      }
      for (let depth = 0; depth < boxDepth; depth++) output = drawBox(output);

      if (suffix) {
        const suffixResult = renderTex(suffix);
        if (suffixResult.errors.length > 0) {
          cacheSet(cache, key, null);
          return undefined;
        }
        const suffixOutput = cleanOutput(suffixResult.output);
        const combined = appendSuffixAtBaseline(output, suffixOutput);
        if (!suffixOutput || combined === undefined) {
          cacheSet(cache, key, null);
          return undefined;
        }
        output = combined;
      }

      if (!withinOutputLimits(output)) {
        cacheSet(cache, key, null);
        return undefined;
      }

      cacheSet(cache, key, output);
      return output;
    } catch {
      cacheSet(cache, key, null);
      return undefined;
    }
  };

  return {
    render,
    clear: () => cache.clear(),
    get cacheSize() {
      return cache.size;
    },
  };
}

export async function createTerminalMathRenderer(): Promise<TerminalMathRenderer> {
  const instance = await loadInstance();
  const renderTex = createRender(instance);
  return createCachedRenderer(renderTex);
}
