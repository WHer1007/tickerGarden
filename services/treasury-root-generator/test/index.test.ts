import assert from "node:assert/strict";
import test from "node:test";

import {
  EPOCH_DURATION_SECONDS,
  computeEligibilityPolicyHash,
  generateTreasuryRoot,
  hashTreasuryLeaf,
  verifyMerkleProof,
  type TransferObservation,
  type TreasuryRootInput,
} from "../src/index.ts";

const ZERO = "0x0000000000000000000000000000000000000000";
const DISTRIBUTOR = "0x000000000000000000000000000000000000d157";
const MEME = "0x0000000000000000000000000000000000001000";
const QUOTE = "0x0000000000000000000000000000000000002000";
const ALICE = "0x000000000000000000000000000000000000a11c";
const BOB = "0x0000000000000000000000000000000000000b0b";
const MARKET_ID = `0x${"11".repeat(32)}` as const;
const SOURCE_HASH = `0x${"22".repeat(32)}` as const;
const SINGLE_HOLDER_VECTOR = "0x563309c36eaee683b8f3b6290c5227f9fc1027356d8e5c134a4b0e8c586e3aff";
const START = 1_700_000_000n;

function observation(
  blockNumber: bigint,
  timestamp: bigint,
  from: string,
  to: string,
  value: bigint,
  logIndex = 0,
): TransferObservation {
  return {
    blockNumber,
    transactionIndex: 0,
    logIndex,
    timestamp,
    from: from as TransferObservation["from"],
    to: to as TransferObservation["to"],
    value,
  };
}

function input(
  transfers: TransferObservation[],
  excludedAccounts: string[] = [],
  quoteToken: string = QUOTE,
): TreasuryRootInput {
  const policy = computeEligibilityPolicyHash(
    46630n,
    MARKET_ID,
    excludedAccounts as TreasuryRootInput["excludedAccounts"],
  );
  return {
    chainId: 46630n,
    distributor: DISTRIBUTOR,
    marketId: MARKET_ID,
    memeToken: MEME,
    quoteToken: quoteToken as TreasuryRootInput["quoteToken"],
    eligibilityPolicyHash: policy,
    excludedAccounts: excludedAccounts as TreasuryRootInput["excludedAccounts"],
    epochId: 1,
    windowStart: START,
    windowEnd: START + EPOCH_DURATION_SECONDS,
    sourceBlockNumber: 999n,
    sourceBlockHash: SOURCE_HASH,
    sourceBlockTimestamp: START + EPOCH_DURATION_SECONDS + 60n,
    quoteAmount: 1_000n,
    transfers,
  };
}

test("accepts native ETH as the quote token while requiring nonzero distributor and meme token", () => {
  const nativeInput = input([observation(1n, START - 1n, ZERO, ALICE, 100n)], [], ZERO);
  const output = generateTreasuryRoot(nativeInput);
  assert.equal(output.context.quoteToken.toLowerCase(), ZERO);

  const zeroDistributor = { ...nativeInput, distributor: ZERO as TreasuryRootInput["distributor"] };
  assert.throws(
    () => generateTreasuryRoot(zeroDistributor),
    /contract address cannot be zero/,
  );
  const zeroMeme = { ...nativeInput, memeToken: ZERO as TreasuryRootInput["memeToken"] };
  assert.throws(() => generateTreasuryRoot(zeroMeme), /contract address cannot be zero/);
});

test("computes a 7-day TWAB, exact largest-remainder allocation, and valid proofs", () => {
  const half = EPOCH_DURATION_SECONDS / 2n;
  const output = generateTreasuryRoot(
    input([
      observation(1n, START - 100n, ZERO, ALICE, 100n),
      observation(500n, START + half, ALICE, BOB, 50n),
    ]),
  );

  const alice = output.leaves.find((leaf) => leaf.account.toLowerCase() === ALICE.toLowerCase());
  const bob = output.leaves.find((leaf) => leaf.account.toLowerCase() === BOB.toLowerCase());
  assert.ok(alice);
  assert.ok(bob);
  assert.equal(alice.twab, 100n * half + 50n * half);
  assert.equal(bob.twab, 50n * half);
  assert.equal(alice.amount, 750n);
  assert.equal(bob.amount, 250n);
  assert.equal(output.totalAllocated, 1_000n);
  assert.ok(output.leaves.every((leaf) => verifyMerkleProof(leaf.leaf, leaf.proof, output.merkleRoot)));
});

