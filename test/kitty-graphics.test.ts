import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  kittyPlaceholderSupport,
  renderKittyVirtualImage,
} from "../src/kitty-graphics.js";

test("detects only terminals with known Kitty Unicode placeholder support", () => {
  assert.equal(kittyPlaceholderSupport({ TERM_PROGRAM: "ghostty" }), true);
  assert.equal(kittyPlaceholderSupport({ KITTY_WINDOW_ID: "1" }), true);
  assert.equal(kittyPlaceholderSupport({ TERM: "xterm-kitty" }), true);
  assert.equal(kittyPlaceholderSupport({ TERM_PROGRAM: "wezterm" }), false);
  assert.equal(kittyPlaceholderSupport({ WARP_SESSION_ID: "1" }), false);
});

test("encodes width-correct Kitty virtual image placeholders", () => {
  const image = renderKittyVirtualImage("AA==", 0x12345678, 3, 2);
  assert.ok(image);
  assert.equal(image.imageId, 0x345678);
  assert.equal(image.placeholders.length, 2);
  assert.equal(visibleWidth(image.placeholders[0]!), 3);
  assert.equal(visibleWidth(image.placeholders[1]!), 3);
  assert.match(image.sequence, /a=T,f=100,q=2,U=1,i=3430008,p=3430008,c=3,r=2/u);
});

test("chunks large virtual image payloads and rejects unsupported dimensions", () => {
  const image = renderKittyVirtualImage("A".repeat(9_000), 7, 1, 1);
  assert.ok(image);
  assert.equal((image.sequence.match(/\x1b_G/gu) ?? []).length, 3);
  assert.match(image.sequence, /,m=1;/u);
  assert.match(image.sequence, /\x1b_Gm=0,q=2;/u);
  assert.equal(renderKittyVirtualImage("AA==", 1, 298, 1), undefined);
});
