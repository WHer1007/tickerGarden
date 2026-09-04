# TickerGarden V1 MultiAsset Stock Vault

> 版本：`V1-EXEC-10`；本地实现边界，未声称目标链部署、审计或 E2E 完成。

## 决策

每个 schema 使用一个共享 MultiAsset Vault；权威账本按 `assetUid + user + marketId` 隔离。市场部署后永久自治，仅 `launchPhase` 是一次性生命周期事实。资产级 pause/retire 仍限制新增敞口，不隐藏已有退出。

## RageQuit

用户可在任意 launchPhase、任意时间调用 `UserStockVault.rageQuit(assetUid, marketId)`，或使用 `AllocationManager.rageQuit(marketId)` 便利入口，立即取回本人完整本金。流程先写 settlement tombstone、清除完整 allocation 聚合，再精确转回 STOCK；不依赖市场状态、时间锁、Gauge 或管理权限。

未领取 Quote/Meme 奖励异步放弃：无论是否存在其他 Active staker、cohort 是否变化，均统一进入 ProtocolFeeVault 的 platform forfeiture reserve，不重新分配给任何 staker，也不允许后加入者捕获旧收益。Gauge/FeeVault 失败只保留可重试 settlement/deferred forfeiture，不回滚本金，也不改变市场、Curve、Pool、Hook 或其他用户。

### BL-01：延迟清理不再污染手续费权重

`MultiAsset.v6` 在 Vault 内为每个 `assetUid + marketId` 维护独立、固定32槽的30秒激活镜像以及按用户的 pending 位置。该账本是手续费分母的权威来源；读取成本固定受32槽上限约束，不随 Stock 品种数或 staker 人数增长。Gauge 仍保存逐用户收益明细，但不再用尚未完成异步清理的本地总量决定 FeeVault 的 Active 分支。

每次 Gauge accumulator 非零更新都会经 canonical AllocationManager 写入 Vault；数值只能单调增加。RageQuit 在返还本金的同一交易中先移除有效权重，并冻结 accumulator cutoff。此后产生的手续费只属于剩余 Active staker；异步清理最终只处理并放弃 cutoff 以前的收益，将其一次性记入平台 forfeiture reserve。不存在按 nonce、cohort 或权重是否变化而重分配的分支；若退出仓位当时仍为 pending、对应 Gauge bucket 到 cutoff 后才处理，则直接撤销该 stale pending，不能按较新的 accumulator 反向补发退出后收益。单个用户逃生不会暂停或终止市场。

## 正常操作与配置状态

正常 close 仍遵守 24 小时 unlock 和完整仓位规则；`allocate`/`increase` 只允许 canonical launchPhase 和 ACTIVE 资产准入。Asset、Quote、Pons baseline、Launch template 的 `ACTIVE <-> PAUSED -> RETIRED` 是对象级配置状态，不是市场级控制。

## 安全边界

不得恢复已删除的市场管理或 force-release API。RageQuit 的本金优先顺序、精确余额 delta、权威有效权重、accumulator cutoff、platform forfeiture reserve、tombstone 防重入仓和异步奖励重试已纳入当前本地测试。Factory 对 v6 schema、Registry reverse binding 和 Vault 三项依赖做创建前校验。`MultiAsset.v6` 是新增存储布局，必须部署 successor Vault 并由 Registry 显式绑定，不得把旧 Vault 当作可原地升级对象；生产 Gas 与目标链行为仍须在部署前重新测量。
