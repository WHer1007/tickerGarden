import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [spec, readSource, contentSource, frontendScope, backendClient, frontendClient] = await Promise.all([
  readFile(new URL('openapi/v1.json', root), 'utf8').then(JSON.parse),
  readFile(new URL('apps/read-api/src/index.ts', root), 'utf8'),
  readFile(new URL('apps/content/src/index.ts', root), 'utf8'),
  readFile(new URL('../../docs/backend/frontend-api-scope.md', root), 'utf8'),
  readFile(new URL('openapi/generated/v1-client.ts', root), 'utf8'),
  readFile(new URL('../../apps/web/src/v1/generated/read-api.ts', root), 'utf8'),
]);

const manualReadRoutes = new Set([
  'GET /v1/protocol-statistics',
  'GET /v1/statistics-prices',
  'GET /v1/market-display-statistics',
]);
const contentRoutes = new Set([
  'POST /v1/content/challenges',
  'POST /v1/content/uploads',
  'POST /v1/content/uploads/{uploadId}/complete',
  'GET /v1/content/uploads/{uploadId}',
]);
const excludedRoutes = new Set([
  '/v1/assets/{assetUid}/statistics',
  '/v1/users/{address}/rewards',
]);

function mountedRoutes(source) {
  const routes = new Set();
  for (const match of source.matchAll(/app\.(get|post)\((?:`([^`]+)`|'([^']+)')/g)) {
    let path = match[2] ?? match[3];
    if (!path || (!path.startsWith('/v1/') && path !== '/health')) continue;
    path = path.replaceAll(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
    const method = match[1].toUpperCase();
    if (path.includes('${kind}')) {
      for (const kind of ['holder', 'staker']) routes.add(`${method} ${path.replace('${kind}', kind)}`);
    } else routes.add(`${method} ${path}`);
  }
  return routes;
}

const mountedRead = mountedRoutes(readSource);
const mountedContent = mountedRoutes(contentSource);
const contractRead = new Set(Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.keys(item).filter((method) => ['get', 'post'].includes(method)).map((method) => `${method.toUpperCase()} ${path}`),
));

for (const path of excludedRoutes) assert.equal(spec.paths[path], undefined, `excluded no-caller route remains in OpenAPI: ${path}`);
for (const route of contractRead) assert.ok(mountedRead.has(route), `OpenAPI route is not mounted by read-api: ${route}`);
for (const route of mountedRead) assert.ok(contractRead.has(route) || manualReadRoutes.has(route), `mounted read route is neither generated nor frozen manual contract: ${route}`);
for (const route of manualReadRoutes) {
  assert.ok(mountedRead.has(route), `frozen manual read route is not mounted: ${route}`);
  assert.ok(frontendScope.includes(`\`${route}`) || frontendScope.includes(`\`${route.split(' ')[1]}?`), `manual read route is absent from frontend scope: ${route}`);
}
for (const route of contentRoutes) {
  assert.ok(mountedContent.has(route), `frontend content route is not mounted: ${route}`);
  const path = route.split(' ')[1];
  assert.ok(frontendScope.includes(`\`${route}`) || frontendScope.includes(`\`${path}`), `content route is absent from frontend scope: ${route}`);
}
for (const route of mountedContent) {
  if (route.includes('/v1/jobs/')) continue;
  assert.ok(contentRoutes.has(route), `mounted public content route is absent from frozen frontend scope: ${route}`);
}
const withoutGeneratedBanner = (value) => value.split('\n').slice(1).join('\n');
assert.equal(withoutGeneratedBanner(frontendClient), withoutGeneratedBanner(backendClient), 'frontend generated client differs from TypeScript OpenAPI authority');

console.log(JSON.stringify({
  status: 'current', generatedReadRoutes: contractRead.size, manualReadRoutes: manualReadRoutes.size, contentRoutes: contentRoutes.size,
}));
