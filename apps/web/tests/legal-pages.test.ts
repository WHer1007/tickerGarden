import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const privacy = read("../privacy.html");
const terms = read("../terms.html");
const app = read("../src/app.ts");
const vite = read("../vite.config.js");

function assertLocalAnchorsResolve(page: string): void {
  const ids = new Set(Array.from(page.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
  const anchors = Array.from(page.matchAll(/href="#([^"]+)"/g), (match) => match[1]);
  assert.ok(anchors.length > 0);
  for (const anchor of anchors) assert.ok(ids.has(anchor), `missing #${anchor}`);
}

test("privacy and terms pages expose complete legal-page structure", () => {
  assert.match(privacy, /data-page="privacy"/);
  assert.match(terms, /data-page="terms"/);
  assert.match(privacy, /Pre-launch legal draft/);
  assert.match(terms, /Pre-launch legal draft/);
  assert.match(privacy, /Public blockchain and distributed records/);
  assert.match(terms, /Ticker Meme and STOCK relationship/);
  assert.match(terms, /UserStockVault/);
  assert.match(terms, /In Bloom/);
  assert.match(terms, /rageQuit/);
  assert.doesNotMatch(privacy, /\bPons\b/i);
  assert.doesNotMatch(terms, /\bPons\b/i);
  assertLocalAnchorsResolve(privacy);
  assertLocalAnchorsResolve(terms);
});

test("shared footer exposes product and legal navigation", () => {
  for (const href of [
    "index.html", "markets.html", "create.html", "stats.html", "rewards.html", "faq.html", "privacy.html", "terms.html",
  ]) {
    assert.match(app, new RegExp(`\\"${href.replace(".", "\\.")}\\"`));
  }
  assert.match(app, /aria-label="Footer navigation"/);
  assert.match(app, /Risk notice/);
});

test("Vite builds both legal pages and legal routes avoid runtime loading", () => {
  assert.match(vite, /privacy:\s*resolve\([^\n]+"privacy\.html"\)/);
  assert.match(vite, /terms:\s*resolve\([^\n]+"terms\.html"\)/);
  assert.match(app, /page === "privacy" \|\| page === "terms"/);
});
