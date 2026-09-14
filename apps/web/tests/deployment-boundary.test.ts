import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viteConfig = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const vercelIgnore = fs.readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8');
const testDeploymentExample = fs.readFileSync(new URL('../.env.robinhood-testnet.example', import.meta.url), 'utf8');
const repositoryTestExample = fs.readFileSync(new URL('../../../config/test.env.example', import.meta.url), 'utf8');

test('deployment builds reject and exclude local integration fixtures', () => {
  assert.match(viteConfig, /command==='serve'.*readProjectEnv/s);
  assert.match(viteConfig, /command==='build'.*VITE_INTEGRATION_BOOTSTRAP.*throw Error/s);
  assert.match(viteConfig, /VITE_V1_READ_API_URL.*VITE_LAUNCH_METADATA_ORIGIN.*VITE_V1_RPC_URL/s);
  assert.match(viteConfig, /Deployment build cannot use a local/);
  assert.match(viteConfig, /dist\/integration/);
  assert.match(vercelIgnore, /^public\/integration\/$/m);
});

test('the test deployment example has no local data endpoint or browser bootstrap', () => {
  assert.doesNotMatch(testDeploymentExample, /VITE_INTEGRATION_BOOTSTRAP/);
  assert.doesNotMatch(testDeploymentExample, /(?:127\.0\.0\.1|localhost)/);
  assert.doesNotMatch(repositoryTestExample, /VITE_INTEGRATION_BOOTSTRAP/);
});
