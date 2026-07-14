import { Resvg } from "@resvg/resvg-js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { SafeHandler } from "mathjax-full/js/ui/safe/SafeHandler.js";
import { WeightedLruCache } from "./lru-cache.js";

const MAX_INPUT_LENGTH = 20_000;
const MAX_RASTER_WIDTH = 4096;
const MAX_RASTER_HEIGHT = 4096;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MAX_SVG_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_RASTER_CACHE_BYTES = 64 * 1024 * 1024;
const BASE_EX_TO_CELL_HEIGHT = 0.5;
const PREFERRED_DEVICE_SCALE = 2;
const CONTENT_BLEED_PX = 1;
const DEFAULT_COLOR = "#b5bd68";

export type TeXDefinitionMap = Record<string, string | unknown[]>;

export interface SvgMathRendererOptions {
  macros?: TeXDefinitionMap;
  environments?: TeXDefinitionMap;
  fontFiles?: string[];
  loadSystemFonts?: boolean;
}

export interface FormulaRasterLayout {
  maxWidthCells: number;
  maxHeightCells: number;
  cellWidthPx: number;
  cellHeightPx: number;
  fitHeight?: boolean;
}

export interface FormulaInkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FormulaRaster {
  base64Data: string;
  widthPx: number;
  heightPx: number;
  columns: number;
  rows: number;
  pixelsPerEx: number;
  deviceScale: number;
  inkBounds: FormulaInkBounds;
}

export type FormulaRenderFailureCode =
  | "empty-input"
  | "input-too-long"
  | "tex-error"
  | "invalid-svg"
  | "invalid-dimensions"
  | "height-limit"
  | "raster-limit"
  | "raster-error"
  | "empty-raster"
  | "clipped-raster"
  | "png-limit";

export interface FormulaRenderFailure {
  code: FormulaRenderFailureCode;
  message: string;
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
  readonly cacheBytes: number;
  readonly lastFailure: FormulaRenderFailure | undefined;
}

interface SvgFormula {
  source: string;
  widthEx: number;
  heightEx: number;
}

type SvgCacheValue = SvgFormula | FormulaRenderFailure;
type RasterCacheValue = FormulaRaster | FormulaRenderFailure;

function isFailure(value: SvgCacheValue | RasterCacheValue): value is FormulaRenderFailure {
  return "code" in value;
}

