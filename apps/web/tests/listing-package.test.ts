import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createListingPackage, LISTING_SUBMISSION_LINKS, serializeListingPackageJSON, serializeListingPackageText } from '../src/create/listing-package.ts';

const snapshot = {
  chainId: 4663, chainName: 'Robinhood Chain', tokenAddress: '0xabc', name: 'Garden', symbol: 'GDN',
  logo: 'https://example.com/logo.png', website: 'https://example.com', x: 'https://x.com/garden',
  metadataURI: 'ipfs://metadata', txHash: '0xtx',
} as const;

test('creates an immutable-data snapshot without network access', () => {
  assert.deepEqual(createListingPackage(snapshot), snapshot);
});

test('serializes JSON with confirmed fields and submission guidance', () => {
  const parsed = JSON.parse(serializeListingPackageJSON(snapshot));
  assert.deepEqual(parsed, { ...snapshot, submissionGuidance: LISTING_SUBMISSION_LINKS });
  assert.equal(LISTING_SUBMISSION_LINKS.length, 3);
  assert.ok(LISTING_SUBMISSION_LINKS.every(link => link.label === 'Submission guidance'));
});

test('serializes readable text and states that links are guidance', () => {
  const text = serializeListingPackageText(snapshot);
  assert.match(text, /Robinhood Chain \(4663\)/);
  assert.match(text, /Token address: 0xabc/);
  assert.match(text, /External platform submission guidance \(does not guarantee support or listing\)/);
  for (const link of LISTING_SUBMISSION_LINKS) assert.match(text, new RegExp(link.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('saved listing rejects corrupted identity and the wrong chain', async () => {
 const {parseSavedListing}=await import('../src/create/listing-package.ts');
 const saved={marketId:'0x'+'1'.repeat(64),snapshot:{chainId:46630,chainName:'Testnet',tokenAddress:'0x'+'2'.repeat(40),txHash:'0x'+'3'.repeat(64),name:'Test',symbol:'TST',logo:'',website:'',x:'',metadataURI:'ipfs://example'}};
 assert.deepEqual(parseSavedListing(JSON.stringify(saved),46630),saved);
 assert.equal(parseSavedListing(JSON.stringify(saved),4663),null);
 assert.equal(parseSavedListing('{bad',46630),null);
 saved.snapshot.tokenAddress='javascript:alert(1)';assert.equal(parseSavedListing(JSON.stringify(saved),46630),null);
});
