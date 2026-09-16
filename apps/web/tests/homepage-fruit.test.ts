import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const homepage = read("../src/pages/home.ts");
const shell = read("../index.html");
const app = read("../src/app.ts");
const arbor = read("../src/home/signal-arbor.ts");
const styles = read("../src/home/signal-arbor.css");

test("homepage stock illustration survives without runtime market data or JavaScript", () => {
  assert.match(homepage, /data-arbor-source/);
  assert.match(shell, /<noscript[\s\S]*signal-arbor/);
  for (const symbol of ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "COST"]) {
    assert.ok(homepage.includes(symbol));
  }
  assert.ok(existsSync(new URL("../assets/signal-arbor.png", import.meta.url)));
  assert.doesNotMatch(app, /data-signal-arbor|arbor-fruit/);
  assert.doesNotMatch(arbor, /\bfetch\s*\(|from ["'][^"']*(?:runtime|v1|three)/);
  assert.doesNotMatch(homepage, /garden-entry\.ts/);
  assert.match(styles, /\.signal-arbor \.arbor-source\s*\{\s*visibility:\s*hidden/);
  assert.match(styles, /\.signal-arbor\.is-fallback \.arbor-source\s*\{\s*visibility:\s*visible/);
});

test("decorative tree supports keyboard access and reduced-motion preference", () => {
  assert.match(arbor, /button\.type = 'button'/);
  assert.match(arbor, /setAttribute\('aria-label'/);
  assert.match(arbor, /reduced\.matches/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /\.signal-arbor/);
});
