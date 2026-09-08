import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { feePreviewRows, feePreviewTable } from '../src/create/fee-preview.ts';

const expected = {
  noSharing: [
    [70, 0, 0, 30],
    [70, 0, 0, 30],
    [40, 0, 30, 30],
  ],
  sharing: [
    [35, 35, 0, 30],
    [35, 35, 0, 30],
    [20, 20, 30, 30],
  ],
} as const;

function percentages(holderSharing: boolean) {
  return feePreviewRows(holderSharing).map(({ creator, holders, stakers, platform }) =>
    [creator, holders, stakers, platform],
  );
}

test('fee preview matches fixed accounting splits without holder sharing', () => {
  assert.deepEqual(percentages(false), expected.noSharing);
});

test('fee preview matches fixed accounting splits with holder sharing', () => {
  assert.deepEqual(percentages(true), expected.sharing);
});

test('every fee preview row is nonnegative and conserved', () => {
  for (const row of [...feePreviewRows(false), ...feePreviewRows(true)]) {
    const values = [row.creator, row.holders, row.stakers, row.platform];
    assert.ok(values.every((value) => value >= 0));
    assert.equal(values.reduce((sum, value) => sum + value, 0), 100);
  }
});

test('preview constants remain aligned with local Solidity accounting', async () => {
  const accounting = await readFile(new URL('../../../contracts/src/v1/libraries/MarketFeeAccounting.sol', import.meta.url), 'utf8');
  const liabilities = await readFile(new URL('../../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol', import.meta.url), 'utf8');
  assert.match(accounting, /STAKER_NON_LP_SHARE_BPS\s*=\s*3_000/);
  assert.match(accounting, /PLATFORM_NON_LP_SHARE_BPS\s*=\s*3_000/);
  assert.match(accounting, /LP_SHARE_BPS\s*=\s*0/);
  assert.match(liabilities, /holderAmount\s*=\s*\(creatorAmount\s*-\s*creatorTaxAmount\)\s*\/\s*2/);
});

test('current settings hide disabled staking stages and recipient columns', () => {
  for (const sharing of [false, true]) {
    const rows = feePreviewRows(sharing, false);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.stakers === 0 && !row.activeStake));
    assert.equal(rows[1]?.stage, 'After graduation');
    const markup = feePreviewTable(sharing, false);
    assert.doesNotMatch(markup, />Stakers<|active stake/);
    assert.equal(markup.includes('>Holders<'), sharing);
  }
  assert.match(feePreviewTable(false, true), />Stakers</);
  assert.doesNotMatch(feePreviewTable(false, true), />Holders</);
});
