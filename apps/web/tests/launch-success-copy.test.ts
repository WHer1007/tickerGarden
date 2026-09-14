import assert from 'node:assert/strict';
import test from 'node:test';
import {LAUNCH_CONFIRMED_COPY} from '../src/v1/pendingMarket.ts';

test('confirmed launch copy is concise and describes automatic indexing',()=>{
 assert.equal(LAUNCH_CONFIRMED_COPY,'Your token is live on-chain. Market data is syncing and will appear automatically once indexing is complete.');
 assert.doesNotMatch(LAUNCH_CONFIRMED_COPY,/database|launch again/i);
});
