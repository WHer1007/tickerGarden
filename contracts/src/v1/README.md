# TickerGarden V1 contract namespace

This directory is the only production-source namespace for TickerGarden V1.

Product contracts are added only after their corresponding V1-M0 inputs, canonical ABI, permissions, state transitions, and invariants are frozen. Shared compile-time definitions and deployment libraries live under `shared/`; concrete canonical product modules live under `modules/`.

Planned source boundaries:

- `interfaces/`: interfaces generated or verified from compiled artifacts.
- `modules/`: protocol contracts after their implementation gates open.
- `libraries/`: V1-only math, identity, accounting, and validation libraries.
- `shared/`: product-neutral V1 compile-time definitions.

No source in this namespace may import a V1 product contract, interface, library, mock, or fixture.
