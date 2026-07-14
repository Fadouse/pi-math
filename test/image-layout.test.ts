import assert from "node:assert/strict";
import test from "node:test";
import { setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { insertFormulaImages, type FormulaImagePlacement } from "../src/image-layout.js";

const placement: FormulaImagePlacement = {
  marker: "__FORMULA__",
  imageId: 42,
  raster: {
    base64Data: "AA==",
    widthPx: 72,
    heightPx: 72,
    columns: 4,
    rows: 2,
    pixelsPerEx: 9,
    deviceScale: 2,
    inkBounds: { left: 2, top: 2, right: 70, bottom: 70 },
  },
  inline: false,
  fallbackText: "$$x$$",
};

const inlinePlacement: FormulaImagePlacement = {
  marker: "\ue001".repeat(3),
  imageId: 43,
  raster: {
    base64Data: "AA==",
    widthPx: 54,
    heightPx: 36,
    columns: 3,
    rows: 1,
    pixelsPerEx: 8,
    deviceScale: 2,
    inkBounds: { left: 2, top: 2, right: 52, bottom: 34 },
  },
  inline: true,
  fallbackText: String.raw`\(x^2\)`,
};

const sourceLines = ["before", placement.marker, "after"];
const area = { renderWidth: 20, paddingX: 2 };

test("places terminal images with reserved rows and capability fallback", () => {
  setCellDimensions({ widthPx: 9, heightPx: 18 });
  const originalTerminal = {
    TERM_PROGRAM: process.env.TERM_PROGRAM,
    TERM: process.env.TERM,
    KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
    GHOSTTY_RESOURCES_DIR: process.env.GHOSTTY_RESOURCES_DIR,
  };
  process.env.TERM_PROGRAM = "wezterm";
  process.env.TERM = "xterm-256color";
  delete process.env.KITTY_WINDOW_ID;
  delete process.env.GHOSTTY_RESOURCES_DIR;

  try {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const kitty = insertFormulaImages(sourceLines, [placement], area);
    assert.equal(kitty.length, 4);
    assert.equal(kitty[0], "before");
    assert.match(kitty[1]!, /^ {8}\x1b_G/u);
    assert.match(kitty[1]!, /c=4,r=2,i=42/u);
    assert.equal(kitty[2], "");
    assert.equal(kitty[3], "after");

    const inline = insertFormulaImages(
      [`left ${inlinePlacement.marker} right`],
      [inlinePlacement],
      area,
    );
    assert.equal(inline.length, 1);
    assert.match(inline[0]!, /^left {4}\x1b\[3D\x1b_G/u);
    assert.match(inline[0]!, /c=3,r=1,i=43/u);
    assert.match(inline[0]!, /\x1b\[3C right$/u);

    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    const iterm = insertFormulaImages(sourceLines, [placement], area);
    assert.deepEqual([iterm[0], iterm[1], iterm[3]], ["before", "", "after"]);
    assert.match(iterm[2]!, /^ {8}\x1b\[1A\x1b\]1337;File=/u);
    assert.match(iterm[2]!, /width=4;height=auto/u);

    setCapabilities({ images: null, trueColor: true, hyperlinks: true });
    assert.deepEqual(insertFormulaImages(sourceLines, [placement], area), [
      "before",
      "$$x$$",
      "after",
    ]);
  } finally {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    for (const [name, value] of Object.entries(originalTerminal)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
