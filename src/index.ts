import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { createTerminalMathRenderer, type TerminalMathRenderer } from "./renderer.js";
import { centerMathBlock } from "./layout.js";
import {
  containsPotentialMath,
  expandMathInMarkdown,
  stripGeneratedMathFenceLines,
} from "./transform.js";

type MarkdownInternals = {
  text: string;
  paddingX?: number;
  theme?: { codeBlockIndent?: string };
};
type MarkdownRender = (this: Markdown, width: number) => string[];

interface MathPatchController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  clearTransformCache(): void;
  uninstall(): void;
}

/**
 * Pi 0.80 has custom renderers for extension messages, but no public override
 * for normal user/assistant messages. Patching the shared Markdown component is
 * display-only: session messages and provider context remain original LaTeX.
 */
function installMarkdownMathPatch(renderer: TerminalMathRenderer): MathPatchController {
  const originalRender = Markdown.prototype.render;
  let enabled = true;
  let installed = true;
  let transformCache = new WeakMap<
    Markdown,
    { source: string; mathWidth: number; transformed: string }
  >();

  const patchedRender: MarkdownRender = function (width: number): string[] {
    const markdown = this as unknown as MarkdownInternals;
    const source = markdown.text;
    if (!enabled || typeof source !== "string" || !containsPotentialMath(source)) {
      return originalRender.call(this, width);
    }

    const paddingX =
      typeof markdown.paddingX === "number" && Number.isFinite(markdown.paddingX)
        ? Math.max(0, markdown.paddingX)
        : 0;
    const codeBlockIndent = markdown.theme?.codeBlockIndent ?? "  ";
    const codeBlockIndentWidth = visibleWidth(codeBlockIndent);
    // Markdown's code indent occupies only the left side. Subtract it twice
    // so the synthetic left padding centers math in the full content area.
    const mathWidth = Math.max(
      1,
      width - paddingX * 2 - codeBlockIndentWidth * 2,
    );

    let transformed: string;
    const cached = transformCache.get(this);
    if (cached?.source === source && cached.mathWidth === mathWidth) {
      transformed = cached.transformed;
    } else {
      transformed = expandMathInMarkdown(source, (latex, display) => {
        const output = renderer.render(latex, display);
        if (!output) return undefined;
        return display || output.includes("\n")
          ? centerMathBlock(output, mathWidth)
          : output;
      });
      transformCache.set(this, { source, mathWidth, transformed });
    }

    if (transformed === source) return originalRender.call(this, width);

    markdown.text = transformed;
    try {
      return stripGeneratedMathFenceLines(originalRender.call(this, width));
    } finally {
      // Never mutate the source message. Only the Markdown render pass sees the
      // generated Unicode representation.
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function piMathExtension(pi: ExtensionAPI): Promise<void> {
  let renderer: TerminalMathRenderer | undefined;
  let loadFailure: string | undefined;

  try {
    renderer = await createTerminalMathRenderer();
  } catch (error) {
    loadFailure = errorMessage(error);
  }

  const patch = renderer ? installMarkdownMathPatch(renderer) : undefined;

  pi.on("session_start", (_event, ctx) => {
    if (loadFailure && ctx.mode === "tui") {
      ctx.ui.notify(`pi-math failed to load: ${loadFailure}`, "error");
    }
  });

  pi.on("session_shutdown", () => {
    patch?.uninstall();
  });

  pi.registerCommand("math-render", {
    description: "Control terminal LaTeX rendering: on, off, status, or clear",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";

      if (!patch || !renderer) {
        ctx.ui.notify(`pi-math is unavailable: ${loadFailure ?? "renderer did not load"}`, "error");
        return;
      }

      if (action === "on" || action === "enable") {
        patch.setEnabled(true);
        ctx.ui.notify("pi-math enabled", "info");
        return;
      }

      if (action === "off" || action === "disable") {
        patch.setEnabled(false);
        ctx.ui.notify("pi-math disabled", "info");
        return;
      }

      if (action === "clear") {
        renderer.clear();
        patch.clearTransformCache();
        ctx.ui.notify("pi-math render caches cleared", "info");
        return;
      }

      if (action === "status") {
        const status = patch.isEnabled() ? "enabled" : "disabled";
        ctx.ui.notify(`pi-math is ${status} (${renderer.cacheSize} cached formulas)`, "info");
        return;
      }

      ctx.ui.notify("Usage: /math-render on|off|status|clear", "warning");
    },
  });
}
