import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assertDeploymentBoundary } from './deployment-boundary.mjs';

const web = target => ({
  TG_PROFILE: target === 'test' ? 'test' : 'master',
  VITE_V1_CHAIN_ID: target === 'test' ? '46630' : '4663',
  VITE_V1_READ_API_URL: `https://read.${target}.example`,
  VITE_LAUNCH_METADATA_ORIGIN: `https://content.${target}.example`,
  VITE_V1_RPC_URL: `https://rpc.${target}.example`,
  VERCEL_ENV: target === 'test' ? 'preview' : 'production',
  VERCEL_TARGET_ENV: target === 'test' ? 'preview' : 'production',
});

test('test and production deployments require their exact branches and Vercel targets', () => {
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'web', web('test'), 'test'));
  assert.doesNotThrow(() => assertDeploymentBoundary('production', 'web', web('production'), 'master'));
  assert.throws(() => assertDeploymentBoundary('test', 'web', web('test'), 'codex/feature'), /requires branch test/);
  assert.throws(() => assertDeploymentBoundary('production', 'web', web('production'), 'test'), /requires branch master/);
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...web('test'), VERCEL_ENV: 'production' }, 'test'), /requires Vercel preview/);
});

test('deployed frontend rejects local sources, integration bootstrap, and backend credentials', () => {
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...web('test'), VITE_V1_READ_API_URL: 'http://127.0.0.1:8790' }, 'test'), /local reference/);
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...web('test'), VITE_INTEGRATION_BOOTSTRAP: '/integration/local.json' }, 'test'), /local integration bootstrap/);
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...web('test'), TG_DATABASE_URL: 'postgresql://remote.example/db' }, 'test'), /owned by another service/);
});

test('manual web deployment accepts source identity without allowing conflicting branches', () => {
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'web', { ...web('test'), TG_SOURCE_BRANCH: 'test' }, 'test'));
  assert.doesNotThrow(() => assertDeploymentBoundary('production', 'web', { ...web('production'), TG_SOURCE_BRANCH: 'master' }, 'master'));
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...web('test'), TG_SOURCE_BRANCH: 'codex/feature' }, 'test'), /source branch disagrees/);
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...web('test'), TG_SOURCE_BRANCH: 'test' }, 'codex/feature'), /requires branch test/);
});

test('same-origin RPC proxy requires a remote HTTPS server upstream', () => {
  const env = { ...web('test'), VITE_V1_RPC_URL: '/api/rpc', TG_WEB_RPC_URL: 'https://rpc.test.example' };
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'web', env, 'test'));
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...env, TG_WEB_RPC_URL: '' }, 'test'), /Missing deployment variable/);
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...env, TG_WEB_RPC_URL: 'http://remote.example' }, 'test'), /remote https/);
  assert.throws(() => assertDeploymentBoundary('test', 'web', { ...env, VITE_V1_RPC_URL: '/other-proxy' }, 'test'), /Invalid deployment URL/);
});

test('backend services require remote service-specific data sources', () => {
  const base = { TG_ENVIRONMENT: 'test', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview' };
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'read-api', { ...base, TG_READ_DATABASE_URL: 'postgresql://db.example/read', TG_ALLOWED_ORIGINS: 'https://web.example' }, 'test'));
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'read-api', { ...base, TG_READ_DATABASE_URL: 'postgresql://db.example/read', VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG: '{}' }, 'test'));
  assert.throws(() => assertDeploymentBoundary('test', 'read-api', { ...base, TG_READ_DATABASE_URL: 'postgresql://db.example/read', VITE_V1_FACTORY_ADDRESS: 'frontend-owned' }, 'test'), /owned by another service/);
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'pipeline', { ...base, TG_PIPELINE_DATABASE_URL: 'postgresql://db.example/pipeline', TG_RPC_URL: 'https://rpc.example' }, 'test'));
  assert.doesNotThrow(() => assertDeploymentBoundary('test', 'content', { ...base, TG_CONTENT_DATABASE_URL: 'postgresql://db.example/content', TG_ALLOWED_ORIGINS: 'https://web.example' }, 'test'));
  assert.throws(() => assertDeploymentBoundary('test', 'pipeline', { ...base, TG_PIPELINE_DATABASE_URL: 'postgresql://localhost/pipeline', TG_RPC_URL: 'https://rpc.example' }, 'test'), /local reference/);
  assert.throws(() => assertDeploymentBoundary('test', 'content', { ...base, TG_CONTENT_DATABASE_URL: 'postgresql://db.example/content', QSTASH_CHAIN_TOKEN: 'wrong-service' }, 'test'), /owned by another service/);
});

test('every Vercel project runs the boundary gate and stays in Singapore', () => {
  const files = {
    web: '../apps/web/vercel.json',
    'read-api': '../services/backend-ts/apps/read-api/vercel.json',
    pipeline: '../services/backend-ts/apps/pipeline/vercel.json',
    content: '../services/backend-ts/apps/content/vercel.json',
  };
  for (const [service, relative] of Object.entries(files)) {
    const config = JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
    assert.deepEqual(config.regions, ['sin1']);
    assert.match(config.buildCommand, new RegExp(`deployment-boundary\\.mjs auto ${service}`));
  }
});
