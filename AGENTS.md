# Operations workspace

- Store TickerGarden marketing and community operations artifacts in `/Users/dear/Documents/TickerGarden-Operations`, outside this code repository.
- This includes contact lists, outreach research, DM drafts, X posts and replies, publication records, campaign documents, and social media assets.
- Do not create repository copies or symlinks of these artifacts, and never stage, commit, or force-add them to Git. Keep product code, technical documentation, and product UI assets in their existing development locations.

# Deployment requirements

## Production RPC policy

- Production application RPC traffic must use QuickNode. Do not configure Alchemy as a primary or fallback endpoint.
- When independent third-party verification is required, use a chain-verified public RPC endpoint for that verification only; do not make it an automatic fallback for ordinary traffic.
- The 2026-11-02 RPC cleanup is production-only. Leave test environment configuration unchanged.

## Display Worker RPC boundary

- The Display Worker must never scan block ranges, synchronize chain history, or fall back to block scanning for recovery, reconnects, late events, or inbox saturation.
- RPC access requires a concrete upstream event or an explicit active request and must remain bounded to that event/request. Idle loops, timer expiry, process startup, and health checks do not authorize RPC calls.
- Price notifications may refresh persisted display valuations and publish changed views, but must not trigger chain RPC or chain advancement.
- Process pushed events from a durable inbox. Missing notifications, duplicates, reorgs, and reconnects must preserve correctness without introducing an autonomous scan path in the Display Worker; unresolved gaps must remain explicit rather than being marked synchronized.

All Vercel deployments must run in Singapore (`sin1`). This applies to Web, Read API, Pipeline, Content, preview/test and any separately authorized production deployment.

- Pass `--regions sin1` explicitly to every Vercel deployment command, including deployments from a staging or monorepo root. Do not rely solely on nested `vercel.json`, a project sandbox default, or a previous deployment.
- Before aliasing or promoting a deployment, run `node services/backend-ts/scripts/check-vercel-region.mjs <deployment-url-or-id>` from the repository root. Every runtime function must be confirmed in `sin1`. Missing region evidence or any other region blocks publication.
- The build-machine region is not the runtime region. Do not treat a build in `cle1` as a failure when deployed functions are confirmed in `sin1`.
- Keep existing production authorization boundaries. Region policy does not authorize production deployment.

## Environment branch requirements

- `codex/*` branches are for development and local integration only. Never deploy them or assign a Vercel alias from them.
- `test` is the only source branch for Robinhood Testnet `46630` and Vercel Preview deployments assigned to test aliases.
- `master` is the only source branch for Robinhood Mainnet `4663` and Vercel Production deployments. Production still requires explicit authorization.
- Promote the accepted product tree from `test` to `master`; do not add untested product changes directly to `master`.
- Before source upload, run `node tools/deployment-boundary.mjs <test|production> <web|read-api|pipeline|content> --source-only`. Run the same command without `--source-only` as the first Vercel build step, where the target project's scoped variables are available. A failed boundary check blocks deployment.
- Local, test and production must use separate databases, RPC credentials, queues, storage, signers and aliases. Local bootstrap files and loopback endpoints may never enter a deployed environment.
