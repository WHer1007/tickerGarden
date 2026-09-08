// Differential fixtures from an in-memory reference evaluator, including cursor bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { querySnapshot, InMemoryReadModelRepository } from '../testsupport/api/reference.ts';
const input = JSON.parse(readFileSync(new URL('../internal/readmodel/testdata/snapshot.json', import.meta.url)));
const repository = new InMemoryReadModelRepository(input);
{
  const entries = [];
  const get = async (path) => {
    const r = querySnapshot(path, repository);
    const body = r.body;
    entries.push({path, status:r.status, body});
    return body;
  };
  await get('/health');
  await get('/v1/markets?search=tree');
  await get('/v1/markets?sort=createdAt_desc');
  const page = await get('/v1/markets?limit=1');
  await get('/v1/markets?limit=1&cursor=' + page.nextCursor + '&revision=' + input.sync.revision);
  await get('/v1/markets?assetUid=' + input.markets[0].assetUid);
  await get('/v1/markets?marketId=' + input.markets[0].marketId);
  await get('/v1/markets?memeToken=' + input.markets[0].memeToken);
  await get('/v1/markets?launchPhase=0');
  await get('/v1/markets?launchPhase=1&assetUid=' + input.markets[0].assetUid);
  const descending = await get('/v1/markets?sort=marketId_desc&limit=1');
  await get('/v1/markets?sort=marketId_desc&limit=1&cursor=' + descending.nextCursor + '&revision=' + input.sync.revision);
  await get('/v1/markets?sort=latest');
  await get('/v1/markets?launchPhase=2');
  await get('/v1/markets/' + input.markets[0].marketId);
  for (const kind of ['asset','quote','baseline','template']) await get('/v1/config/' + kind);
  await get('/v1/users/' + input.positions[0].user + '/positions');
  const text = JSON.stringify(entries, null, 2) + '\n';
  const file = new URL('../internal/readmodel/testdata/api-golden.json', import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== text) throw Error('API golden fixture is stale');
  } else writeFileSync(file, text);
}

// Preserve the legacy fixture and independently exercise enriched DTOs/cursor bytes.
const enriched = structuredClone(input);
for (const [i, market] of enriched.markets.entries()) {
  market.identity = {name: 'Orchard 苹果 <&>\u2028', symbol: 'MiXeD', metadataURI: '', deployedAt: String(i % 2 ? 100 : 9), blockNumber: market.source.blockNumber, blockHash: market.source.blockHash, runtimeCodeHash: '0x' + 'a'.repeat(64)};
}
const identityRepository = new InMemoryReadModelRepository(enriched);
{
  const entries = [];
  const get = async path => {const response = querySnapshot(path, identityRepository); const body = response.body; entries.push({path, status: response.status, body}); return body;};
  for (const sort of ['createdAt_asc', 'createdAt_desc']) {
    const path = '/v1/markets?search=Orchard&sort=' + sort + '&limit=1';
    const first = await get(path);
    if (!first.nextCursor) throw Error('identity golden requires multiple markets');
    await get(path + '&cursor=' + first.nextCursor);
    await get(path + '&createdFrom=10&cursor=' + first.nextCursor);
  }
  await get('/v1/markets?search=' + encodeURIComponent('苹果'));
  await get('/v1/markets?search=' + encodeURIComponent('<&>\u2028') + '&limit=1');
  await get('/v1/markets?createdFrom=9&createdTo=9');
  await get('/v1/markets?createdFrom=100&createdTo=9');
  await get('/v1/markets?search=');
  const text = JSON.stringify({snapshot: enriched, cases: entries}, null, 2) + '\n';
  const file = new URL('../internal/readmodel/testdata/identity-api-golden.json', import.meta.url);
  if (process.argv.includes('--check')) {if (readFileSync(file,'utf8') !== text) throw Error('Identity API golden fixture is stale');}
  else writeFileSync(file,text);
}
