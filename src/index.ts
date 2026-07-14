import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import { installMarkdownMathPatch } from "./markdown-patch.js";
import { createTerminalMathRenderer, type TerminalMathRenderer } from "./renderer.js";

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
    description: "Control terminal LaTeX image rendering: on, off, status, or clear",
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
        const protocol = getCapabilities().images ?? "unsupported terminal";
        ctx.ui.notify(
          `pi-math is ${status} (${protocol}, ${renderer.cacheSize} cached formulas)`,
          "info",
        );
        return;
      }
      ctx.ui.notify("Usage: /math-render on|off|status|clear", "warning");
    },
  });
}
