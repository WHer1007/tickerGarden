import assert from 'node:assert/strict';
import test from 'node:test';
import { rewardTotals } from '../../packages/history-projector/src/stake-summary.ts';

const quote = `0x${'1'.repeat(40)}`;
const meme = `0x${'2'.repeat(40)}`;

test('reward totals add same-anchor claimable rewards to claimed totals and exclude burned meme fees', () => {
  assert.deepEqual(rewardTotals({ [quote]: '7', [meme]: '3' }, [
    { asset: quote, amount: '11', kind: 'quote' },
    { asset: meme, amount: '13', kind: 'meme' },
  ], true), {
    claimed: { [quote]: '7', [meme]: '3' },
    earned: { [quote]: '18', [meme]: '3' },
  });
});

test('reward totals include meme claimable when meme fees are not burned', () => {
  assert.deepEqual(rewardTotals({}, [{ asset: meme, amount: '13', kind: 'meme' }], false), {
    claimed: {}, earned: { [meme]: '13' },
  });
});

test('reward totals reject malformed addresses, values, and reward kinds', () => {
  assert.throws(() => rewardTotals({ nope: '1' }, [], false), /invalid claimed amount/);
  assert.throws(() => rewardTotals({}, [{ asset: quote, amount: '-1', kind: 'quote' }], false), /invalid claimable amount/);
  assert.throws(() => rewardTotals({}, [{ asset: quote, amount: '1', kind: 'holder' }], false), /invalid claimable amount/);
});
