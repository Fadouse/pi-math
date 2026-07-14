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
  },
};

const sourceLines = ["before", placement.marker, "after"];
const area = { renderWidth: 20, paddingX: 2 };

test("places terminal images with reserved rows and capability fallback", () => {
  setCellDimensions({ widthPx: 9, heightPx: 18 });

  try {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const kitty = insertFormulaImages(sourceLines, [placement], area);
    assert.equal(kitty.length, 4);
    assert.equal(kitty[0], "before");
    assert.match(kitty[1]!, /^ {8}\x1b_G/u);
    assert.match(kitty[1]!, /c=4,r=2,i=42/u);
    assert.equal(kitty[2], "");
    assert.equal(kitty[3], "after");

    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    const iterm = insertFormulaImages(sourceLines, [placement], area);
    assert.deepEqual([iterm[0], iterm[1], iterm[3]], ["before", "", "after"]);
    assert.match(iterm[2]!, /^ {8}\x1b\[1A\x1b\]1337;File=/u);
    assert.match(iterm[2]!, /width=4;height=auto/u);

    setCapabilities({ images: null, trueColor: true, hyperlinks: true });
    assert.deepEqual(insertFormulaImages(sourceLines, [placement], area), sourceLines);
  } finally {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
  }
});
