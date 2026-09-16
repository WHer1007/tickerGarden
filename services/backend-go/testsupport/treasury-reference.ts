import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "../../../apps/web/node_modules/viem/_esm/index.js";

export const EMPTY_EPOCH_ROOT = keccak256(stringToHex("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1"));
export const EPOCH_DURATION_SECONDS = 7n * 24n * 60n * 60n;
export const CLAIM_LEAF_DOMAIN = keccak256(stringToHex("TICKERGARDEN_V1_TREASURY_CLAIM_V1"));
export const TWAB_SCHEMA = keccak256(stringToHex("TRANSFER_LOG_TWAB_7D_V1"));
export const ELIGIBILITY_POLICY_DOMAIN = keccak256(
  stringToHex("TICKERGARDEN_V1_TREASURY_ELIGIBILITY_POLICY_V1"),
);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface TransferObservation {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  timestamp: bigint;
  from: Address;
  to: Address;
  value: bigint;
}

export interface TreasuryRootInput {
  /** Opt in only after verifying complete canonical transfer history, including initial supply. */
  emptyEpochPolicy?: "reviewed-rollover";
  chainId: bigint;
  distributor: Address;
  marketId: Hex;
  memeToken: Address;
  quoteToken: Address;
  eligibilityPolicyHash: Hex;
  excludedAccounts: readonly Address[];
  epochId: number;
  windowStart: bigint;
  windowEnd: bigint;
  sourceBlockNumber: bigint;
  sourceBlockHash: Hex;
  sourceBlockTimestamp: bigint;
  quoteAmount: bigint;
  transfers: readonly TransferObservation[];
}

export interface TreasuryClaimContext {
  chainId: bigint;
  distributor: Address;
  marketId: Hex;
  epochId: number;
  memeToken: Address;
  quoteToken: Address;
  eligibilityPolicyHash: Hex;
  windowStart: bigint;
  windowEnd: bigint;
  sourceBlockNumber: bigint;
  sourceBlockHash: Hex;
}

export interface TreasuryLeaf {
  index: number;
  account: Address;
  twab: bigint;
  amount: bigint;
  leaf: Hex;
  proof: readonly Hex[];
}

export interface TreasuryRootOutput {
  schema: "TICKERGARDEN_V1_TREASURY_ROOT_V1";
  context: TreasuryClaimContext;
  sourceBlockTimestamp: bigint;
  merkleRoot: Hex;
  datasetHash: Hex;
  leafCount: number;
  totalTwab: bigint;
  totalAllocated: bigint;
  leaves: readonly TreasuryLeaf[];
}

interface AccountAccumulator {
  balance: bigint;
  lastTimestamp: bigint;
  weightedBalance: bigint;
}

interface AllocationDraft {
  account: Address;
  twab: bigint;
  amount: bigint;
  remainder: bigint;
}

const contextComponents = [
  { name: "chainId", type: "uint256" },
  { name: "distributor", type: "address" },
  { name: "marketId", type: "bytes32" },
  { name: "epochId", type: "uint32" },
  { name: "memeToken", type: "address" },
  { name: "quoteToken", type: "address" },
  { name: "eligibilityPolicyHash", type: "bytes32" },
  { name: "windowStart", type: "uint64" },
  { name: "windowEnd", type: "uint64" },
  { name: "sourceBlockNumber", type: "uint64" },
  { name: "sourceBlockHash", type: "bytes32" },
] as const;

export function computeEligibilityPolicyHash(
  chainId: bigint,
  marketId: Hex,
  excludedAccounts: readonly Address[],
): Hex {
  const normalized = normalizeAddresses(excludedAccounts);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address[]" },
      ],
      [ELIGIBILITY_POLICY_DOMAIN, chainId, marketId, normalized],
    ),
  );
}

export function hashTreasuryLeaf(
  context: TreasuryClaimContext,
  leafIndex: bigint,
  account: Address,
  twab: bigint,
  amount: bigint,
): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "tuple", components: contextComponents },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [CLAIM_LEAF_DOMAIN, TWAB_SCHEMA, context, leafIndex, account, twab, amount],
    ),
  );
  return keccak256(inner);
}

