# Environment and branch policy

TickerGarden has three isolated execution environments. Local development is never a deployment source. Test and production use separate Git branches, chain identities, Vercel targets, aliases, databases, RPC credentials, queues, storage and signing keys.

| Environment | Git source | Chain | Frontend data | Backend data | Vercel target |
| --- | --- | --- | --- | --- | --- |
| Local | `codex/*` | disposable local node or an explicitly pinned read-only fork | local services; direct-chain adapters may be enabled only by an explicit local start command | local PostgreSQL, local RPC gateway and local state directories | none |
| Test | `test` | Robinhood Testnet `46630` | deployed Read API, Content API and HTTPS RPC | test database, test RPC, test queues, test buckets and test signers | Preview, then test aliases |
| Production | `master` | Robinhood Mainnet `4663` | production Read API, Content API and HTTPS RPC | production database, production RPC, production queues, production buckets and production signers | Production |

## Branch flow

1. Develop and run local integration on `codex/<task>`.
2. Merge the reviewed feature branch into `test`. Only the exact `test` branch may publish or update test aliases.
3. Complete test-chain acceptance against the deployed test frontend and backend.
4. Promote the accepted `test` product tree to `master` through review. Do not add untested product changes directly on `master`.
5. Production deployment requires the existing explicit production authorization, the `master` branch, an identical product tree to `test`, production-scoped variables, and the regional gate.

The existing `test` and `master` branches are canonical. Do not create parallel names such as `staging`, `prod`, `main` or environment-specific feature branches. Release tags record immutable accepted commits; they do not replace the branches.

## Deployment gate

Before uploading any source, run the branch gate locally:

```sh
node tools/deployment-boundary.mjs test web --source-only
```

Use `production` instead of `test` only from `master` after explicit production authorization. Sensitive Vercel variables cannot be downloaded after creation, so the complete command runs as the first build step inside the corresponding Vercel project, where scoped values are available. Each checked-in `vercel.json` invokes it automatically:

```sh
node tools/deployment-boundary.mjs test web
node tools/deployment-boundary.mjs test read-api
node tools/deployment-boundary.mjs test pipeline
node tools/deployment-boundary.mjs test content
```

Run only the line for the project being built. The complete checker rejects the wrong branch, chain, Vercel target, local URLs and paths, browser integration bootstraps, shared credentials, and variables owned by another service.

Connected Git deployments use `VERCEL_GIT_COMMIT_REF`. A manual CLI deployment must pass the already-validated branch as `TG_SOURCE_BRANCH` in its build environment; otherwise a detached or missing source identity blocks the build.

Every deployment command must also pass `--regions sin1`. Before assigning any alias or promoting production, run `node services/backend-ts/scripts/check-vercel-region.mjs <deployment-url-or-id>` and require every function to report `sin1`.

## Data boundaries

- Web receives public `VITE_*` configuration plus `TG_PROFILE` and the server-side Web RPC proxy value. It never receives database, queue, storage or signer credentials.
- Read API receives its read-only database role and allowed Web origin. It does not receive pipeline, content, RPC publishing or signing credentials.
- Pipeline receives its database role, RPC endpoints, chain queue credentials and repair controls. It does not receive content storage credentials.
- Content receives its database role, storage credentials, content queue credentials and allowed Web origin. It does not receive chain-worker credentials.
- Test and production never use the same database URL, queue token, bucket, webhook signing key, holder signer or operational state directory.

Local fixtures belong under test or local-tool directories. Nothing under a local integration directory may be copied into a Web `public` directory or deployment artifact.
