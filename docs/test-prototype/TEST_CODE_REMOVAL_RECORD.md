# Test Prototype code removal record

> Historical archive only. This file describes the runtime that preceded canonical V1; it is not a V1 requirement or deployment input.

Date: 2026-09-02  
Operation: 54 explicit top-level targets moved out of the TickerGarden workspace without editing the removed files  
Recovery location: `/Users/dear/.Trash/TickerGarden-v1-code-20260902-y60RhU`

The operation is recoverable until that Trash directory is emptied. The following Test Prototype runtime material was moved:

- Root Test Prototype-oriented `README.md` and `.github/workflows/ci.yml`.
- Contract sources, tests, generated artifacts/cache, gas snapshot, and contract README.
- Backend, indexer, and deployment source/test/build output plus their Test Prototype-oriented READMEs.
- The complete `services/execution-worker/` and `spikes/v4-subscriber/` trees.
- Test Prototype Python reference math, ABI surface, permission matrix, and their tests/cache under `spec/`.
- The Test Prototype website source, build output, HTML entry, local instructions, product illustrations, and implementation/QA screenshots.
- The temporary `.codex_tmp/tickergarden_sim/` source scripts for the rejected 2,500 USDC + 1% allocation/emissions model.

Preserved intentionally:

- `TEST_*.md` and `TEST_TECHNICAL_ARCHITECTURE.md` as historical requirements/audit evidence, not executable code.
- All `V1_*.md`, `spec/v1_*`, V1 generators, V1 reference tests, and the draft specification interface.
- Pinned dependency sources/locks, generic TypeScript/Foundry configuration, brand source assets, and the Sites worker/hosting adapter.
- Historical simulation workbooks and previews under `outputs/`; these are research artifacts, not executable project code.

The fresh files now present at the same workspace paths are V1 scaffolding created after the move; they are not modifications of the removed Test Prototype files.

Post-removal verification: the static V1 boundary check passes, all remaining executable project sources are either V1 specification/generator code, generic infrastructure, or explicit fail-closed V1 scaffolding, and no retired Test Prototype path remains active.
