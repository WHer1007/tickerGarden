# TickerGarden V1 开发计划

> 当前规范：`V1-EXEC-6`；readiness：`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`。

## V1-ARCH-006：删除旧市场干预架构

状态：`DONE / LOCAL VERIFIED`（2026-09-04）。

本项作为独立、破坏性架构改造完成：

- 删除市场级暂停、恢复、退休、紧急接管和恢复分配状态；
- 删除 `MarketController` 及 FeeVault 的 recovery cap/root/claim 组件；
- `MarketRuntime` 收敛为 `poolId + sourceVersion + sweptAt + launchPhase`；
- `launchPhase` 只允许 `NotGraduated -> Swept -> PoolCreated|Rescued`；
- Hook、Gauge、Curve、FeeVault、Vault 和 Allocation 不再读取或接受市场管理员状态；
- 用户 `rageQuit` 始终先返还完整 STOCK 本金，奖励清理由 permissionless 路径异步完成；
- Asset、Quote、Pons baseline、Launch template 的对象级 pause/unpause/retire 继续用于新增准入或新增敞口，不影响既有市场交易或本金退出；
- Solidity ABI、权限矩阵、部署 schema、Indexer、Backend、Website、maintenance runner 和文档全部同步到 `V1-EXEC-6`。

当前 canonical 产品模块为 18 个；接口 manifest 为 70 个 mutation、54 个协议事件，Indexer 另加入 canonical PoolManager 事件后生成 56 个事件签名。Gauge clone immutable identity 从 8 个 word 收敛为 7 个 word，runtime 为 269 bytes；共享 MultiAsset Vault schema 为 v5。

## 本地验收

- Foundry：55 suites、612 tests 全部通过；Vault/Gauge 状态化不变量为 256 runs、128,000 calls、0 revert。
- 机器规范：59 tests 通过；canonical ABI、compiled interface、product artifact、fixture 与权限/CI track stale checks 通过。
- 链下：Backend 13、Indexer 19、Deployments 23、Maintenance runner 12、Website 30 unit + 4 Sites tests 通过。
- 旧管理 selector 只允许出现在“不可调用”的负向测试和明确的已删除迁移记录中；源码、生成 ABI、事件、客户端、部署 `dist` 与编译 artifact 均不得包含它们。

## 后续工作与外部支持

本地实现完成不等于可部署。以下门禁仍开放：

1. 提供并确认 Robinhood Chain 测试/归档 RPC、目标 finalized block 与官方合约身份；
2. 生成真实 production deployment manifest，完成 CREATE2、Hook permission bits、AccessManager 角色/延迟和 codehash 取证；
3. 在目标链完成 live Fork、部署、验证、全链路 E2E 与 canary；
4. 独立安全审计关闭 Critical/High，并完成 Pons 来源/许可及 Stock 收益产品的法律签字；
5. 完成监控、告警、事故 runbook 和至少 72 小时 canary soak 后，才可推进 `DEPLOYMENT_ELIGIBLE`/`PRODUCTION_READY`。

## 历史归档

旧 V1-EXEC-5 的市场状态、Controller、管理型 Recovery、force-release 和状态乘积任务均为 `SUPERSEDED / ARCHIVED`。它们不属于当前能力、模块数或测试结论；移除边界见 [V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md](./V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md)。
