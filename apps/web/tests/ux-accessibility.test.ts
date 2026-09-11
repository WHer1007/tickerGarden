import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import markets from '../src/pages/markets.ts';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../subpages.css', import.meta.url), 'utf8');
const trade = fs.readFileSync(new URL('../src/pages/trade.ts', import.meta.url), 'utf8');

test('single-page navigation exposes a skip target and moves focus to each new main view', () => {
  assert.match(index, /class="skip-link" href="#main-content"/);
  assert.match(app, /main\.id = "main-content"/);
  assert.match(app, /main\.focus\(\{ preventScroll: true \}\)/);
  assert.match(styles, /:focus-visible\{outline:2px solid/);
  assert.doesNotMatch(styles, /input:focus,input:focus-visible/);
});

test('Explore starts with one loading message and keeps error recovery in its live status', () => {
  assert.match(markets.html, /data-market-empty[^>]*hidden/);
  assert.doesNotMatch(markets.html, /data-market-list aria-live/);
  assert.match(markets.html, /data-stage-empty="1" role="status" aria-live="polite"/);
  assert.match(app, /empty\.append\(retry\)/);
  assert.match(app, /Try loading .* markets again/);
});

test('trade controls describe their behavior and tab panels support keyboard navigation', () => {
  assert.doesNotMatch(trade, /<button[^>]+data-trade-(?:input|output)-asset/);
  assert.match(trade, /View token on explorer \(opens in a new tab\)/);
  assert.match(trade, /data-detail-tab="holders" aria-selected="false" tabindex="-1"/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(app, /Switch direction and use full/);
});
