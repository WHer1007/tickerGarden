# V1 fixtures

`v1-fork-fixtures.json` is the deterministic V1-E-105-A fixture manifest. It
freezes both initial Quote configurations, all 14 approved Pons behavior
vectors, two chain snapshots, and the deployed-runtime hashes of the local
asset behavior mocks. Regenerate it only with:

```sh
npm run build:contracts
python3 spec/generate_v1_test_fixtures.py
```

`npm run check:fixtures` compares the complete generated document, its source
file SHA-256 values, runtime Keccak-256 values, and its canonical fixture-set
hash. `V1QuoteFixtures.t.sol` exercises the local asset behaviors without an
RPC.

This layer is `FIXTURES_ACTIVE`, not live-fork or production evidence. Tests in
`contracts/test/v1/fork` remain absent until an archive RPC can replay the
fixed block/hash pairs in the manifest.
