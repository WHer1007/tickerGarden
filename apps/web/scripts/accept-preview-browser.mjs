import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const localMode = process.env.TG_BROWSER_ACCEPT_LOCAL === '1';
const webOrigin = parseOrigin('TG_PREVIEW_WEB_URL', process.env.TG_PREVIEW_WEB_URL, localMode);
const readOrigin = process.env.TG_PREVIEW_READ_API_URL
  ? parseOrigin('TG_PREVIEW_READ_API_URL', process.env.TG_PREVIEW_READ_API_URL, localMode)
  : undefined;
if (!localMode && !readOrigin) throw new Error('TG_PREVIEW_READ_API_URL is required for Preview browser acceptance');

const chromeCandidates = [
  process.env.TG_CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(existsSync);
if (!executablePath) throw new Error('Chrome was not found; set TG_CHROME_PATH to a trusted Chrome/Chromium executable');

const observedAt = new Date().toISOString();
const evidence = {
  schemaVersion: 1,
  status: 'running',
  scope: localMode ? 'local-smoke' : 'vercel-preview',
  observedAt,
  runtime: process.version,
  targets: { web: new URL(webOrigin).hostname, ...(readOrigin ? { readApi: new URL(readOrigin).hostname } : {}) },
  routes: [],
  wallet: {},
  platform: {},
  failures: [],
};

const failures = evidence.failures;
const firstPartyOrigins = new Set([webOrigin, ...(readOrigin ? [readOrigin] : [])]);
const marketId = await resolveMarketId();
const browser = await chromium.launch({ executablePath, headless: true, ...(process.env.TG_BROWSER_PROXY_SERVER ? { proxy: { server: process.env.TG_BROWSER_PROXY_SERVER } } : {}) });
try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1024, isMobile: false },
    { name: 'mobile', width: 390, height: 844, isMobile: true },
  ]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.isMobile, deviceScaleFactor: 1 });
    await installAcceptanceWallet(context);
    const page = await context.newPage();
    const routeCases = [
      ['home', '/', '.home-main'],
      ['explore', '/explore', '.explore-page'],
      ['trade', `/trade?marketId=${marketId}`, '.trade-live'],
      ['create', '/create', '[data-create-form]'],
      ['stake', `/stake?marketId=${marketId}#positions`, '.staking-page'],
      ['claim', '/claim', '.claim-page'],
      ['stats', '/stats', '.stats-page'],
    ];
    for (const [name, route, selector] of routeCases) await checkRoute(page, viewport.name, name, route, selector);
    if (viewport.name === 'desktop') {
      await checkLegacyRoutes(page);
      await checkCreateDraftRecovery(page);
      await checkWalletLifecycle(page);
    }
    await context.close();
  }
  await checkPlatformResponses(browser);
} finally {
  await browser.close();
}

evidence.status = failures.length === 0 ? 'passed' : 'failed';
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (process.env.TG_BROWSER_EVIDENCE_FILE) {
  const output = path.resolve(process.env.TG_BROWSER_EVIDENCE_FILE);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, serialized, { mode: 0o600 });
} else if (process.env.TG_BROWSER_EVIDENCE_DIR) {
  const directory = path.resolve(process.env.TG_BROWSER_EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `browser-acceptance-${observedAt.replaceAll(':', '-')}.json`), serialized, { mode: 0o600 });
}
process.stdout.write(serialized);
if (failures.length) process.exitCode = 1;

function parseOrigin(key, value, allowLocal) {
  if (!value) throw new Error(`${key} is required`);
  const parsed = new URL(value);
  const local = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if ((!allowLocal || !local) && parsed.protocol !== 'https:') throw new Error(`${key} must use HTTPS`);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${key} must be a credential-free origin without a path, query or hash`);
  }
  return parsed.origin;
}

async function resolveMarketId() {
  const configured = process.env.TG_PREVIEW_MARKET_ID;
  if (configured) {
    if (!/^0x[0-9a-f]{64}$/.test(configured)) throw new Error('TG_PREVIEW_MARKET_ID must be a lowercase bytes32');
    return configured;
  }
  if (readOrigin) {
    const response = await fetch(new URL('/v1/markets?sort=createdAt_desc&limit=1', readOrigin), {
      headers: { origin: webOrigin }, signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Preview Read API market discovery returned ${response.status}`);
    const body = await response.json();
    const discovered = body?.items?.[0]?.marketId;
    if (typeof discovered === 'string' && /^0x[0-9a-f]{64}$/.test(discovered)) return discovered;
    if (!localMode) throw new Error('Preview Read API has no current market for Trade/Stake browser acceptance');
  }
  return `0x${'1'.repeat(64)}`;
}