export function generateTreasuryRoot(input: TreasuryRootInput): TreasuryRootOutput {
  validateInput(input);
  const exclusions = new Set(normalizeAddresses(input.excludedAccounts).map((account) => account.toLowerCase()));
  const observations = normalizeObservations(input.transfers);
  const balances = new Map<string, bigint>();
  const accumulators = new Map<string, AccountAccumulator>();

  const checkpoint = (account: Address, timestamp: bigint): AccountAccumulator => {
    const key = account.toLowerCase();
    const existing = accumulators.get(key) ?? {
      balance: balances.get(key) ?? 0n,
      lastTimestamp: input.windowStart,
      weightedBalance: 0n,
    };
    if (timestamp < existing.lastTimestamp) throw new Error(`non-monotonic account timestamp for ${account}`);
    existing.weightedBalance += existing.balance * (timestamp - existing.lastTimestamp);
    if (existing.weightedBalance > MAX_UINT256) throw new Error(`TWAB exceeds uint256 for ${account}`);
    existing.lastTimestamp = timestamp;
    accumulators.set(key, existing);
    return existing;
  };

  for (const observation of observations) {
    if (observation.blockNumber > input.sourceBlockNumber) {
      throw new Error("transfer observation is newer than the committed source block");
    }
    if (observation.timestamp > input.sourceBlockTimestamp) {
      throw new Error("transfer observation is newer than the committed source block timestamp");
    }
    if (observation.timestamp >= input.windowEnd) continue;

    const from = getAddress(observation.from);
    const to = getAddress(observation.to);
    const withinWindow = observation.timestamp >= input.windowStart;
    if (withinWindow && from !== ZERO_ADDRESS) checkpoint(from, observation.timestamp);
    if (withinWindow && to !== ZERO_ADDRESS && to !== from) checkpoint(to, observation.timestamp);

    if (from !== ZERO_ADDRESS) {
      const fromKey = from.toLowerCase();
      const fromBalance = balances.get(fromKey) ?? 0n;
      if (fromBalance < observation.value) {
        throw new Error(`incomplete or invalid Transfer history: negative balance for ${from}`);
      }
      const next = fromBalance - observation.value;
      balances.set(fromKey, next);
      const accumulator = accumulators.get(fromKey);
      if (accumulator) accumulator.balance = next;
    }
    if (to !== ZERO_ADDRESS) {
      const toKey = to.toLowerCase();
      const next = (balances.get(toKey) ?? 0n) + observation.value;
      if (next > MAX_UINT256) throw new Error(`balance exceeds uint256 for ${to}`);
      balances.set(toKey, next);
      const accumulator = accumulators.get(toKey);
      if (accumulator) accumulator.balance = next;
    }
  }

  for (const [key, balance] of balances) {
    if (balance === 0n && !accumulators.has(key)) continue;
    checkpoint(getAddress(key), input.windowEnd);
  }
  for (const [key, accumulator] of accumulators) {
    if (accumulator.lastTimestamp < input.windowEnd) checkpoint(getAddress(key), input.windowEnd);
  }

  const weightedAccounts = [...accumulators.entries()]
    .filter(([account, value]) => value.weightedBalance > 0n && !exclusions.has(account))
    .map(([account, value]) => ({ account: getAddress(account), twab: value.weightedBalance }))
    .sort((left, right) => compareAddress(left.account, right.account));
  const context: TreasuryClaimContext = {
    chainId: input.chainId,
    distributor: getAddress(input.distributor),
    marketId: input.marketId,
    epochId: input.epochId,
    memeToken: getAddress(input.memeToken),
    quoteToken: getAddress(input.quoteToken),
    eligibilityPolicyHash: input.eligibilityPolicyHash,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    sourceBlockNumber: input.sourceBlockNumber,
    sourceBlockHash: input.sourceBlockHash,
  };
  if (weightedAccounts.length === 0) {
    if (input.emptyEpochPolicy !== "reviewed-rollover") throw new Error("no eligible TWAB holders; verified empty-epoch policy is required");
    return {
      schema: "TICKERGARDEN_V1_TREASURY_ROOT_V1", context,
      sourceBlockTimestamp: input.sourceBlockTimestamp,
      merkleRoot: EMPTY_EPOCH_ROOT,
      datasetHash: hashDataset(context, input.sourceBlockTimestamp, input.quoteAmount, 0n, []),
      leafCount: 0, totalTwab: 0n, totalAllocated: 0n, leaves: [],
    };
  }

  const totalTwab = weightedAccounts.reduce((sum, value) => {
    const next = sum + value.twab;
    if (next > MAX_UINT256) throw new Error("total TWAB exceeds uint256");
    return next;
  }, 0n);
  const drafts: AllocationDraft[] = weightedAccounts.map(({ account, twab }) => {
    const product = input.quoteAmount * twab;
    return {
      account,
      twab,
      amount: product / totalTwab,
      remainder: product % totalTwab,
    };
  });
  const baseAllocated = drafts.reduce((sum, value) => sum + value.amount, 0n);
  const roundingUnits = input.quoteAmount - baseAllocated;
  const remainderOrder = [...drafts].sort((left, right) => {
    if (left.remainder === right.remainder) return compareAddress(left.account, right.account);
    return left.remainder > right.remainder ? -1 : 1;
  });
  if (roundingUnits > BigInt(remainderOrder.length)) throw new Error("rounding allocation invariant violated");
  for (let i = 0; i < Number(roundingUnits); i += 1) {
    const draft = remainderOrder[i];
    if (!draft) throw new Error("rounding allocation index missing");
    draft.amount += 1n;
  }

  const fundedDrafts = drafts.filter((draft) => draft.amount > 0n);
  if (fundedDrafts.length > 0xffff_ffff) throw new Error("leaf count exceeds uint32");
  const leavesWithoutProof = fundedDrafts
    .sort((left, right) => compareAddress(left.account, right.account))
    .map((draft, index) => ({
      index,
      account: draft.account,
      twab: draft.twab,
      amount: draft.amount,
      leaf: hashTreasuryLeaf(context, BigInt(index), draft.account, draft.twab, draft.amount),
    }));
  const tree = buildMerkleTree(leavesWithoutProof.map((value) => value.leaf));
  const leaves = leavesWithoutProof.map((value, index) => ({ ...value, proof: tree.proofs[index] ?? [] }));
  const totalAllocated = leaves.reduce((sum, value) => sum + value.amount, 0n);
  if (totalAllocated !== input.quoteAmount) throw new Error("allocation does not consume the epoch quote amount");

  const datasetHash = hashDataset(context, input.sourceBlockTimestamp, input.quoteAmount, totalTwab, leaves);
  return {
    schema: "TICKERGARDEN_V1_TREASURY_ROOT_V1",
    context,
    sourceBlockTimestamp: input.sourceBlockTimestamp,
    merkleRoot: tree.root,
    datasetHash,
    leafCount: leaves.length,
    totalTwab,
    totalAllocated,
    leaves,
  };
}

