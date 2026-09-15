最新 RH 测试网原子首买：[部署、公开链测试与激活报告](../../deployments/releases/0x985650b4d3758a5345be196182d2945b9c2df3f828fdb4dbd1a94e4b6def2b64/ATOMIC_BUY_REPORT.md)。

RH 测试网资料入口：[网络、官方资产、v4 池、部署地址与 ETH 原子首买参考](./V1_ROBINHOOD_TESTNET_REFERENCE.md)。

> 2026-09-06 更新：R3 测试链版本已部署，使用 7 天持有人周期与 0.42 ETH 测试毕业门槛。此前重命名候选的 NOT_BROADCAST / 阻塞记录属于历史阶段；当前验证范围和时间限制以 [R3 测试报告](../../outputs/reviews/arbitrum-r3-scenarios/REPORT.md) 为准。RH 生产就绪仍未确认。

# TickerGarden V1 documentation index

品牌重命名说明：当前源码与 ABI 是未部署候选版本。本文涉及的 R2 地址与链上快照仍属重命名前版本，不能将新 ABI 用于旧 R2；后续新 release 必须重新部署并重新生成操作记录。本索引不写部署成功结论，也不修改历史链上事实。

Current Arbitrum Sepolia R2 status: `DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY`; see the [confirmed deployment](../../deployments/manifests/arbitrum-sepolia-421614.v1.deployed.json) and [activation manifest](../../deployments/manifests/arbitrum-sepolia-421614.v1.activation.json). RH remains the final production target; this is not production readiness. The earlier [`optional-stock-staking` review](../../outputs/reviews/optional-stock-staking/) and [gate evidence](../../deployments/evidence/v1-optional-staking-gates.json) describe their historical pre-broadcast checkpoint.

`V1-EXEC-11` is the current execution baseline. Machine-readable manifests under [`spec/`](../../spec/) take precedence when a prose document and generated protocol artifact disagree.

## Canonical product and execution rules

- [`V1_EXECUTION_SPEC.md`](./V1_EXECUTION_SPEC.md) — executable contract and lifecycle rules.
- [`V1_PROTOCOL_PARAMETERS.md`](./V1_PROTOCOL_PARAMETERS.md) — product parameters and economic behavior.
- [`V1_TYPED_IDENTIFIERS.md`](./V1_TYPED_IDENTIFIERS.md) — typed IDs, hashes, and CREATE2 domains.
- [`V1_PONS_BEHAVIOR_BASELINE.md`](./V1_PONS_BEHAVIOR_BASELINE.md) — adopted and rejected Pons behavior.
- [`V1_DEVELOPMENT_PLAN.md`](./V1_DEVELOPMENT_PLAN.md) — implementation scope and acceptance gates.
- [`../PLATFORM_REVENUE_USE.md`](../PLATFORM_REVENUE_USE.md) — user-facing project economics, future airdrop plans and uses of the Platform fee share.

## Contract architecture and accounting

- [`V1_TECHNICAL_ARCHITECTURE.md`](./V1_TECHNICAL_ARCHITECTURE.md)
- [`V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md`](./V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md) — 当前 Serverless 开发入口：TypeScript + Node.js 24 + Hono，VPS Alchemy WebSocket `eth_subscribe("logs")` relay + RPC；两个 Custom Webhook 已因逐块投递实测删除。仅覆盖正式前端所需 API、内容及必要数据流水线，含 TS-00～17 任务、Go 参考、依赖和验收；测试 relay 与 Pipeline Preview 已部署，真实匹配事件及恢复场景仍待验收。
- [`V1_CONTRACT_ARCHITECTURE_DECISION.md`](./V1_CONTRACT_ARCHITECTURE_DECISION.md)
- [`V1_MULTI_ASSET_STOCK_VAULT.md`](./V1_MULTI_ASSET_STOCK_VAULT.md)
- [`V1_MARKET_REGISTRY_STATE_MODEL.md`](./V1_MARKET_REGISTRY_STATE_MODEL.md)
- [`V1_CREATOR_REVENUE_EPOCH.md`](./V1_CREATOR_REVENUE_EPOCH.md)
- [`V1_TREASURY_ARCHITECTURE.md`](./V1_TREASURY_ARCHITECTURE.md)
- [`V1_CANONICAL_ABI_POLICY.md`](./V1_CANONICAL_ABI_POLICY.md)
- [`V1_COMPOSED_CALL_IDENTITY.md`](./V1_COMPOSED_CALL_IDENTITY.md)

## Stock, Quote, allocation, and exits

- [`V1_OFFICIAL_STOCK_ADMISSION.md`](./V1_OFFICIAL_STOCK_ADMISSION.md)
- [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)
- [`V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md`](./V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md)
- [`V1_USER_EMERGENCY_ESCAPE_FLOW.md`](./V1_USER_EMERGENCY_ESCAPE_FLOW.md)
- [`V1_MIGRATION_RESCUE_TIMING.md`](./V1_MIGRATION_RESCUE_TIMING.md)

## Audit, evidence, and readiness

- [`V1_BUSINESS_LOGIC_REMEDIATION.md`](./V1_BUSINESS_LOGIC_REMEDIATION.md)
- [`V1_M0_BLOCKER_AUDIT.md`](./V1_M0_BLOCKER_AUDIT.md)
- [`V1_G0_EXTERNAL_EVIDENCE.md`](./V1_G0_EXTERNAL_EVIDENCE.md)
- [`V1_G0_RECOMMENDATIONS.md`](./V1_G0_RECOMMENDATIONS.md)
- [`V1_READINESS_AND_DEPLOYMENT_GATES.md`](./V1_READINESS_AND_DEPLOYMENT_GATES.md)
- [`V1_ACCUMULATOR_NUMERIC_REPORT.md`](./V1_ACCUMULATOR_NUMERIC_REPORT.md)
- [`V1_ACTIVATION_WHEEL_GAS_REPORT.md`](./V1_ACTIVATION_WHEEL_GAS_REPORT.md)

## Testnet deployment operations

- [`V1_ADMIN_OPERATIONS_MANUAL.md`](./V1_ADMIN_OPERATIONS_MANUAL.md) — 中文人工管理教程：权限边界、角色移交、多签、延迟执行、各项参数、白名单、奖励兑换、Root 发布、排错与操作记录。
- [`V1_TESTNET_DEPLOYMENT_RUNBOOK.md`](./V1_TESTNET_DEPLOYMENT_RUNBOOK.md) — deterministic preview, rehearsal, broadcast boundary, role handoff, and deployed-manifest verification.
- [`V1_TESTNET_ROLLBACK_CHECKLIST.md`](./V1_TESTNET_ROLLBACK_CHECKLIST.md) — phase-specific retry, abandonment, pause/retire, user-exit, and incident handling.

品牌命名变更及兼容性说明：[V1_BRAND_RENAME.md](V1_BRAND_RENAME.md)。
