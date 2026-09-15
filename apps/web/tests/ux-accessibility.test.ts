import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import markets from '../src/pages/markets.ts';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../subpages.css', import.meta.url), 'utf8');
const globalStyles = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const trade = fs.readFileSync(new URL('../src/pages/trade.ts', import.meta.url), 'utf8');

test('single-page navigation exposes a skip target and moves focus to each new main view', () => {
  assert.match(index, /class="skip-link" href="#main-content"/);
  assert.match(app, /main\.id = "main-content"/);
  assert.match(app, /main\.focus\(\{ preventScroll: true \}\)/);
  assert.match(styles, /:focus-visible\{outline:2px solid/);
  assert.doesNotMatch(styles, /input:focus,input:focus-visible/);
  assert.match(globalStyles, /:where\(input,textarea,select\):focus,[\s\S]*:where\(input,textarea,select\):focus-visible\s*\{\s*outline:none!important;\s*box-shadow:none!important/);
  assert.match(styles, /:where\(a,button,summary\):focus-visible/);
  assert.doesNotMatch(styles, /:where\(a,button,input,select,textarea,summary\):focus-visible/);
  assert.match(styles, /:where\(input,textarea,select\):focus,:where\(input,textarea,select\):focus-visible\{outline:none!important;box-shadow:none!important\}/);
});

test('Explore starts with one loading message and keeps error recovery in its live status', () => {
  assert.match(markets.html, /data-market-empty[^>]*hidden/);
  assert.doesNotMatch(markets.html, /data-market-list aria-live/);
  assert.match(markets.html, /data-stage-empty="1" role="status" aria-live="polite"/);
  assert.match(app, /empty\.append\(retry\)/);
  assert.match(app, /Try loading .* markets again/);
});

test('Explore uses the finalized paged directory in production and an explicit local integration adapter', () => {
  assert.match(app, /listMarkets\(\{\.\.\.params,includeRecent:true,limit,\.\.\.\(cursor\?\{cursor\}:\{\}\)\}\)/);
  assert.match(app, /if\(!foundation\.direct\)assertFinalizedSync\(page\.sync,\['marketCapUsd_desc','recentBuy_desc'\]\.includes\(params\.sort\?\?''\)\?page\.sync\.revision:params\.revision,'explore page'\)/);
  assert.match(app, /if\(markets\.length===0\)return false/);
  assert.match(app, /pageDirectExplore\(foundation\.markets,unversioned,cursor,limit\)/);
  const refresh = app.slice(app.indexOf('async function refreshDirectDirectory('), app.indexOf('let directDirectoryTimer:'));
  assert.doesNotMatch(refresh, /publicClient|directMarkets|integrationMarketDirectory/);
  const directory=app.slice(app.indexOf('async function fetchExplorePage'),app.indexOf('function applyExploreStatistics'));
  assert.doesNotMatch(directory,/publicClient/);assert.match(directory,/if\(foundation\.direct\)/);assert.match(directory,/pageDirectExplore\(foundation\.markets/);assert.match(directory,/throw new ExploreResponseError/);
});

test('trade controls describe their behavior and tab panels support keyboard navigation', () => {
  assert.doesNotMatch(trade, /<button[^>]+data-trade-(?:input|output)-asset/);
  assert.match(trade, /View token on explorer \(opens in a new tab\)/);
  assert.match(trade, /data-detail-tab="holders" aria-selected="false" tabindex="-1"/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(app, /Switch direction and use full/);
  assert.doesNotMatch(trade, /data-trade-route-status/);
  assert.doesNotMatch(app, /Enter an amount to check a live trading quote/);
  assert.doesNotMatch(app, /market route could not be checked/);
});
