import test from 'node:test';
import assert from 'node:assert/strict';
import { feeDistribution, detailUsd } from '../src/v1/marketDetail.ts';
test('curve fees do not promise a staker share; holder routing excludes creator tax', () => {
 const view = feeDistribution(0, true, true, 150);
 assert.equal(view.summary, 'Creator 35% · Holders 35% · Platform 30%');
 assert.match(view.note, /Creator tax 1.50% is separate/);
});
test('pool staking rules state both outcomes without assuming active stake', () => {
 const view = feeDistribution(1, true, true, 0);
 assert.match(view.rules, /Creator 20% · Holders 20% · Stakers 30% · Platform 30%/);
 assert.match(view.rules, /Without active stake: Creator 35%/);
 assert.equal(feeDistribution(1, false, false, 0).summary, 'Creator 70% · Platform 30%');
 assert.throws(() => feeDistribution(2, true, false, 0));
});
test('USD formatting preserves large integers and unavailable vs real zero', () => {
 assert.equal(detailUsd(null), 'Unavailable');
 assert.equal(detailUsd('NaN'), 'Unavailable');
 assert.equal(detailUsd('0'), '$0.00');
 assert.equal(detailUsd('9007199254740993.25'), '$9,007,199,254,740,993.25');
});