test("treats a transfer followed by true burn at one timestamp as zero-duration treasury holding", () => {
  const half = EPOCH_DURATION_SECONDS / 2n;
  const output = generateTreasuryRoot(
    input([
      observation(1n, START - 1n, ZERO, ALICE, 100n),
      observation(500n, START + half, ALICE, DISTRIBUTOR, 40n, 0),
      observation(500n, START + half, DISTRIBUTOR, ZERO, 40n, 1),
    ]),
  );
  assert.equal(output.leaves.length, 1);
  assert.equal(output.leaves[0]?.twab, 100n * half + 60n * half);
  assert.equal(output.leaves[0]?.amount, 1_000n);
});

test("eligibility policy excludes committed accounts and detects policy drift", () => {
  const valid = input(
    [
      observation(1n, START - 1n, ZERO, ALICE, 100n),
      observation(2n, START - 1n, ZERO, BOB, 100n),
    ],
    [BOB],
  );
  const output = generateTreasuryRoot(valid);
  assert.equal(output.leaves.length, 1);
  assert.equal(output.leaves[0]?.account.toLowerCase(), ALICE.toLowerCase());

  assert.throws(
    () => generateTreasuryRoot({ ...valid, excludedAccounts: [] }),
    /eligibility policy hash mismatch/,
  );
});

test("rejects incomplete histories, non-7-day windows, and observations beyond the source tip", () => {
  assert.throws(
    () => generateTreasuryRoot(input([observation(2n, START, ALICE, BOB, 1n)])),
    /negative balance/,
  );

  const wrongWindow = input([observation(1n, START - 1n, ZERO, ALICE, 1n)]);
  wrongWindow.windowEnd -= 1n;
  assert.throws(() => generateTreasuryRoot(wrongWindow), /exactly 7 days/);

  assert.throws(
    () => generateTreasuryRoot(input([observation(1_000n, START - 1n, ZERO, ALICE, 1n)])),
    /newer than the committed source block/,
  );

  const incompleteSource = input([observation(1n, START - 1n, ZERO, ALICE, 1n)]);
  incompleteSource.sourceBlockTimestamp = incompleteSource.windowEnd - 1n;
  assert.throws(() => generateTreasuryRoot(incompleteSource), /invalid source/);
});

test("omits zero-value claims when Quote is smaller than the eligible holder count", () => {
  const value = input([
    observation(1n, START - 1n, ZERO, ALICE, 100n),
    observation(2n, START - 1n, ZERO, BOB, 100n),
  ]);
  value.quoteAmount = 1n;

  const output = generateTreasuryRoot(value);
  assert.equal(output.leafCount, 1);
  assert.equal(output.leaves[0]?.amount, 1n);
  assert.equal(output.totalAllocated, 1n);
  assert.ok(output.leaves.every((leaf) => leaf.amount > 0n));
});

test("V1 leaf hash changes across every replay-protection dimension", () => {
  const output = generateTreasuryRoot(input([observation(1n, START - 1n, ZERO, ALICE, 100n)]));
  const leaf = output.leaves[0];
  assert.ok(leaf);
  assert.equal(leaf.leaf, SINGLE_HOLDER_VECTOR);
  assert.equal(
    leaf.leaf,
    hashTreasuryLeaf(output.context, BigInt(leaf.index), leaf.account, leaf.twab, leaf.amount),
  );
  assert.notEqual(
    leaf.leaf,
    hashTreasuryLeaf({ ...output.context, chainId: 1n }, BigInt(leaf.index), leaf.account, leaf.twab, leaf.amount),
  );
  assert.notEqual(
    leaf.leaf,
    hashTreasuryLeaf(output.context, BigInt(leaf.index + 1), leaf.account, leaf.twab, leaf.amount),
  );
});
