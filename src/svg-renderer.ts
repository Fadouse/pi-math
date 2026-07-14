import { Resvg } from "@resvg/resvg-js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

const MAX_CACHE_ENTRIES = 256;
const MAX_INPUT_LENGTH = 20_000;
const MAX_RASTER_WIDTH = 4096;
const MAX_RASTER_HEIGHT = 4096;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const EX_TO_CELL_HEIGHT = 0.5;
const DEVICE_SCALE = 2;
const DEFAULT_COLOR = "#b5bd68";

export interface FormulaRasterLayout {
  maxWidthCells: number;
  maxHeightCells: number;
  cellWidthPx: number;
  cellHeightPx: number;
}

export interface FormulaRaster {
  base64Data: string;
  widthPx: number;
  heightPx: number;
  columns: number;
  rows: number;
  pixelsPerEx: number;
}

export interface SvgMathRenderer {
  render(
    latex: string,
    display: boolean,
    color: string | undefined,
    layout: FormulaRasterLayout,
  ): FormulaRaster | undefined;
  clear(): void;
  readonly cacheSize: number;
}

function normalizeColor(color: string | undefined): string {
  return color && /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_COLOR;
}

function extractSvg(container: string): string | undefined {
  const start = container.indexOf("<svg");
  const end = container.lastIndexOf("</svg>");
  if (start < 0 || end < start) return undefined;
  return container.slice(start, end + 6);
}

function parseExDimension(svg: string, name: "width" | "height"): number | undefined {
  const match = new RegExp(`\\b${name}="([\\d.]+)ex"`).exec(svg);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]!);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function paddedSvg(
  source: string,
  color: string,
  contentWidth: number,
  contentHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): string | undefined {
  const openingEnd = source.indexOf(">");
  if (openingEnd < 0) return undefined;
  const originalOpening = source.slice(0, openingEnd + 1);
  const cleanedOpening = originalOpening
    .replace(/^<svg\s*/, "")
    .replace(/\s(?:width|height|x|y|color|style)="[^"]*"/g, "")
    .replace(/>$/, "")
    .trim();
  const body = source.slice(openingEnd + 1, -6);
  const x = Math.max(0, (canvasWidth - contentWidth) / 2);
  const y = Math.max(0, (canvasHeight - contentHeight) / 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" color="${color}">`,
    `<svg x="${x}" y="${y}" width="${contentWidth}" height="${contentHeight}" ${cleanedOpening}>`,
    body,
    "</svg>",
    "</svg>",
  ].join("");
}

function normalizedLayout(layout: FormulaRasterLayout): FormulaRasterLayout {
  return {
    maxWidthCells: Math.max(1, Math.floor(layout.maxWidthCells)),
    maxHeightCells: Math.max(1, Math.floor(layout.maxHeightCells)),
    cellWidthPx: Math.max(1, layout.cellWidthPx),
    cellHeightPx: Math.max(1, layout.cellHeightPx),
  };
}

function cacheSet(
  cache: Map<string, FormulaRaster | null>,
  key: string,
  value: FormulaRaster | null,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function createSvgMathRenderer(): Promise<SvgMathRenderer> {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const packages = AllPackages.filter(
    (name) => name !== "noerrors" && name !== "noundefined",
  );
  const input = new TeX({
    packages,
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  });
  const output = new SVG({ fontCache: "none" });
  const document = mathjax.document("", { InputJax: input, OutputJax: output });
  const cache = new Map<string, FormulaRaster | null>();

  const render = (
    source: string,
    display: boolean,
    requestedColor: string | undefined,
    requestedLayout: FormulaRasterLayout,
  ): FormulaRaster | undefined => {
    const latex = source.trim();
    if (!latex || latex.length > MAX_INPUT_LENGTH) return undefined;
    const color = normalizeColor(requestedColor);
    const layout = normalizedLayout(requestedLayout);
    const key = [
      display ? "display" : "inline",
      color,
      layout.maxWidthCells,
      layout.maxHeightCells,
      layout.cellWidthPx,
      layout.cellHeightPx,
      latex,
    ].join(":");
    if (cache.has(key)) {
      const cached = cache.get(key)!;
      cache.delete(key);
      cache.set(key, cached);
      return cached ?? undefined;
    }

    try {
      input.reset();
      const node = document.convert(latex, { display });
      const container = adaptor.outerHTML(node);
      const sourceSvg = extractSvg(container);
      if (!sourceSvg || sourceSvg.includes('data-mml-node="merror"')) {
        cacheSet(cache, key, null);
        return undefined;
      }
      const widthEx = parseExDimension(sourceSvg, "width");
      const heightEx = parseExDimension(sourceSvg, "height");
      if (!widthEx || !heightEx) {
        cacheSet(cache, key, null);
        return undefined;
      }

      const basePixelsPerEx = layout.cellHeightPx * EX_TO_CELL_HEIGHT;
      const maxContentWidth = layout.maxWidthCells * layout.cellWidthPx;
      const widthLimited = widthEx * basePixelsPerEx > maxContentWidth;
      const pixelsPerEx = widthLimited
        ? maxContentWidth / widthEx
        : basePixelsPerEx;
      const columns = widthLimited
        ? layout.maxWidthCells
        : Math.max(1, Math.ceil((widthEx * pixelsPerEx) / layout.cellWidthPx));
      const rows = Math.max(
        1,
        Math.ceil((heightEx * pixelsPerEx) / layout.cellHeightPx),
      );
      if (rows > layout.maxHeightCells) {
        cacheSet(cache, key, null);
        return undefined;
      }
      const contentWidth = widthEx * pixelsPerEx * DEVICE_SCALE;
      const contentHeight = heightEx * pixelsPerEx * DEVICE_SCALE;
      const canvasWidth = Math.ceil(columns * layout.cellWidthPx * DEVICE_SCALE);
      const canvasHeight = Math.ceil(rows * layout.cellHeightPx * DEVICE_SCALE);
      if (
        canvasWidth > MAX_RASTER_WIDTH ||
        canvasHeight > MAX_RASTER_HEIGHT ||
        contentWidth > canvasWidth + 1 ||
        contentHeight > canvasHeight + 1
      ) {
        cacheSet(cache, key, null);
        return undefined;
      }

      const svg = paddedSvg(
        sourceSvg,
        color,
        contentWidth,
        contentHeight,
        canvasWidth,
        canvasHeight,
      );
      if (!svg) {
        cacheSet(cache, key, null);
        return undefined;
      }
      const raster = new Resvg(svg, {
        font: { loadSystemFonts: false },
        shapeRendering: 2,
        textRendering: 2,
        logLevel: "error",
      }).render();
      if (
        raster.width !== canvasWidth ||
        raster.height !== canvasHeight ||
        raster.width > MAX_RASTER_WIDTH ||
        raster.height > MAX_RASTER_HEIGHT
      ) {
        cacheSet(cache, key, null);
        return undefined;
      }
      const png = raster.asPng();
      if (png.byteLength > MAX_PNG_BYTES) {
        cacheSet(cache, key, null);
        return undefined;
      }

      const result: FormulaRaster = {
        base64Data: png.toString("base64"),
        widthPx: raster.width,
        heightPx: raster.height,
        columns,
        rows,
        pixelsPerEx,
      };
      cacheSet(cache, key, result);
      return result;
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
