import { visibleWidth } from "@earendil-works/pi-tui";

/** Center a rendered formula rectangle without disturbing its internal layout. */
export function centerMathBlock(output: string, availableWidth: number): string {
  const lines = output.split("\n");
  const blockWidth = Math.max(0, ...lines.map((line) => visibleWidth(line)));
  const width = Math.max(1, Math.floor(availableWidth));
  if (blockWidth === 0 || blockWidth >= width) return output;

  const leftPadding = " ".repeat(Math.floor((width - blockWidth) / 2));
  return lines.map((line) => `${leftPadding}${line}`).join("\n");
}
