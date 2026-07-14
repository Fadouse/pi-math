export const GENERATED_MATH_LANGUAGE = "pi-math-4f9c";

export interface MathRenderResult {
  text: string;
  forceBlock?: boolean;
}

export type MathRender = (latex: string, display: boolean) => string | undefined;
export type MathReplacementRender = (
  latex: string,
  display: boolean,
) => string | MathRenderResult | undefined;

const BLOCK_ENVIRONMENT_PATTERN =
  /^\\begin\{(equation\*?|displaymath|math|align\*?|alignat\*?|flalign\*?|gather\*?|multline\*?|split|aligned|alignedat|gathered|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases)\}/;

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function countRun(text: string, index: number, character: string): number {
  let end = index;
  while (text[end] === character) end++;
  return end - index;
}

function isFencePrefix(prefix: string): boolean {
  return /^(?:(?:[ \t]*>[ \t]?)*[ \t]*)$/.test(prefix);
}

/** Return the first index after a fenced Markdown code block, if one starts here. */
function skipFencedCode(text: string, index: number): number | undefined {
  const character = text[index];
  if (character !== "`" && character !== "~") return undefined;

  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  if (!isFencePrefix(text.slice(lineStart, index))) return undefined;

  const openingLength = countRun(text, index, character);
  if (openingLength < 3) return undefined;

  const openingLineEnd = text.indexOf("\n", index + openingLength);
  if (openingLineEnd < 0) return text.length;

  let nextLineStart = openingLineEnd + 1;
  while (nextLineStart <= text.length) {
    const nextLineEnd = text.indexOf("\n", nextLineStart);
    const lineEnd = nextLineEnd < 0 ? text.length : nextLineEnd;
    const line = text.slice(nextLineStart, lineEnd).replace(/\r$/, "");
    const match = /^(?:(?:[ \t]*>[ \t]?)*[ \t]*)(`+|~+)[ \t]*$/.exec(line);

    if (match) {
      const closingRun = match[1]!;
      if (closingRun[0] === character && closingRun.length >= openingLength) {
        return nextLineEnd < 0 ? text.length : nextLineEnd + 1;
      }
    }

    if (nextLineEnd < 0) break;
    nextLineStart = nextLineEnd + 1;
  }

  return text.length;
}

function markdownLineContent(line: string): string {
  return line.replace(/^(?: {0,3}>[ \t]?)+/, "");
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(markdownLineContent(line));
}

/** Return the first index after a Markdown indented code block. */
function skipIndentedCode(text: string, index: number): number | undefined {
  if (index > 0 && text[index - 1] !== "\n") return undefined;

  const firstLineEnd = text.indexOf("\n", index);
  const firstEnd = firstLineEnd < 0 ? text.length : firstLineEnd;
  const firstLine = text.slice(index, firstEnd).replace(/\r$/, "");
  if (!isIndentedCodeLine(firstLine) || markdownLineContent(firstLine).trim() === "") {
    return undefined;
  }

  let lineStart = index;
  while (lineStart < text.length) {
    const nextLineEnd = text.indexOf("\n", lineStart);
    const lineEnd = nextLineEnd < 0 ? text.length : nextLineEnd;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    const content = markdownLineContent(line);

    if (content.trim() !== "" && !isIndentedCodeLine(line)) return lineStart;
    if (nextLineEnd < 0) return text.length;
    lineStart = nextLineEnd + 1;
  }

  return text.length;
}

/** Return the first index after an inline Markdown code span. */
function skipInlineCode(text: string, index: number): number {
  const runLength = countRun(text, index, "`");
  const marker = "`".repeat(runLength);
  let searchFrom = index + runLength;

  while (searchFrom < text.length) {
    const closing = text.indexOf(marker, searchFrom);
    if (closing < 0) return index + runLength;

    const hasBacktickBefore = closing > 0 && text[closing - 1] === "`";
    const hasBacktickAfter = text[closing + runLength] === "`";
    if (!hasBacktickBefore && !hasBacktickAfter) {
      return closing + runLength;
    }
    searchFrom = closing + 1;
  }

  return index + runLength;
}

function skipHtmlCode(text: string, lowerText: string, index: number): number | undefined {
  const opening = /^<(code|pre)(?:\s|>)/i.exec(text.slice(index));
  if (!opening) return undefined;

  const openingEnd = text.indexOf(">", index + opening[0].length - 1);
  if (openingEnd < 0) return text.length;

  const closingTag = `</${opening[1]!.toLowerCase()}>`;
  const closing = lowerText.indexOf(closingTag, openingEnd + 1);
  return closing < 0 ? text.length : closing + closingTag.length;
}

function findUnescapedSequence(text: string, sequence: string, from: number): number {
  let searchFrom = from;
  while (searchFrom < text.length) {
    const found = text.indexOf(sequence, searchFrom);
    if (found < 0) return -1;
    if (!isEscaped(text, found)) return found;
    searchFrom = found + sequence.length;
  }
  return -1;
}

function isInlineDollarOpener(text: string, index: number): boolean {
  if (isEscaped(text, index) || text[index + 1] === "$" || index + 1 >= text.length) {
    return false;
  }
  return !/\s/u.test(text[index + 1]!);
}

function findInlineDollarCloser(text: string, from: number): number {
  for (let index = from; index < text.length; index++) {
    const character = text[index];
    if (character === "\n" || character === "\r") return -1;
    if (character !== "$" || isEscaped(text, index)) continue;

    if (text[index + 1] === "$" || text[index - 1] === "$" || /\s/u.test(text[index - 1] ?? "")) {
      continue;
    }

    const next = text[index + 1];
    if (next !== undefined && /\d/u.test(next)) continue;
    return index;
  }
  return -1;
}

function containsUnescapedDollar(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "$" && !isEscaped(text, index)) return true;
  }
  return false;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

function inlineCodeSpan(text: string): string {
  const fence = "`".repeat(Math.max(1, longestBacktickRun(text) + 1));
  const needsPadding =
    text.startsWith(" ") || text.endsWith(" ") || text.startsWith("`") || text.endsWith("`");
  const padding = needsPadding ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

function displayCodeBlock(text: string): string {
  const fence = "`".repeat(Math.max(4, longestBacktickRun(text) + 1));
  return `\n\n${fence}${GENERATED_MATH_LANGUAGE}\n${text}\n${fence}\n\n`;
}

function replacementFor(
  latex: string,
  display: boolean,
  renderMath: MathReplacementRender,
): string | undefined {
  if (!latex.trim()) return undefined;

  let rendered: string | MathRenderResult | undefined;
  try {
    rendered = renderMath(latex, display);
  } catch {
    return undefined;
  }

  if (!rendered) return undefined;
  const result = typeof rendered === "string" ? { text: rendered, forceBlock: false } : rendered;
  const normalized = result.text.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!normalized.trim()) return undefined;

  return display || result.forceBlock || normalized.includes("\n")
    ? displayCodeBlock(normalized)
    : inlineCodeSpan(normalized);
}

export function containsPotentialMath(markdown: string): boolean {
  return (
    markdown.includes("$") ||
    markdown.includes("\\(") ||
    markdown.includes("\\[") ||
    markdown.includes("\\begin{")
  );
}

/**
 * Replace complete LaTeX spans outside Markdown/HTML code with terminal-safe
 * Markdown. Failed or incomplete formulas are left byte-for-byte unchanged.
 */
export function expandMathInMarkdown(markdown: string, renderMath: MathReplacementRender): string {
  if (!containsPotentialMath(markdown)) return markdown;

  const lowerMarkdown = markdown.toLowerCase();
  const chunks: string[] = [];
  let copiedThrough = 0;
  let index = 0;

  const replace = (start: number, end: number, replacement: string): void => {
    chunks.push(markdown.slice(copiedThrough, start), replacement);
    copiedThrough = end;
    index = end;
  };

  while (index < markdown.length) {
    const character = markdown[index]!;

    const indentedCodeEnd = skipIndentedCode(markdown, index);
    if (indentedCodeEnd !== undefined) {
      index = indentedCodeEnd;
      continue;
    }

    const fencedCodeEnd = skipFencedCode(markdown, index);
    if (fencedCodeEnd !== undefined) {
      index = fencedCodeEnd;
      continue;
    }

    if (character === "`") {
      index = skipInlineCode(markdown, index);
      continue;
    }

    if (character === "<") {
      const htmlCodeEnd = skipHtmlCode(markdown, lowerMarkdown, index);
      if (htmlCodeEnd !== undefined) {
        index = htmlCodeEnd;
        continue;
      }
    }

    if (character === "$" && !isEscaped(markdown, index)) {
      if (markdown[index + 1] === "$") {
        const closing = findUnescapedSequence(markdown, "$$", index + 2);
        if (closing >= 0) {
          const end = closing + 2;
          const replacement = replacementFor(markdown.slice(index + 2, closing), true, renderMath);
          if (replacement !== undefined) {
            replace(index, end, replacement);
          } else {
            index = end;
          }
          continue;
        }
        index += 2;
        continue;
      }

      if (isInlineDollarOpener(markdown, index)) {
        const closing = findInlineDollarCloser(markdown, index + 1);
        if (closing >= 0) {
          const latex = markdown.slice(index + 1, closing);
          // An unescaped dollar inside the candidate means this opener most
          // likely belongs to currency/plain text that ran into a later formula.
          if (containsUnescapedDollar(latex)) {
            index++;
            continue;
          }

          const end = closing + 1;
          const replacement = replacementFor(latex, false, renderMath);
          if (replacement !== undefined) {
            replace(index, end, replacement);
          } else {
            index = end;
          }
          continue;
        }
      }
    }

    if (character === "\\" && !isEscaped(markdown, index)) {
      const delimiter = markdown[index + 1];
      if (delimiter === "(" || delimiter === "[") {
        const closingSequence = delimiter === "(" ? "\\)" : "\\]";
        const closing = findUnescapedSequence(markdown, closingSequence, index + 2);
        if (closing >= 0) {
          const end = closing + 2;
          const display = delimiter === "[";
          const replacement = replacementFor(markdown.slice(index + 2, closing), display, renderMath);
          if (replacement !== undefined) {
            replace(index, end, replacement);
          } else {
            index = end;
          }
          continue;
        }
      }

      const environment = BLOCK_ENVIRONMENT_PATTERN.exec(markdown.slice(index));
      if (environment) {
        const environmentName = environment[1]!;
        const closingSequence = `\\end{${environmentName}}`;
        const closing = markdown.indexOf(closingSequence, index + environment[0].length);
        if (closing >= 0) {
          const end = closing + closingSequence.length;
          const display = environmentName !== "math";
          const replacement = replacementFor(markdown.slice(index, end), display, renderMath);
          if (replacement !== undefined) {
            replace(index, end, replacement);
          } else {
            index = end;
          }
          continue;
        }
      }
    }

    index++;
  }

  if (copiedThrough === 0) return markdown;
  chunks.push(markdown.slice(copiedThrough));
  return chunks.join("");
}

function stripSgr(text: string): string {
  return text.replace(/\x1b\[[0-9;:]*m/g, "");
}

/** Remove synthetic fences and their Markdown-only vertical margins. */
export function stripGeneratedMathFenceLines(lines: string[]): string[] {
  const output: string[] = [];
  let insideGeneratedMath = false;
  let suppressFollowingBlankLines = false;

  for (const line of lines) {
    const plain = stripSgr(line).trim();
    if (!insideGeneratedMath && plain === `\`\`\`${GENERATED_MATH_LANGUAGE}`) {
      while (output.length > 0 && stripSgr(output.at(-1)!).trim() === "") output.pop();
      insideGeneratedMath = true;
      suppressFollowingBlankLines = false;
      continue;
    }
    if (insideGeneratedMath && plain === "```") {
      insideGeneratedMath = false;
      suppressFollowingBlankLines = true;
      continue;
    }
    if (!insideGeneratedMath && suppressFollowingBlankLines && plain === "") continue;
    suppressFollowingBlankLines = false;
    output.push(line);
  }

  return output;
}