export function verifyMerkleProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  return proof.reduce(hashPair, leaf).toLowerCase() === root.toLowerCase();
}

function buildMerkleTree(leaves: readonly Hex[]): { root: Hex; proofs: readonly (readonly Hex[])[] } {
  if (leaves.length === 0) throw new Error("cannot build an empty Merkle tree");
  const levels: Hex[][] = [[...leaves]];
  while ((levels.at(-1)?.length ?? 0) > 1) {
    const current = levels.at(-1);
    if (!current) throw new Error("Merkle level missing");
    const next: Hex[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      const right = current[index + 1];
      if (!left) throw new Error("Merkle node missing");
      next.push(right ? hashPair(left, right) : left);
    }
    levels.push(next);
  }

  const proofs = leaves.map((_, leafIndex) => {
    const proof: Hex[] = [];
    let index = leafIndex;
    for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
      const level = levels[levelIndex];
      if (!level) throw new Error("Merkle level missing");
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      const sibling = level[siblingIndex];
      if (sibling) proof.push(sibling);
      index = Math.floor(index / 2);
    }
    return proof;
  });
  const root = levels.at(-1)?.[0];
  if (!root) throw new Error("Merkle root missing");
  return { root, proofs };
}

function hashPair(left: Hex, right: Hex): Hex {
  return BigInt(left) < BigInt(right)
    ? keccak256(concatHex([left, right]))
    : keccak256(concatHex([right, left]));
}

function hashDataset(
  context: TreasuryClaimContext,
  sourceBlockTimestamp: bigint,
  quoteAmount: bigint,
  totalTwab: bigint,
  leaves: readonly Omit<TreasuryLeaf, "proof">[],
): Hex {
  const canonical = JSON.stringify({
    schema: "TICKERGARDEN_V1_TREASURY_DATASET_V1",
    context: serializeContext(context),
    sourceBlockTimestamp: sourceBlockTimestamp.toString(),
    quoteAmount: quoteAmount.toString(),
    totalTwab: totalTwab.toString(),
    allocations: leaves.map((value) => ({
      index: value.index,
      account: value.account.toLowerCase(),
      twab: value.twab.toString(),
      amount: value.amount.toString(),
      leaf: value.leaf.toLowerCase(),
    })),
  });
  return keccak256(stringToHex(canonical));
}

function serializeContext(context: TreasuryClaimContext): Record<string, string | number> {
  return {
    chainId: context.chainId.toString(),
    distributor: context.distributor.toLowerCase(),
    marketId: context.marketId.toLowerCase(),
    epochId: context.epochId,
    memeToken: context.memeToken.toLowerCase(),
    quoteToken: context.quoteToken.toLowerCase(),
    eligibilityPolicyHash: context.eligibilityPolicyHash.toLowerCase(),
    windowStart: context.windowStart.toString(),
    windowEnd: context.windowEnd.toString(),
    sourceBlockNumber: context.sourceBlockNumber.toString(),
    sourceBlockHash: context.sourceBlockHash.toLowerCase(),
  };
}

