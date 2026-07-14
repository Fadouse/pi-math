import assert from "node:assert/strict";
import test from "node:test";
import { WeightedLruCache } from "../src/lru-cache.js";

test("evicts by recency, entry count, and retained bytes", () => {
  const cache = new WeightedLruCache<string>(3, 10);
  cache.set("a", "A", 3);
  cache.set("b", "B", 3);
  cache.set("c", "C", 3);
  assert.equal(cache.bytes, 9);

  assert.equal(cache.get("a"), "A");
  cache.set("d", "D", 3);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.has("a"), true);
  assert.equal(cache.size, 3);

  cache.set("large", "L", 8);
  assert.equal(cache.has("c"), false);
  assert.equal(cache.has("d"), false);
  assert.equal(cache.has("large"), true);
  assert.ok(cache.bytes <= 10);

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test("does not retain an entry larger than the byte budget", () => {
  const cache = new WeightedLruCache<string>(4, 5);
  cache.set("oversized", "value", 6);
  assert.equal(cache.size, 0);
  assert.equal(cache.get("oversized"), undefined);
});
