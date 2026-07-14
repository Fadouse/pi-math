import {
  getCapabilities,
  renderImage,
} from "@earendil-works/pi-tui";
import type { FormulaRaster } from "./svg-renderer.js";

export interface FormulaImagePlacement {
  marker: string;
  imageId: number;
  raster: FormulaRaster;
}

export interface FormulaImageArea {
  renderWidth: number;
  paddingX: number;
}

function renderPlacement(
  placement: FormulaImagePlacement,
  area: FormulaImageArea,
): string[] | undefined {
  const capabilities = getCapabilities();
  if (!capabilities.images) return undefined;

  const contentWidth = Math.max(1, area.renderWidth - area.paddingX * 2);
  if (placement.raster.columns > contentWidth) return undefined;
  const dimensions = {
    widthPx: placement.raster.widthPx,
    heightPx: placement.raster.heightPx,
  };
  const rendered = renderImage(placement.raster.base64Data, dimensions, {
    maxWidthCells: placement.raster.columns,
    maxHeightCells: placement.raster.rows,
    imageId: placement.imageId,
    moveCursor: false,
  });
  if (!rendered) return undefined;

  const left =
    area.paddingX +
    Math.max(0, Math.floor((contentWidth - placement.raster.columns) / 2));
  const prefix = " ".repeat(left);
  if (capabilities.images === "kitty") {
    return [
      `${prefix}${rendered.sequence}`,
      ...Array.from({ length: Math.max(0, rendered.rows - 1) }, () => ""),
    ];
  }

  const rowOffset = Math.max(0, rendered.rows - 1);
  const moveUp = rowOffset > 0 ? `\x1b[${rowOffset}A` : "";
  return [
    ...Array.from({ length: rowOffset }, () => ""),
    `${prefix}${moveUp}${rendered.sequence}`,
  ];
}

/** Replace generated Markdown marker rows with terminal-native image rows. */
export function insertFormulaImages(
  lines: string[],
  placements: FormulaImagePlacement[],
  area: FormulaImageArea,
): string[] {
  if (placements.length === 0) return lines;
  const output: string[] = [];

  for (const line of lines) {
    const placement = placements.find(({ marker }) => line.includes(marker));
    if (!placement) {
      output.push(line);
      continue;
    }
    const imageLines = renderPlacement(placement, area);
    output.push(...(imageLines ?? [line]));
  }
  return output;
}
