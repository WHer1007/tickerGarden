import test from 'node:test';
import assert from 'node:assert/strict';
import {launchPreviewField} from '../src/create/preview-dependencies.ts';
test('metadata edits do not restart chain previews; economics and funding changes do',()=>{for(const field of ['description','x','website'])assert.equal(launchPreviewField(field),false);for(const field of ['name','symbol','beneficiary','firstBuyAmount','stakingEnabled','quoteAssetConfigId','lpFeePips','burnMemeFees','treasuryEnabled'])assert.equal(launchPreviewField(field),true);});
