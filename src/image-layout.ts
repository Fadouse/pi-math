import { getCapabilities, renderImage } from "@earendil-works/pi-tui";
import { kittyPlaceholderSupport, renderKittyVirtualImage } from "./kitty-graphics.js";
import type { FormulaRaster } from "./svg-renderer.js";

export interface FormulaImagePlacement {
  marker: string;
  imageId: number;
  raster: FormulaRaster;
  inline: boolean;
  fallbackText: string;
}

export interface FormulaImageArea {
  renderWidth: number;
  paddingX: number;
}

function renderNativeImage(placement: FormulaImagePlacement) {
  return renderImage(
    placement.raster.base64Data,
    {
      widthPx: placement.raster.widthPx,
      heightPx: placement.raster.heightPx,
    },
    {
      maxWidthCells: placement.raster.columns,
      maxHeightCells: placement.raster.rows,
      imageId: placement.imageId,
      moveCursor: false,
    },
  );
}

function renderBlockPlacement(
  placement: FormulaImagePlacement,
  area: FormulaImageArea,
): string[] | undefined {
  const capabilities = getCapabilities();
  if (!capabilities.images) return undefined;

  const contentWidth = Math.max(1, area.renderWidth - area.paddingX * 2);
  if (placement.raster.columns > contentWidth) return undefined;
  const rendered = renderNativeImage(placement);
  if (!rendered) return undefined;

  const left =
    area.paddingX + Math.max(0, Math.floor((contentWidth - placement.raster.columns) / 2));
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

/** Place a one-row Kitty image without changing the surrounding text flow. */
function renderInlinePlacement(placement: FormulaImagePlacement): string | undefined {
  if (getCapabilities().images !== "kitty" || placement.raster.rows !== 1) return undefined;

  if (kittyPlaceholderSupport()) {
    const virtual = renderKittyVirtualImage(
      placement.raster.base64Data,
      placement.imageId,
      placement.raster.columns,
      1,
    );
    if (virtual) return `${virtual.sequence}${virtual.placeholders[0]}`;
  }

  // Compatibility path for Kitty-protocol terminals without Unicode placeholders.
  const rendered = renderNativeImage(placement);
  if (!rendered || rendered.rows !== 1) return undefined;
  const columns = placement.raster.columns;
  return `${" ".repeat(columns)}\x1b[${columns}D${rendered.sequence}\x1b[${columns}C`;
}

/** Replace generated Markdown markers with terminal-native image placements. */
export function insertFormulaImages(
  lines: string[],
  placements: FormulaImagePlacement[],
  area: FormulaImageArea,
): string[] {
  if (placements.length === 0) return lines;
  const output: string[] = [];
  const blockPlacements = placements.filter(({ inline }) => !inline);
  const inlinePlacements = placements.filter(({ inline }) => inline);

  for (const line of lines) {
    const block = blockPlacements.find(({ marker }) => line.includes(marker));
    if (block) {
      const imageLines = renderBlockPlacement(block, area);
      output.push(
        ...(imageLines ?? [line.replace(block.marker, () => block.fallbackText)]),
      );
      continue;
    }

    let renderedLine = line;
    for (const placement of inlinePlacements) {
      if (!renderedLine.includes(placement.marker)) continue;
      const image = renderInlinePlacement(placement) ?? placement.fallbackText;
      renderedLine = renderedLine.replace(placement.marker, () => image);
    }
    output.push(renderedLine);
  }

  return output;
}
