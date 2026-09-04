# TickerGarden V1 开发计划

> 当前规范：`V1-EXEC-9`；readiness：`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`。

## V1-ARCH-006：删除旧市场干预架构

状态：`DONE / LOCAL VERIFIED`（2026-09-04）。

本项作为独立、破坏性架构改造完成：

- 删除市场级暂停、恢复、退休、紧急接管和恢复分配状态；
- 删除 `MarketController` 及 FeeVault 的 recovery cap/root/claim 组件；
- `MarketRuntime` 收敛为 `poolId + sourceVersion + launchPhase`；
- `launchPhase` 只允许 `NotGraduated -> PoolCreated`；最终买入与毕业全原子，删除持久 `Swept`、重试、终态救援和市场资产接收人；
- Hook、Gauge、Curve、FeeVault、Vault 和 Allocation 不再读取或接受市场管理员状态；
- 用户 `rageQuit` 始终先返还完整 STOCK 本金，奖励清理由 permissionless 路径异步完成；
- Asset、Quote、Pons baseline、Launch template 的对象级 pause/unpause/retire 继续用于新增准入或新增敞口，不影响既有市场交易或本金退出；
- Solidity ABI、权限矩阵、部署 schema、Indexer、Backend、Website、Rewards/Treasury 前端、maintenance runner 和文档全部同步到 `V1-EXEC-9`。

当前 canonical 产品模块为 19 个（含共享 `TreasuryDistributorV1`）；接口和事件数量以 `spec/v1_execution_manifest.json` 为准。Gauge clone immutable identity 从 8 个 word 收敛为 7 个 word，runtime 为 269 bytes；共享 MultiAsset Vault schema 为 v6。部署权限面现为83个协议 mutation：22个由5类冻结角色门控，61个为 immutable direct/public/module caller，且所有业务状态延迟为0；Treasury Root publisher 与 independent reviewer 必须使用相互独立且不复用治理/Guardian/Unpause 成员的 Safe。

## 正式用户前端边界

`website-fruit-tree/` 是 V1 面向用户的唯一正式前端。页面与用户能力以该目录为准；`Rewards` 保持产品名称，并承载 Position、Staker、Creator、Treasury 四个面板。原辅助前端已迁入 `archive/legacy-website/`，只保留历史追溯用途，不参与构建、测试、CI、部署或功能对接，也不改变本计划的 readiness 结论。

前端的链上与链下接入必须 fail closed：read API、Factory、LaunchRouter、AllocationManager、FeeVault、CreatorRegistry、TreasuryDistributor 与 Treasury Proof API 的配置、健康状态和 Factory/Registry 绑定任一不满足时，不得报价、模拟、签名或提交资金敏感操作。Treasury 前端随 V1 发布，但 Treasury 整体当前仍标记为 `NOT_DEPLOYABLE`、尚未完成实链 E2E，因此其 holder 写操作还必须通过独立的 `V1-TREASURY-EXEC-1:DEPLOYED_E2E_APPROVED` 发布批准门；未批准时 Rewards 只读展示 Treasury，不影响其余 V1 用户操作。

曲线阶段的买卖、创建与首买已经使用 canonical V1 ABI 接入。毕业后的 Pool 页面只能在 Registry 返回 `PoolCreated` canonical route、且目标 Robinhood Chain 的 V4 Router/Quoter 地址、runtime codehash、精确 ABI、Permit2/native settlement 语义和 deadline 规则全部写入 deployment evidence 并通过 Fork/浏览器 E2E 后开放。当前这些外部身份尚未冻结，所以正式前端明确锁定 Pool swap；禁止用推测 calldata 或非 canonical 第三方 Router 补齐。

## 本地验收

- 根门禁：以仓库根目录 `npm test` 为唯一聚合验收入口；它必须同时通过执行规范、全部 Foundry 测试、fixture/interface/product artifact 漂移检查、CI 三轨、Backend、Indexer、Deployments、Maintenance runner 与正式 `website-fruit-tree`。具体 suite/case 数量以当次 CI 输出为准，避免文档硬编码计数漂移。
- 状态化验证：Vault/Gauge、Treasury 与多资产恶意 Token 不变量均固定执行 256 runs、128,000 calls，并要求 0 handler revert。
- 旧管理 selector 只允许出现在“不可调用”的负向测试和明确的已删除迁移记录中；源码、生成 ABI、事件、客户端、部署 `dist` 与编译 artifact 均不得包含它们。

## 后续工作与外部支持

本地实现完成不等于可部署。以下门禁仍开放：

1. 提供并确认 Robinhood Chain 测试/归档 RPC、目标 finalized block 与官方合约身份；
2. 提供 Governance、Guardian、Security/Unpause、Treasury Root Publisher、Independent Root Reviewer 五类角色成员及 Platform Treasury 的最终地址，生成真实 production deployment manifest，完成 CREATE2、Hook permission bits、AccessManager 角色/延迟和 codehash 取证；
3. 冻结目标链 V4 Router/Quoter 的地址、runtime codehash、精确 swap/quote ABI、Permit2/native settlement 与 deadline 语义，随后接通正式前端的 Pool quote/submit；
4. 在目标链完成 live Fork、部署、验证、全链路 E2E 与 canary；
5. 独立安全审计关闭 Critical/High，并完成 Pons 来源/许可及 Stock 收益产品的法律签字；
6. 完成监控、告警、事故 runbook 和至少 72 小时 canary soak 后，才可推进 `DEPLOYMENT_ELIGIBLE`/`PRODUCTION_READY`。

## 历史归档

旧 V1-EXEC-5 的市场状态、Controller、管理型 Recovery、force-release 和状态乘积任务均为 `SUPERSEDED / ARCHIVED`。它们不属于当前能力、模块数或测试结论；移除边界见 [V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md](./V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md)。
