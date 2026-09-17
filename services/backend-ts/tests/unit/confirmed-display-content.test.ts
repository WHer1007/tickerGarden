import test from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {publicMarketContent} from '../../packages/confirmed-display/src/content.ts';

const cid = `Qm${'a'.repeat(44)}`;

test('publicMarketContent selects only ready JSON by a validated metadata CID and returns safe public fields', async () => {
  const calls: Array<{sql: string; values: unknown[]}> = [];
  const pool = {query: async (sql: string, values: unknown[]) => {
    calls.push({sql, values});
    return {rows: [{payload: {
      description: 'A public token description',
      image: `ipfs://${cid}/logo.webp`,
      external_url: 'https://example.com/token',
      properties: {website: 'http://example.com', x: 'https://x.com/example'},
      owner: 'must not be returned', objectKey: 'private/path',
    }}]};
  }} as unknown as Pick<Pool, 'query'>;

  const result = await publicMarketContent(pool, {identity: {metadataURI: `ipfs://${cid}`}}, 'tickergarden_serverless');

  assert.deepEqual(result, {
    description: 'A public token description',
    imageURI: `ipfs://${cid}/logo.webp`,
    website: 'http://example.com/',
    x: 'https://x.com/example',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.values, [cid]);
  assert.match(calls[0]?.sql ?? '', /status='ready'/);
  assert.match(calls[0]?.sql ?? '', /media_type='application\/json'/);
  assert.doesNotMatch(calls[0]?.sql ?? '', /content_uploads|owner|object_key/i);
});

test('publicMarketContent rejects invalid or non-IPFS metadata URIs without querying storage', async () => {
  let calls = 0;
  const pool = {query: async () => { calls++; return {rows: []}; }} as unknown as Pick<Pool, 'query'>;

  assert.equal(await publicMarketContent(pool, {identity: {metadataURI: `ipfs://${cid}/metadata.json`}}), null);
  assert.equal(await publicMarketContent(pool, {identity: {metadataURI: 'https://example.com/metadata.json'}}), null);
  assert.equal(await publicMarketContent(pool, {identity: {metadataURI: 'ipfs://not-a-cid'}}), null);
  assert.equal(calls, 0);
});

test('publicMarketContent drops unsafe image and external links and tolerates missing rows', async () => {
  const payload = {payload: {
    description: 'ok', image: 'https://example.com/image.png',
    external_url: 'javascript:alert(1)', properties: {website: 'https://user:pass@example.com', x: 'data:text/plain,x'},
  }};
  let returnPayload = true;
  const pool = {query: async () => ({rows: returnPayload ? (returnPayload = false, [payload]) : []})} as unknown as Pick<Pool, 'query'>;

  assert.deepEqual(await publicMarketContent(pool, {identity: {metadataURI: `ipfs://${cid}`}}), {
    description: 'ok', imageURI: null, website: null, x: null,
  });
  assert.equal(await publicMarketContent(pool, {identity: {metadataURI: `ipfs://${cid}`}}), null);
});
