# TickerGarden V1 MultiAsset Stock Vault

> 版本：`V1-EXEC-6`；本地实现边界，未声称目标链部署、审计或 E2E 完成。

## 决策

每个 schema 使用一个共享 MultiAsset Vault；权威账本按 `assetUid + user + marketId` 隔离。市场部署后永久自治，仅 `launchPhase` 是一次性生命周期事实。资产级 pause/retire 仍限制新增敞口，不隐藏已有退出。

## RageQuit

用户可在任意 launchPhase、任意时间调用 `UserStockVault.rageQuit(assetUid, marketId)`，或使用 `AllocationManager.rageQuit(marketId)` 便利入口，立即取回本人完整本金。流程先写 settlement tombstone、清除完整 allocation 聚合，再精确转回 STOCK；不依赖市场状态、时间锁、Gauge 或管理权限。

未领取 Quote/Meme 奖励异步放弃：有其他 active staker 时按剩余权重再分配，否则进入 forfeiture reserve。Gauge/FeeVault 失败只保留可重试 settlement，不回滚本金，也不改变市场、Curve、Pool、Hook 或其他用户。

## 正常操作与配置状态

正常 close 仍遵守 24 小时 unlock 和完整仓位规则；`allocate`/`increase` 只允许 canonical launchPhase 和 ACTIVE 资产准入。Asset、Quote、Pons baseline、Launch template 的 `ACTIVE <-> PAUSED -> RETIRED` 是对象级配置状态，不是市场级控制。

## 安全边界

不得恢复已删除的市场管理或 force-release API。RageQuit 的本金优先顺序、精确余额 delta、tombstone 防重入仓和异步奖励重试已纳入当前本地测试；生产 Gas 与目标链行为仍须在部署前重新测量。