function failure(code: FormulaRenderFailureCode, message: string): FormulaRenderFailure {
  return { code, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cacheWeight(value: string | FormulaRenderFailure): number {
  return typeof value === "string" ? value.length * 2 : value.message.length * 2 + 64;
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
    .replace(/\s(?:width|height|x|y|color|style|overflow)="[^"]*"/g, "")
    .replace(/>$/, "")
    .trim();
  const body = source.slice(openingEnd + 1, -6);
  const x = Math.max(0, (canvasWidth - contentWidth) / 2);
  const y = Math.max(0, (canvasHeight - contentHeight) / 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" color="${color}">`,
    `<svg x="${x}" y="${y}" width="${contentWidth}" height="${contentHeight}" overflow="visible" ${cleanedOpening}>`,
    body,
    "</svg>",
    "</svg>",
  ].join("");
}

function normalizedLayout(layout: FormulaRasterLayout): Required<FormulaRasterLayout> {
  return {
    maxWidthCells: Math.max(1, Math.floor(layout.maxWidthCells)),
    maxHeightCells: Math.max(1, Math.floor(layout.maxHeightCells)),
    cellWidthPx: Math.max(1, layout.cellWidthPx),
    cellHeightPx: Math.max(1, layout.cellHeightPx),
    fitHeight: layout.fitHeight ?? false,
  };
}

function alphaBounds(
  pixels: Buffer,
  width: number,
  height: number,
): FormulaInkBounds | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let offset = 3, pixel = 0; offset < pixels.length; offset += 4, pixel++) {
    if (pixels[offset] === 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return maxX < 0
    ? undefined
    : { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

function chooseDeviceScale(logicalWidth: number, logicalHeight: number): number | undefined {
  if (
    logicalWidth * PREFERRED_DEVICE_SCALE <= MAX_RASTER_WIDTH &&
    logicalHeight * PREFERRED_DEVICE_SCALE <= MAX_RASTER_HEIGHT
  ) {
    return PREFERRED_DEVICE_SCALE;
  }
  if (logicalWidth <= MAX_RASTER_WIDTH && logicalHeight <= MAX_RASTER_HEIGHT) return 1;
  return undefined;
}

export async function createSvgMathRenderer(
  options: SvgMathRendererOptions = {},
): Promise<SvgMathRenderer> {
  const adaptor = liteAdaptor({
    cjkCharWidth: 1,
    unknownCharWidth: 0.6,
    unknownCharHeight: 0.8,
  });
  SafeHandler(RegisterHTMLHandler(adaptor));
  const disabledPackages = new Set(["html", "noerrors", "noundefined"]);
  const packages = AllPackages.filter((name) => !disabledPackages.has(name));
  const input = new TeX({
    packages,
    maxBuffer: MAX_INPUT_LENGTH,
    maxMacros: 1_000,
    macros: options.macros ?? {},
    environments: options.environments ?? {},
    tags: "none",
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  });
  const output = new SVG({
    fontCache: "none",
    mtextInheritFont: true,
    unknownFamily: "serif",
  });
  const document = mathjax.document("", {
    InputJax: input,
    OutputJax: output,
    safeOptions: {
      allow: { URLs: "none", classes: "safe", cssIDs: "safe", styles: "none" },
      idPattern: /^mjx-eqn:[-A-Za-z0-9_.]+$/,
    },
  });
  const svgCache = new WeightedLruCache<SvgCacheValue>(512, MAX_SVG_CACHE_BYTES);
  const rasterCache = new WeightedLruCache<RasterCacheValue>(256, MAX_RASTER_CACHE_BYTES);
  let lastFailure: FormulaRenderFailure | undefined;

  const fail = (value: FormulaRenderFailure): undefined => {
    lastFailure = value;
    return undefined;
  };

  const formulaSvg = (latex: string, display: boolean): SvgFormula | undefined => {
    const key = `${display ? "display" : "inline"}\0${latex}`;
    if (svgCache.has(key)) {
      const cached = svgCache.get(key)!;
      return isFailure(cached) ? fail(cached) : cached;
    }

    try {
      input.reset();
      const node = document.convert(latex, { display });
      const source = extractSvg(adaptor.outerHTML(node));
      if (!source || source.includes('data-mml-node="merror"')) {
        const invalid = failure("invalid-svg", "MathJax did not produce a valid SVG formula");
        svgCache.set(key, invalid, cacheWeight(invalid));
        return fail(invalid);
      }

      const widthEx = parseExDimension(source, "width");
      const heightEx = parseExDimension(source, "height");
      if (!widthEx || !heightEx) {
        const invalid = failure("invalid-dimensions", "MathJax SVG has no positive ex dimensions");
        svgCache.set(key, invalid, cacheWeight(invalid));
        return fail(invalid);
      }

      const formula = { source, widthEx, heightEx };
      svgCache.set(key, formula, cacheWeight(source) + 32);
      return formula;
    } catch (error) {
      const invalid = failure("tex-error", errorMessage(error));
      svgCache.set(key, invalid, cacheWeight(invalid));
      return fail(invalid);
    }
  };

  const render = (
    source: string,
    display: boolean,
    requestedColor: string | undefined,
    requestedLayout: FormulaRasterLayout,
  ): FormulaRaster | undefined => {
    lastFailure = undefined;
    const latex = source.trim();
    if (!latex) return fail(failure("empty-input", "Formula is empty"));
    if (latex.length > MAX_INPUT_LENGTH) {
      return fail(failure("input-too-long", `Formula exceeds ${MAX_INPUT_LENGTH} characters`));
    }

    const color = normalizeColor(requestedColor);
    const layout = normalizedLayout(requestedLayout);
    const svg = formulaSvg(latex, display);
    if (!svg) return undefined;

    const rasterKey = [
      display ? "display" : "inline",
      color,
      layout.maxWidthCells,
      layout.maxHeightCells,
      layout.cellWidthPx,
      layout.cellHeightPx,
      layout.fitHeight ? "fit-height" : "width-only",
      latex,
    ].join("\0");
    if (rasterCache.has(rasterKey)) {
      const cached = rasterCache.get(rasterKey)!;
      return isFailure(cached) ? fail(cached) : cached;
    }

    const rememberFailure = (value: FormulaRenderFailure): undefined => {
      rasterCache.set(rasterKey, value, cacheWeight(value));
      return fail(value);
    };

    try {
      const maxLogicalWidth = layout.maxWidthCells * layout.cellWidthPx;
      const maxLogicalHeight = layout.maxHeightCells * layout.cellHeightPx;
      const innerWidth = maxLogicalWidth - CONTENT_BLEED_PX * 2;
      const innerHeight = maxLogicalHeight - CONTENT_BLEED_PX * 2;
      if (innerWidth <= 0 || innerHeight <= 0) {
        return rememberFailure(failure("raster-limit", "Terminal cells leave no drawable area"));
      }

      const basePixelsPerEx = layout.cellHeightPx * BASE_EX_TO_CELL_HEIGHT;
      const widthPixelsPerEx = innerWidth / svg.widthEx;
      const heightPixelsPerEx = layout.fitHeight
        ? innerHeight / svg.heightEx
        : Number.POSITIVE_INFINITY;
      const pixelsPerEx = Math.min(
        basePixelsPerEx,
        widthPixelsPerEx,
        heightPixelsPerEx,
      );
      const logicalContentWidth = svg.widthEx * pixelsPerEx;
      const logicalContentHeight = svg.heightEx * pixelsPerEx;
      const columns = Math.max(
        1,
        Math.min(
          layout.maxWidthCells,
          Math.ceil(
            (logicalContentWidth + CONTENT_BLEED_PX * 2) / layout.cellWidthPx - 1e-9,
          ),
        ),
      );
      const rows = Math.max(
        1,
        Math.ceil(
          (logicalContentHeight + CONTENT_BLEED_PX * 2) / layout.cellHeightPx - 1e-9,
        ),
      );
      if (rows > layout.maxHeightCells) {
        return rememberFailure(
          failure("height-limit", `Formula requires ${rows} terminal rows`),
        );
      }

      const logicalCanvasWidth = columns * layout.cellWidthPx;
      const logicalCanvasHeight = rows * layout.cellHeightPx;
      const deviceScale = chooseDeviceScale(logicalCanvasWidth, logicalCanvasHeight);
      if (!deviceScale) {
        return rememberFailure(
          failure("raster-limit", "Formula exceeds the maximum raster dimensions"),
        );
      }

      const contentWidth = logicalContentWidth * deviceScale;
      const contentHeight = logicalContentHeight * deviceScale;
      const canvasWidth = Math.ceil(logicalCanvasWidth * deviceScale);
      const canvasHeight = Math.ceil(logicalCanvasHeight * deviceScale);
      const padded = paddedSvg(
        svg.source,
        color,
        contentWidth,
        contentHeight,
        canvasWidth,
        canvasHeight,
      );
      if (!padded) {
        return rememberFailure(failure("invalid-svg", "Could not construct the padded SVG"));
      }

      const needsExternalFonts = padded.includes("<text");
      const rendered = new Resvg(padded, {
        font: {
          loadSystemFonts: needsExternalFonts && (options.loadSystemFonts ?? true),
          fontFiles: needsExternalFonts ? options.fontFiles : undefined,
        },
        shapeRendering: 2,
        textRendering: 2,
        logLevel: "error",
      }).render();
      if (
        rendered.width !== canvasWidth ||
        rendered.height !== canvasHeight ||
        rendered.width > MAX_RASTER_WIDTH ||
        rendered.height > MAX_RASTER_HEIGHT
      ) {
        return rememberFailure(
          failure("raster-limit", "Resvg returned unexpected raster dimensions"),
        );
      }

      const inkBounds = alphaBounds(rendered.pixels, rendered.width, rendered.height);
      if (!inkBounds) {
        return rememberFailure(failure("empty-raster", "Formula raster contains no visible pixels"));
      }
      if (
        inkBounds.left === 0 ||
        inkBounds.top === 0 ||
        inkBounds.right === rendered.width ||
        inkBounds.bottom === rendered.height
      ) {
        return rememberFailure(
          failure("clipped-raster", "Formula ink reaches the raster boundary"),
        );
      }

      const png = rendered.asPng();
      if (png.byteLength > MAX_PNG_BYTES) {
        return rememberFailure(
          failure("png-limit", `Formula PNG exceeds ${MAX_PNG_BYTES} bytes`),
        );
      }
      const base64Data = png.toString("base64");
      const result: FormulaRaster = {
        base64Data,
        widthPx: rendered.width,
        heightPx: rendered.height,
        columns,
        rows,
        pixelsPerEx,
        deviceScale,
        inkBounds,
      };
      rasterCache.set(rasterKey, result, png.byteLength + base64Data.length + 128);
      return result;
    } catch (error) {
      return rememberFailure(failure("raster-error", errorMessage(error)));
    }
  };

  return {
    render,
    clear() {
      svgCache.clear();
      rasterCache.clear();
      lastFailure = undefined;
    },
    get cacheSize() {
      return rasterCache.size;
    },
    get cacheBytes() {
      return svgCache.bytes + rasterCache.bytes;
    },
    get lastFailure() {
      return lastFailure;
    },
  };
}
