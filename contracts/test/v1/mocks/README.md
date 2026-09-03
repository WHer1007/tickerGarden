# V1 mocks

Test doubles in this directory model only frozen V1 behaviors and never import
a V1 product implementation. `MockV1QuoteAssets.sol` provides exact ERC-20,
fee-on-transfer, rebasing, callback/reentrancy, anomalous return-data, and
forced-native-transfer controls. Their compiled runtime hashes are pinned by
the generated fixture manifest; they are test controls, not approved assets or
production contract implementations.
