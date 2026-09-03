# TickerGarden V2 Treasury preview

This namespace contains only the future V2 Treasury subsystem (`V2-TREASURY-EXEC-1`). It is intentionally excluded from the V1 source profile, ABI generation, deployment manifests, indexer, backend, website client, and fee policy.

Boundaries:

- `interfaces/ITreasuryV2.sol`: fee-neutral funding and distribution ABI.
- `modules/TreasuryDistributorV2.sol`: one shared, market-isolated Quote ledger and paid attested-root lifecycle.
- `modules/TickerMemeTokenV2.sol`: fixed mint plus Distributor-only true supply burn.
- `libraries/TreasuryClaimLeafV2.sol`: frozen Merkle leaf domain.
- `shared/ImmutableAccessManagedV2.sol`: selector-scoped immutable authority adapter.

No file in this namespace may import a V1 product source or mutate a V1 contract. The V2 profile is a preview gate, not deployment approval.
