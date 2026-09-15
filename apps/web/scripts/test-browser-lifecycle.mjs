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
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' && url.port === String(address.port)
        ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${address.port}/tests/browser/${name}.html`);
    await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.title), null, { timeout: 30_000 });
    const title = await page.title();
    assert.match(title, /^PASS/, await page.locator('body').innerText());
    assert.deepEqual(errors, [], `${name}: uncaught errors`);
    console.log(`${name}: ${title}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