function normalizeObservations(observations: readonly TransferObservation[]): TransferObservation[] {
  const normalized = observations.map((value) => {
    if (!isAddress(value.from) || !isAddress(value.to)) throw new Error("invalid Transfer address");
    if (
      value.value < 0n ||
      value.value > MAX_UINT256 ||
      value.timestamp < 0n ||
      value.timestamp > MAX_UINT64 ||
      value.blockNumber < 0n ||
      value.blockNumber > MAX_UINT64
    ) {
      throw new Error("invalid Transfer numeric field");
    }
    if (
      !Number.isSafeInteger(value.transactionIndex) ||
      value.transactionIndex < 0 ||
      !Number.isSafeInteger(value.logIndex) ||
      value.logIndex < 0
    ) {
      throw new Error("invalid Transfer provenance index");
    }
    return { ...value, from: getAddress(value.from), to: getAddress(value.to) };
  });
  normalized.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
    if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex;
    return left.logIndex - right.logIndex;
  });
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (!previous || !current) throw new Error("Transfer ordering failure");
    if (
      previous.blockNumber === current.blockNumber &&
      previous.transactionIndex === current.transactionIndex &&
      previous.logIndex === current.logIndex
    ) {
      throw new Error("duplicate Transfer provenance");
    }
    if (current.timestamp < previous.timestamp) throw new Error("block timestamps are not monotonic");
  }
  return normalized;
}

function normalizeAddresses(addresses: readonly Address[]): Address[] {
  const unique = new Set<string>();
  for (const address of addresses) {
    if (!isAddress(address)) throw new Error(`invalid address: ${address}`);
    unique.add(getAddress(address).toLowerCase());
  }
  return [...unique].sort().map((address) => getAddress(address));
}

function compareAddress(left: Address, right: Address): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

function validateInput(input: TreasuryRootInput): void {
  if (!isAddress(input.distributor) || !isAddress(input.memeToken) || !isAddress(input.quoteToken)) {
    throw new Error("invalid contract address");
  }
  if (
    input.distributor.toLowerCase() === ZERO_ADDRESS ||
    input.memeToken.toLowerCase() === ZERO_ADDRESS
  ) {
    throw new Error("contract address cannot be zero");
  }
  if (input.memeToken.toLowerCase() === input.quoteToken.toLowerCase()) {
    throw new Error("meme and quote tokens must differ");
  }
  if (
    input.chainId <= 0n ||
    input.chainId > MAX_UINT256 ||
    !isBytes32(input.marketId) ||
    isZeroBytes32(input.marketId) ||
    !isBytes32(input.eligibilityPolicyHash) ||
    isZeroBytes32(input.eligibilityPolicyHash)
  ) {
    throw new Error("invalid chain, market, or policy domain");
  }
  if (input.epochId <= 0 || input.epochId > 0xffff_ffff || !Number.isSafeInteger(input.epochId)) {
    throw new Error("invalid epoch id");
  }
  if (
    input.windowStart <= 0n ||
    input.windowStart > MAX_UINT64 ||
    input.windowEnd <= input.windowStart ||
    input.windowEnd > MAX_UINT64
  ) {
    throw new Error("invalid TWAB window");
  }
  if (input.windowEnd - input.windowStart !== EPOCH_DURATION_SECONDS) {
    throw new Error("TWAB window must be exactly 7 days");
  }
  if (
    input.sourceBlockNumber < 0n ||
    input.sourceBlockNumber > MAX_UINT64 ||
    input.sourceBlockTimestamp < input.windowEnd ||
    input.sourceBlockTimestamp > MAX_UINT64 ||
    !isBytes32(input.sourceBlockHash) ||
    isZeroBytes32(input.sourceBlockHash) ||
    input.quoteAmount <= 0n ||
    input.quoteAmount > MAX_UINT256
  ) {
    throw new Error("invalid source or quote amount");
  }
  const policyHash = computeEligibilityPolicyHash(input.chainId, input.marketId, input.excludedAccounts);
  if (policyHash.toLowerCase() !== input.eligibilityPolicyHash.toLowerCase()) {
    throw new Error("eligibility policy hash mismatch");
  }
}

function isBytes32(value: string): value is Hex {
  return /^0x[0-9a-f]{64}$/i.test(value);
}

function isZeroBytes32(value: string): boolean {
  return /^0x0{64}$/i.test(value);
}
