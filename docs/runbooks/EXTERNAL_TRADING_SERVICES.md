# External Trading Services

External trading services are operator-reviewed off-chain configuration in `services/backend-ts/packages/chain/src/external-trading.ts`. They provide router and quoter addresses for a separately reviewed trading adapter; they are not `MarketRegistry` or `FeeVault` protocol bindings. The current candidate `MarketRegistry` has no router or quoter getters or fields.

Changes to the service table require matching calldata-adapter review and a client/backend release. They do not require a core contract change or deployment. Claims remain independent of this configuration.

Trading after a reward claim is a separate wallet transaction. The claim path is raw-only and has no conversion, deadline, fallback, automatic execution, or restore API. The UI must not auto-execute an exchange after claiming.

For historical compatibility, the old deployed test release UI sends only `false,false,0` to the old claim ABI. Do not interpret that calldata as support for the current raw-asset claim interface, and do not use it as evidence of deployment or test readiness.
