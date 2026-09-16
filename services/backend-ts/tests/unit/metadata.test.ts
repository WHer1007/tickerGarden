import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDisplayMetadata } from '../../packages/metadata/src/index.ts';

test('metadata loader enforces HTTPS allowlist, redirects, content type and byte limits', async () => {
  const payload = JSON.stringify({ name: 'Garden', image: 'https://cdn.example/image.png', website: 'http://unsafe.example' });
  const result = await fetchDisplayMetadata('ipfs://bafytest/meta.json', {
    allowedOrigins: ['https://gateway.example', 'https://cdn.example'], ipfsGatewayOrigin: 'https://gateway.example',
    fetch: async (input) => {
      assert.equal(String(input), 'https://gateway.example/ipfs/bafytest/meta.json');
      return new Response(payload, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } });
    },
  });
  assert.deepEqual(result, { name: 'Garden', image: 'https://cdn.example/image.png' });
  await assert.rejects(fetchDisplayMetadata('https://127.0.0.1/meta.json', { allowedOrigins: ['https://gateway.example'] }), /not allowed/);
  await assert.rejects(fetchDisplayMetadata('https://unknown.example/meta.json', { allowedOrigins: ['https://gateway.example'] }), /not allowed/);
});
