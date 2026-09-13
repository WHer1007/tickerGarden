import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const preparePath = `${root}tools/prepare-robinhood-testnet-continuous.mjs`;
const verifyPath = `${root}tools/verify-robinhood-testnet-continuous-deployment.mjs`;

const artifact = (name) => JSON.parse(fs.readFileSync(`${root}contracts/out-v1/${name}.sol/${name}.json`));
const functionNames = (name) => new Set(artifact(name).abi.filter((item) => item.type === 'function').map((item) => item.name));

test('snapshot preparation is pinned to the current release label and holder mode', () => {
  const source = fs.readFileSync(preparePath, 'utf8');
  assert.match(source, /V1_DEPLOYMENT_HOLDER_MODE:\s*'wallet-snapshot-v1'/);
  assert.match(source, /TickerGarden:RobinhoodTestnet:walletSnapshot:isolatedStaker:20260913:/);
});

test('deployment verifier only reads functions present in current compiled ABIs', () => {
  const source = fs.readFileSync(verifyPath, 'utf8');
  assert.doesNotMatch(source, /Router\.poolManager|HolderRewardsDistributorV1.*(?:STREAM_DURATION|FUNDING_INTERVAL)/);
  const calls = [...source.matchAll(/read\('([^']+)'\s*,[^,]+,\s*'([^']+)'/g)];
  assert.ok(calls.length > 0, 'verifier should contain contract reads');
  for (const [, name, fn] of calls) assert.ok(functionNames(name).has(fn), `${name}.${fn} missing from current ABI`);
  assert.ok(functionNames('HolderRewardsDistributorV1').has('rewardMode'));
  assert.ok(!functionNames('HolderRewardsDistributorV1').has('STREAM_DURATION'));
  assert.ok(!functionNames('HolderRewardsDistributorV1').has('FUNDING_INTERVAL'));
});

test('holder reward mode and publisher initial state checks are explicit', () => {
  const source = fs.readFileSync(verifyPath, 'utf8');
  assert.match(source, /rewardMode[\s\S]*TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_V1/);
  assert.match(source, /snapshotPublisher[\s\S]*0x0000000000000000000000000000000000000000/);
});

test('deployment and activation gates match the actual raw-asset claim mode', () => {
  const contract = fs.readFileSync(`${root}contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol`, 'utf8');
  const mode = contract.match(/function userClaimMode\(\)[\s\S]*?keccak256\("([^"]+)"\)/)?.[1];
  assert.equal(mode, 'TICKERGARDEN_USER_CLAIM_RAW_ASSETS_V1');
  for (const file of [verifyPath, `${root}tools/audit-robinhood-testnet-activation.mjs`]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(source.includes(mode));
    assert.ok(!source.includes('TICKERGARDEN_USER_CLAIM_ASSET_SELECTION_V1'));
  }
});
