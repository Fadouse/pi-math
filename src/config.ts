import { existsSync } from "node:fs";
import { delimiter as pathDelimiter } from "node:path";
import type { SvgMathRendererOptions, TeXDefinitionMap } from "./svg-renderer.js";

function definitionMap(value: string | undefined, variable: string): TeXDefinitionMap | undefined {
  if (!value?.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${variable} must be a JSON object`);
  }

  const definitions: TeXDefinitionMap = {};
  for (const [rawName, definition] of Object.entries(parsed)) {
    const name = rawName.replace(/^\\/, "");
    if (!name || (typeof definition !== "string" && !Array.isArray(definition))) {
      throw new Error(`${variable}.${rawName} must be a string or array definition`);
    }
    definitions[name] = definition;
  }
  return definitions;
}

function configuredFontFiles(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  const files = value
    .split(pathDelimiter)
    .map((path) => path.trim())
    .filter(Boolean);
  const missing = files.find((path) => !existsSync(path));
  if (missing) throw new Error(`PI_MATH_FONT_FILES does not exist: ${missing}`);
  return [...new Set(files)];
}

function systemFontsEnabled(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value !== "0" && value.toLowerCase() !== "false";
}

/** Read optional, process-local renderer settings without network or subprocesses. */
export function loadSvgMathRendererOptions(
  environment: NodeJS.ProcessEnv = process.env,
): SvgMathRendererOptions {
  return {
    macros: definitionMap(environment.PI_MATH_MACROS, "PI_MATH_MACROS"),
    environments: definitionMap(environment.PI_MATH_ENVIRONMENTS, "PI_MATH_ENVIRONMENTS"),
    fontFiles: configuredFontFiles(environment.PI_MATH_FONT_FILES),
    loadSystemFonts: systemFontsEnabled(environment.PI_MATH_SYSTEM_FONTS),
  };
}
