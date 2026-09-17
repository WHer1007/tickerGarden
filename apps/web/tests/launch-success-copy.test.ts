import assert from 'node:assert/strict';
import test from 'node:test';
import {LAUNCH_CONFIRMED_COPY} from '../src/v1/pendingMarket.ts';

test('confirmed launch copy does not ask users to wait for indexing',()=>{
 assert.equal(LAUNCH_CONFIRMED_COPY,'Your token is live.');
 assert.doesNotMatch(LAUNCH_CONFIRMED_COPY,/database|launch again/i);
});
