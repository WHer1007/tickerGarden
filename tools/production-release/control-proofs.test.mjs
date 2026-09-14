import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {privateKeyToAccount} from '../../apps/web/node_modules/viem/_esm/accounts/privateKeyToAccount.js';
import {prepareControlChallenges, verifyControlProofs} from './control-proofs.mjs';

const keys = Array.from({length: 7}, (_, i) => `0x${String(i + 1).padStart(64, '0')}`);
const accounts = keys.map((key) => privateKeyToAccount(key));
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-control-proofs-'));
function fixture() {
  const output = tempDir();
  const treasury = accounts.slice(0, 3).map((a) => a.address);
  const governance = accounts.slice(2, 5).map((a) => a.address);
  const operator = accounts[6].address;
  fs.writeFileSync(path.join(output, 'mainnet-snapshot.json'), JSON.stringify({chainId: 4663, pin: {blockHash: '0x' + 'ab'.repeat(32)}, accounts: {
    treasury: {address: treasury[0], owners: treasury, threshold: 2},
    governance: {address: governance[0], owners: governance, threshold: 2},
    operator: {address: operator, owners: [operator], threshold: 1},
  }}));
  fs.writeFileSync(path.join(output, 'transactions.unsigned.json'), JSON.stringify({chainId: 4663, releaseId: '0x' + 'cd'.repeat(32), broadcastAuthorized: false, transactions: []}));
  return {output, treasury, governance, operator};
}
async function validProofs(output) {
  const challenges = prepareControlChallenges(output);
  const signer = new Map(accounts.map((account) => [account.address.toLowerCase(), account]));
  return {proofs: await Promise.all(challenges.challenges.map(async (challenge) => ({
    address: challenge.address,
    signatures: await Promise.all(challenge.eligibleSigners.slice(0, challenge.requiredSignatures).map((address) => signer.get(address.toLowerCase()).signMessage({message: challenge.message}))),
  }))), challenges};
}

test('verifies two-of-three Safe owner proofs and one operator proof with real EIP-191 recovery', async () => {
  const {output} = fixture();
  const {proofs} = await validProofs(output);
  const proofFile = path.join(output, 'proofs.json');
  fs.writeFileSync(proofFile, JSON.stringify(proofs));
  const result = await verifyControlProofs(output, proofFile);
  assert.equal(result.results.length, 3);
  assert.equal(result.status, 'EOA_OWNER_CONTROL_PROOFS_VERIFIED_NOT_SAFE_TRANSACTION_EXECUTION');
});

for (const [name, edit] of [
  ['owner shortage', (proofs) => { proofs[0].signatures.pop(); }],
  ['duplicate signature', (proofs) => { proofs[0].signatures[1] = proofs[0].signatures[0]; }],
  ['wrong owner', (proofs) => { proofs[0].signatures[0] = proofs[2].signatures[0]; }],
]) {
  test(`rejects ${name}`, async () => {
    const {output} = fixture(); const {proofs} = await validProofs(output);
    edit(proofs); const file = path.join(output, 'proofs.json'); fs.writeFileSync(file, JSON.stringify(proofs));
    await assert.rejects(() => verifyControlProofs(output, file));
  });
}

test('rejects signatures after the unsigned pack changes', async () => {
  const {output} = fixture(); const {proofs} = await validProofs(output);
  fs.writeFileSync(path.join(output, 'proofs.json'), JSON.stringify(proofs));
  fs.writeFileSync(path.join(output, 'transactions.unsigned.json'), JSON.stringify({chainId: 4663, releaseId: '0x' + 'cd'.repeat(32), transactions: [{id: 'changed'}]}));
  await assert.rejects(() => verifyControlProofs(output, path.join(output, 'proofs.json')));
});

test('rejects tampered challenge threshold or eligible signers even when pack binding is unchanged', async () => {
  for (const mutate of [
    (challenges) => { challenges.challenges[0].requiredSignatures = 1; },
    (challenges) => { challenges.challenges[0].eligibleSigners = [accounts[0].address]; },
  ]) {
    const {output} = fixture(); const {proofs} = await validProofs(output);
    const challengeFile = path.join(output, 'control-challenges.json');
    const challenges = JSON.parse(fs.readFileSync(challengeFile, 'utf8'));
    mutate(challenges); fs.writeFileSync(challengeFile, JSON.stringify(challenges));
    const proofFile = path.join(output, 'proofs.json'); fs.writeFileSync(proofFile, JSON.stringify(proofs));
    await assert.rejects(() => verifyControlProofs(output, proofFile));
  }
});

test('rejects preparing challenges for the wrong chain', () => {
  const {output} = fixture();
  const snapshot = JSON.parse(fs.readFileSync(path.join(output, 'mainnet-snapshot.json'))); snapshot.chainId = 46630;
  fs.writeFileSync(path.join(output, 'mainnet-snapshot.json'), JSON.stringify(snapshot));
  assert.throws(() => prepareControlChallenges(output));
});