async function installAcceptanceWallet(context) {
  await context.addInitScript(({ first, second }) => {
    const listeners = new Map();
    const provider = {
      isMetaMask: true,
      chainId: '0x1',
      accounts: [first],
      async request({ method, params }) {
        if (method === 'eth_chainId') return this.chainId;
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [...this.accounts];
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
          this.chainId = params?.[0]?.chainId ?? '0xb626';
          return null;
        }
        throw Object.assign(new Error(`Acceptance wallet does not implement ${method}`), { code: 4200 });
      },
      on(event, listener) { const entries = listeners.get(event) ?? new Set(); entries.add(listener); listeners.set(event, entries); },
      removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    };
    const emit = (event, value) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: false });
    window.__tgAcceptanceWallet = {
      first, second,
      switchAccount(account) { provider.accounts = [account]; emit('accountsChanged', [account]); },
      switchChain(chainId) { provider.chainId = chainId; emit('chainChanged', chainId); },
    };
  }, { first: '0x1111111111111111111111111111111111111111', second: '0x2222222222222222222222222222222222222222' });
}

async function checkRoute(page, viewport, name, route, selector) {
  const errors = [];
  const onPageError = error => errors.push(`pageerror:${error.message}`);
  const onRequestFailed = request => {
    try {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      const url = new URL(request.url());
      if (firstPartyOrigins.has(url.origin)) errors.push(`requestfailed:${url.hostname}${url.pathname}`);
    } catch { /* ignore malformed third-party URLs */ }
  };
  const onResponse = response => {
    try {
      const url = new URL(response.url());
      if (firstPartyOrigins.has(url.origin) && response.status() >= 500) errors.push(`response:${response.status()}:${url.hostname}${url.pathname}`);
      if (!localMode && firstPartyOrigins.has(url.origin) && url.pathname.startsWith('/integration/')) errors.push(`integration-bootstrap-request:${url.pathname}`);
    } catch { /* ignore malformed third-party URLs */ }
  };
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  const started = performance.now();
  try {
    const response = await page.goto(new URL(route, webOrigin).href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!response || !response.ok()) throw new Error(`document returned ${response?.status() ?? 'no response'}`);
    await page.waitForSelector(selector, { state: 'attached', timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(100);
    if (name === 'trade') {
      await page.waitForFunction(() => {
        const value = selector => document.querySelector(selector)?.textContent?.trim();
        const chart = document.querySelector('[data-detail-chart] canvas')?.getAttribute('aria-label') ?? '';
        return value('[data-detail-price]') !== '-'
          && value('[data-detail-cap]') !== '-'
          && document.querySelectorAll('[data-detail-fee-rows] > div').length > 0
          && !/Could Not Load|Loading Data/i.test(chart);
      }, undefined, { timeout: 15_000 });
    }
    const view = await page.evaluate(expectedSelector => ({
      title: document.title,
      selectorPresent: !!document.querySelector(expectedSelector),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      pathname: location.pathname,
      integrationBootstrap: document.documentElement.innerHTML.includes('/integration/rh-'),
      ...(expectedSelector === '.trade-live' ? {
        detail: {
          price: document.querySelector('[data-detail-price]')?.textContent?.trim(),
          marketCap: document.querySelector('[data-detail-cap]')?.textContent?.trim(),
          feeRows: document.querySelectorAll('[data-detail-fee-rows] > div').length,
          chart: document.querySelector('[data-detail-chart] canvas')?.getAttribute('aria-label'),
        },
      } : {}),
    }), selector);
    if (!view.title.includes('TickerGarden')) throw new Error('document title is not a TickerGarden page');
    if (!view.selectorPresent) throw new Error(`missing ${selector}`);
    if (view.horizontalOverflow) throw new Error('page has horizontal viewport overflow');
    if (!localMode && view.integrationBootstrap) throw new Error('Preview page contains an integration bootstrap reference');
    evidence.routes.push({ viewport, name, route, status: response.status(), durationMs: Math.round((performance.now() - started) * 100) / 100, title: view.title,
      ...(view.detail ? { detail: view.detail } : {}) });
  } catch (error) {
    failures.push(`${viewport}:${name}:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    for (const error of errors) failures.push(`${viewport}:${name}:${error}`);
  }
}

async function checkLegacyRoutes(page) {
  for (const hash of ['positions', 'staker', 'activity']) {
    try {
      await page.goto(new URL(`/rewards?marketId=${marketId}#${hash}`, webOrigin).href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForFunction(expectedMarket => location.pathname === '/stake'
        && location.hash === '#positions' && new URLSearchParams(location.search).get('marketId') === expectedMarket,
      marketId, { timeout: 10_000 });
      await page.waitForSelector('.staking-page');
      evidence.routes.push({
        viewport: 'desktop', name: `legacy-rewards-${hash}`,
        route: `/rewards?marketId=${marketId}#${hash}`,
        canonicalRoute: `/stake?marketId=${marketId}#positions`, status: 200,
      });
    } catch (error) {
      const location = await page.evaluate(() => ({ pathname: window.location.pathname, search: window.location.search, hash: window.location.hash })).catch(() => null);
      failures.push(`legacy-rewards-${hash}:${error instanceof Error ? error.message : String(error)}:${JSON.stringify(location)}`);
    }
  }
}

async function checkCreateDraftRecovery(page) {
  try {
    await page.goto(new URL('/create', webOrigin).href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.evaluate(() => localStorage.setItem('tickergarden:create-draft:v1:46630', JSON.stringify({
      version: 1, chainId: 46630, name: 'Acceptance Draft', symbol: 'ACCEPT', description: 'Preview recovery check', creatorTax: '1.25', hadImage: false,
    })));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('[name=name]')?.value === 'Acceptance Draft' && document.querySelector('[name=symbol]')?.value === 'ACCEPT');
    await page.evaluate(() => localStorage.removeItem('tickergarden:create-draft:v1:46630'));
    evidence.routes.push({ viewport: 'desktop', name: 'create-draft-recovery', route: '/create', status: 200 });
  } catch (error) { failures.push(`create-draft-recovery:${error instanceof Error ? error.message : String(error)}`); }
}

async function checkWalletLifecycle(page) {
  try {
    await page.goto(new URL('/claim', webOrigin).href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.locator('[data-wallet]').click();
    const choice = page.locator('button.wallet-option[data-wallet-choice^="legacy-"]').first();
    await choice.waitFor({ state: 'visible' });
    await choice.click();
    await page.waitForFunction(() => document.querySelector('[data-wallet]')?.dataset.state === 'connected');
    const first = await page.locator('[data-wallet]').getAttribute('title');
    assert.equal(first?.toLowerCase(), '0x1111111111111111111111111111111111111111');
    await page.evaluate(() => window.__tgAcceptanceWallet.switchAccount(window.__tgAcceptanceWallet.second));
    await page.waitForFunction(() => document.querySelector('[data-wallet]')?.getAttribute('title')?.toLowerCase() === '0x2222222222222222222222222222222222222222');
    await page.evaluate(() => window.__tgAcceptanceWallet.switchChain('0x1'));
    await page.waitForFunction(() => document.querySelector('[data-wallet]')?.dataset.state === 'disconnected');
    evidence.wallet = { connect: 'passed', accountSwitch: 'passed', wrongChainInvalidation: 'passed', submittedTransactions: 0 };
  } catch (error) {
    evidence.wallet = { status: 'failed', submittedTransactions: 0 };
    failures.push(`wallet-lifecycle:${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkPlatformResponses(browser) {
  if (localMode) {
    evidence.platform = { status: 'skipped-local', reason: 'Vercel rewrite and cache headers require Preview' };
    return;
  }
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const index = await page.goto(new URL('/index.html', webOrigin).href, { waitUntil: 'commit', timeout: 10_000 });
    if (!index?.ok()) throw new Error(`index returned ${index?.status() ?? 'no response'}`);
    const headers = await index.allHeaders();
    const csp = headers['content-security-policy'] ?? '';
    if (!csp.includes("default-src 'self'") || !csp.includes('connect-src')) throw new Error('CSP is missing required directives');
    if (headers['x-frame-options'] !== 'DENY') throw new Error('X-Frame-Options is not DENY');
    if (headers['x-content-type-options'] !== 'nosniff') throw new Error('X-Content-Type-Options is not nosniff');
    const cache = headers['cache-control'] ?? '';
    if (!cache.includes('no-cache') && !(cache.includes('max-age=0') && cache.includes('must-revalidate'))) throw new Error('index.html does not require cache revalidation');
    const missingApi = await page.evaluate(async url => {
      const response = await fetch(url, { redirect: 'error' });
      return { status: response.status, contentType: response.headers.get('content-type') ?? '' };
    }, new URL('/api/__tickergarden_acceptance_missing__', webOrigin).href);
    if (missingApi.status !== 404 || missingApi.contentType.includes('text/html')) throw new Error('missing API path fell through to the SPA');
    evidence.platform = { status: 'passed', indexCache: cache, missingApiStatus: missingApi.status };
    await context.close();
  } catch (error) { failures.push(`platform:${error instanceof Error ? error.message : String(error)}`); }
}
