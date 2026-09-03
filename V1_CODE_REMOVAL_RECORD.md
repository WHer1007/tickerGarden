# V1 code removal record

Date: 2026-09-02  
Operation: 54 explicit top-level targets moved out of the TickerGarden workspace without editing the removed files  
Recovery location: `/Users/dear/.Trash/TickerGarden-v1-code-20260902-y60RhU`

The operation is recoverable until that Trash directory is emptied. The following V1 runtime material was moved:

- Root V1-oriented `README.md` and `.github/workflows/ci.yml`.
- Contract sources, tests, generated artifacts/cache, gas snapshot, and contract README.
- Backend, indexer, and deployment source/test/build output plus their V1-oriented READMEs.
- The complete `services/execution-worker/` and `spikes/v4-subscriber/` trees.
- V1 Python reference math, ABI surface, permission matrix, and their tests/cache under `spec/`.
- The V1 website source, build output, HTML entry, local instructions, product illustrations, and implementation/QA screenshots.
- The temporary `.codex_tmp/tickergarden_sim/` source scripts for the rejected 2,500 USDC + 1% allocation/emissions model.

Preserved intentionally:

- `V1_*.md` and `TECHNICAL_ARCHITECTURE.md` as historical requirements/audit evidence, not executable code.
- All `V2_*.md`, `spec/v2_*`, V2 generators, V2 reference tests, and the draft specification interface.
- Pinned dependency sources/locks, generic TypeScript/Foundry configuration, brand source assets, and the Sites worker/hosting adapter.
- Historical simulation workbooks and previews under `outputs/`; these are research artifacts, not executable project code.

The fresh files now present at the same workspace paths are V2 scaffolding created after the move; they are not modifications of the removed V1 files.

Post-removal verification: the static V2 boundary check passes, all remaining executable project sources are either V2 specification/generator code, generic infrastructure, or explicit fail-closed V2 scaffolding, and no retired V1 path remains active.
