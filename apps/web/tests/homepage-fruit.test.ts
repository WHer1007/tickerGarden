import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const homepage = read("../index.html");
const app = read("../src/app.ts");
const styles = read("../styles.css");

test("homepage Stock fruit is static presentation and independent from runtime market data", () => {
  for (const symbol of ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "JPM", "COST"]) {
    assert.match(homepage, new RegExp(`>${symbol}<`));
  }
  assert.match(homepage, /class="fruit-layer" aria-hidden="true"/);
  assert.doesNotMatch(app, /fruitPositions|fruitLayer|ticker-fruit/);
});

test("Stock fruit retains the intended hover sway", () => {
  assert.match(styles, /\.ticker-fruit:hover[\s\S]*animation:\s*fruit-sway/);
  assert.match(styles, /@keyframes fruit-sway/);
});
