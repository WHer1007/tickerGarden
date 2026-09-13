# Frontend wallet snapshot adapter

2026-09-13. Frontend implementation and integration contract; the backend endpoint below is **not implemented or deployed yet**. Automated funding/publication remains TODO. This document does not activate a publisher or authorize a release cutover.

## Release selection

Add `holderRewardMode: "wallet-snapshot-v1"` to the appropriate reviewed entry in `VITE_MARKET_RELEASE_CATALOG`. The UI selects the entry by chain and the market's bound Hook from the Read API. It never guesses snapshot mode from a failed legacy RPC call. Older entries retain their existing interfaces. At transaction preparation, the app verifies the token/Factory/Registry/Distributor bindings and the actual on-chain reward mode.

The new RH testnet entry is prepared in `deployments/releases/0xc3fe24f129cdb1a7084d57a1b2c0fcc14bc6aae9c045d7e9519ee0aa96715d44/frontend-catalog-entry.json`. This is a candidate configuration fragment, not an active website configuration. Merge it with the reviewed release catalog when the backend and frontend deployment are switched together.

`VITE_HOLDER_SNAPSHOT_RELEASE_APPROVAL=HOLDER_WALLET_SNAPSHOT_V1:DEPLOYED_E2E_APPROVED` enables the claim button only after a real funded publication and claim test. Existing stream/legacy approval strings cannot enable it. The current test deployment has no publisher or real snapshot claim evidence: do not set this approval yet. Reading and presenting published data does not require this approval.

## Required Read API endpoint

`GET /v1/holder-snapshots?chainId=46630&distributor=0x...&marketId=0x...&account=0x...&cursor=...`

Served from the configured `VITE_V1_READ_API_URL`. Database reads only; no RPC, chain scanning or proof generation inside the HTTP handler. Index finalized publication and claim events and persist verified off-chain datasets/proofs in advance. API absence, incomplete indexing, inconsistent data or unavailable proof storage must return an error (prefer 503), not an empty successful response.

Response shape (all integer strings are canonical unsigned decimals, addresses/hashes lowercase):

```typescript
{
  schema: "TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1";
  chainId: number;
  displayOnly: true;
  finality: "finalized";
  distributor: Address;
  marketId: Bytes32;
  account: Address;
  quote: Address; // zero for native ETH
  meme: Address;
  sourceBlockNumber: string;
  sourceBlockHash: Bytes32;
  status: "ready" | "awaiting_funding" | "awaiting_publication" | "publisher_unconfigured";
  rounds: Array<{
    round: string; // positive uint64
    snapshotBlock: string; // uint64, strictly before sourceBlockNumber
    root: Bytes32;
    quoteAmount: string; // full leaf entitlement, NOT remaining amount
    memeAmount: string; // full leaf entitlement, NOT remaining amount
    claimedAssets: 0 | 1 | 2 | 3;
    proof: Bytes32[]; // sorted-pair Merkle proof, max 64 siblings
  }>;
  nextCursor: string | null;
}
```

At most 50 rounds per page in ascending order, no duplicates. Cursor must bind chain, distributor, market, account and finalized source block/hash. Pages cannot mix snapshots; the frontend rejects a changed source identity and asks for a refresh. `ready` with an empty list means the complete database query found no eligible published rounds for this account. It must not mean a missing worker, dataset, publisher or unavailable database.

`publisher_unconfigured` describes future publication only: existing published rounds remain claimable. Do not delete them when a Guardian revokes a publisher. Snapshot budgets belong to each market and round; do not substitute market-wide fee totals for personal entitlements.

## Frontend behavior and signing boundary

- Opening, refreshing or paging snapshot rewards fetches only this endpoint plus already-published token metadata; no RPC fallback and no global page refresh.
- Invalid identities, non-finalized data, invalid integer bounds, duplicate rounds or invalid Merkle proofs disable claiming and show unavailable/error states. They never become `$0` or a fake empty result.
- The local leaf matches the contract's double-hashed ABI-encoded domain, chain, distributor, market, uint64 round, account, Quote amount and Meme amount.
- A wallet can select only its unclaimed Quote/Meme assets. Unselected entitlements remain available. No automatic conversion, fallback choices, 24-hour stream countdown or user-requested Root transactions exist in this new UI.
- Immediately before signing, verify the live reward mode, bound distributor, round Root, snapshot block, remaining budgets and claimed flags. These are wallet-transaction checks, not page statistics. The contract remains authoritative.
- Claim `HolderRewardsDistributorV1.claimSnapshot` directly; never send current Holder claims to FeeVault's Creator/Staker claim path.
- Confirm exact `HolderSnapshotClaimed` market, round, account, asset mask and paid amounts. Temporarily overlay a confirmed claim until the DB reaches that receipt block, preventing a delayed indexer from offering the same asset again. Once the DB catches up, its finalized state replaces the overlay (including reorg outcomes).
- Requests are aborted/superseded on wallet/market changes; periodic refresh does not interrupt the claim confirmation dialog.

## Still required before website cutover

Implement and validate the read-only endpoint and its database projection/proof storage, configure the reviewed publisher, run actual fund → publish → partial claim → remaining claim tests, then enable the independent snapshot claim approval. Stock asset registration and frontend/backend release cutover are separate remaining deployment work. Do not reuse an old stream release's approval or create placeholder proofs to close these requirements.
