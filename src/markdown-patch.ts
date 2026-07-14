import {
  Markdown,
  allocateImageId,
  getCapabilities,
  getCellDimensions,
} from "@earendil-works/pi-tui";
import { insertFormulaImages, type FormulaImagePlacement } from "./image-layout.js";
import type { TerminalMathRenderer } from "./renderer.js";
import {
  containsPotentialMath,
  expandMathInMarkdown,
  stripGeneratedMathFenceLines,
} from "./transform.js";

const DEFAULT_FORMULA_COLOR = "#b5bd68";
const MAX_FORMULA_HEIGHT_CELLS = 32;

type MarkdownInternals = {
  text: string;
  paddingX?: number;
  theme?: {
    codeBlock?: (text: string) => string;
  };
};

type MarkdownRender = (this: Markdown, width: number) => string[];

interface CachedTransform {
  source: string;
  layoutKey: string;
  transformed: string;
  placements: FormulaImagePlacement[];
}

export interface MathPatchController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  clearTransformCache(): void;
  uninstall(): void;
}

function formulaColor(markdown: MarkdownInternals): string {
  const styled = markdown.theme?.codeBlock?.("x") ?? "";
  const trueColor = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(styled);
  if (!trueColor) return DEFAULT_FORMULA_COLOR;

  return `#${trueColor
    .slice(1, 4)
    .map((component) => Number(component).toString(16).padStart(2, "0"))
    .join("")}`;
}

function imageMarker(imageId: number, index: number): string {
  return `__PI_MATH_IMAGE_${imageId}_${index}__`;
}

/**
 * Install a reversible display-only wrapper around Pi's Markdown renderer.
 * The source Markdown is restored before render() returns, so session history
 * and provider context always retain the original LaTeX.
 */
export function installMarkdownMathPatch(renderer: TerminalMathRenderer): MathPatchController {
  const originalRender = Markdown.prototype.render;
  let enabled = true;
  let installed = true;
  let transformCache = new WeakMap<Markdown, CachedTransform>();

  const patchedRender: MarkdownRender = function (width: number): string[] {
    const markdown = this as unknown as MarkdownInternals;
    const source = markdown.text;
    if (
      !enabled ||
      !getCapabilities().images ||
      typeof source !== "string" ||
      !containsPotentialMath(source)
    ) {
      return originalRender.call(this, width);
    }

    const paddingX =
      typeof markdown.paddingX === "number" && Number.isFinite(markdown.paddingX)
        ? Math.max(0, markdown.paddingX)
        : 0;
    const color = formulaColor(markdown);
    const cells = getCellDimensions();
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutKey = `${width}:${paddingX}:${color}:${cells.widthPx}:${cells.heightPx}`;

    let transformed: string;
    let placements: FormulaImagePlacement[];
    const cached = transformCache.get(this);
    if (cached?.source === source && cached.layoutKey === layoutKey) {
      ({ transformed, placements } = cached);
    } else {
      placements = [];
      transformed = expandMathInMarkdown(source, (latex, display) => {
        const raster = renderer.render(latex, display, color, {
          maxWidthCells: contentWidth,
          maxHeightCells: MAX_FORMULA_HEIGHT_CELLS,
          cellWidthPx: cells.widthPx,
          cellHeightPx: cells.heightPx,
        });
        if (!raster) return undefined;

        const imageId = allocateImageId();
        const marker = imageMarker(imageId, placements.length);
        placements.push({ marker, imageId, raster });
        return { text: marker, forceBlock: true };
      });
      transformCache.set(this, { source, layoutKey, transformed, placements });
    }

    if (transformed === source || placements.length === 0) {
      return originalRender.call(this, width);
    }

    markdown.text = transformed;
    try {
      const textLines = stripGeneratedMathFenceLines(originalRender.call(this, width));
      return insertFormulaImages(textLines, placements, { renderWidth: width, paddingX });
    } finally {
      markdown.text = source;
    }
  };

  Markdown.prototype.render = patchedRender;
  return {
    isEnabled: () => enabled,
    setEnabled(value: boolean) {
      enabled = value;
    },
    clearTransformCache() {
      transformCache = new WeakMap();
    },
    uninstall() {
      enabled = false;
      transformCache = new WeakMap();
      if (installed && Markdown.prototype.render === patchedRender) {
        Markdown.prototype.render = originalRender;
      }
      installed = false;
    },
  };
}
