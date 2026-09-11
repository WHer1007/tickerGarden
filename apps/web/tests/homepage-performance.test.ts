import assert from "node:assert/strict";
import { test } from "node:test";
import home from "../src/pages/home.ts";

test("below-the-fold homepage illustrations are lossless WebP assets with reserved lazy slots", () => {
  const illustrations = home.html.match(/<img[^>]+step-(?:stake|earn|liquidity)[^>]+>/g) ?? [];
  assert.equal(illustrations.length, 3);
  for (const image of illustrations) {
    assert.match(image, /\.webp/);
    assert.match(image, /width="1254" height="1254"/);
    assert.match(image, /loading="lazy"/);
    assert.match(image, /decoding="async"/);
  }
});
