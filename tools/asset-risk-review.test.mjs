import test from 'node:test';import assert from 'node:assert/strict';
import {requireAssetRiskReview} from './asset-risk-review.mjs';
const token='0x'+'1'.repeat(40),uid='0x'+'2'.repeat(64),hash='0x'+'3'.repeat(64),implementation='0x'+'4'.repeat(40);
const fingerprint={tokenRuntimeCodeHash:hash,beacon:token,beaconRuntimeCodeHash:hash,implementation,implementationRuntimeCodeHash:hash};
const asset={symbol:'TEST',chainId:46630,address:token,uid,decimals:18,roles:['staking','quote'],minimumAllocation:10n**18n,fingerprint};
const review={chainId:46630,tokenAddress:token,assetUid:uid,decimals:18,roles:['staking','quote'],minimumAllocationRaw:'1000000000000000000',minimumRationale:'One whole asset for this test admission.',status:'approved',acceptedIssuerRisk:true,reviewer:'Test fixture',reviewedAt:'2026-09-01T00:00:00Z',validUntil:'2026-10-01T00:00:00Z',issuerControl:'Test issuer',evidence:['fixture'],capabilities:{pause:'present',blacklist:'present',upgrade:'present',feeOnTransfer:'absent',rebasing:'absent'},checkMode:'stock-fingerprint',fingerprint};
const now=Date.parse('2026-09-10T00:00:00Z');
test('review binds exact asset, roles, decimals, minimum and implementation',()=>{
 assert.equal(requireAssetRiskReview({schemaVersion:1,assets:[review]},asset,now),review);
 for(const changed of [{chainId:1},{uid:'0x'+'9'.repeat(64)},{decimals:6},{minimumAllocation:414n},{fingerprint:{...fingerprint,implementation:token}}])assert.throws(()=>requireAssetRiskReview({schemaVersion:1,assets:[review]},{...asset,...changed},now));
});
test('pending, missing, duplicate, expired and incomplete reviews block new admission',()=>{
 for(const assets of [[],[review,review],[{...review,status:'pending'}],[{...review,acceptedIssuerRisk:false}],[{...review,validUntil:'2026-09-09T00:00:00Z'}],[{...review,evidence:[]}],[{...review,roles:['staking']}],[{...review,minimumAllocationRaw:'413'}],[{...review,capabilities:{...review.capabilities,pause:'unknown'}}],[{...review,capabilities:{...review.capabilities,rebasing:'present'}}]])assert.throws(()=>requireAssetRiskReview({schemaVersion:1,assets},asset,now));
});
test('ordinary Quote runtime policy cannot claim Stock fingerprint protection',()=>{
 const a={...asset,roles:['quote'],fingerprint:undefined,runtimeCodeHash:hash};
 const r={...review,checkMode:'runtime-codehash',runtimeCodeHash:hash};
 assert.equal(requireAssetRiskReview({schemaVersion:1,assets:[r]},a,now),r);
 assert.throws(()=>requireAssetRiskReview({schemaVersion:1,assets:[review]},a,now));
});
