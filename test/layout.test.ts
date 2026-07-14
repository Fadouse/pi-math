import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { centerMathBlock } from "../src/layout.js";

test("centers a multiline formula as one rectangle", () => {
  const source = " x\n───\n y";
  const centered = centerMathBlock(source, 11);
  const lines = centered.split("\n");

  assert.deepEqual(lines, ["     x", "    ───", "     y"]);
  assert.equal(lines[0]!.search(/\S/u), 5);
  assert.equal(lines[1]!.search(/\S/u), 4);
});

test("uses terminal cell width for wide characters", () => {
  const centered = centerMathBlock("因式", 10);
  assert.equal(centered, "   因式");
  assert.equal(visibleWidth(centered), 7);
});

test("does not pad formulas that already fill the available width", () => {
  assert.equal(centerMathBlock("abcdefgh", 5), "abcdefgh");
  assert.equal(centerMathBlock("", 20), "");
});
