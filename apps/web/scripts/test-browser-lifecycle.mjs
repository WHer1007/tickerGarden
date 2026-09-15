// Isolated browser regression: no saved environment, RPC, or wallet signing.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
const server = await createServer({
  configFile: false, envDir: false,
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({
    executablePath: process.env.TG_BROWSER_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  for (const name of ['router-lifecycle', 'app-routing-lifecycle', 'history-lifecycle']) {
    const page = await browser.newPage();
    const errors = [];
    const consoleMessages = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' && url.port === String(address.port)
        ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${address.port}/tests/browser/${name}.html`);
    try {
      // The app owns document.title and may restore its route title after the
      // fixture completes. The dedicated result node is the stable contract.
      // Headless Chrome can throttle requestAnimationFrame on these pages;
      // use timer polling for the harness-level completion wait.
      await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.querySelector('#test-result, #result')?.textContent ?? ''), null, { polling: 100, timeout: 30_000 });
    } catch (error) {
      const body = await page.locator('body').innerText().catch(() => '<body unavailable>');
      throw new Error(`${name}: lifecycle did not finish (title=${await page.title()}; page errors=${JSON.stringify(errors)}; console=${JSON.stringify(consoleMessages)}; body=${JSON.stringify(body)})`, { cause: error });
    }
    const title = await page.locator('#test-result, #result').textContent();
    assert.match(title ?? '', /^PASS/, await page.locator('body').innerText());
    assert.deepEqual(errors, [], `${name}: uncaught errors`);
    console.log(`${name}: ${title}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
