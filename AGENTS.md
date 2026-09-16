# Deployment requirements

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
