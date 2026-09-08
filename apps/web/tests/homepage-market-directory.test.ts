import assert from "node:assert/strict";
import { test } from "node:test";
import home from "../src/pages/home.ts";

test("the first release does not render the homepage market directory", () => {
  assert.doesNotMatch(home.html, /Markets in the garden|data-home-markets|home-markets-heading/);
});
