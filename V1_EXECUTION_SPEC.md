# TickerGarden V1 可验证执行规范

> 版本：`V1-EXEC-6`  | 状态：`LOCAL_IMPLEMENTATION_VERIFIED / NOT_DEPLOYABLE`
> 2026-09-04：本版是破坏性架构改造；旧 V1-EXEC-5 已 superseded。

## 1. 市场永久自治

市场部署后没有平台市场级暂停、退休、紧急接管或 Recovery 管理状态。市场 Registry 只保存一次性 `launchPhase` 事实及其单向变更：`NotGraduated -> Swept -> PoolCreated`，或 `Swept -> Rescued`。不存在 `MarketStatus`、`statusSince`、`restrictedSince`、`recoveryEpoch` 或 Controller 写入入口。

资产、Quote、Pons baseline 和 launch template 仍由各自 Registry 执行对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态限制新增准入或新增敞口，不改变已部署市场的生命周期，也不阻止既有用户退出和领取已归属负债。

## 2. 用户即时 RageQuit

用户可在任意 `launchPhase`、任意时间调用 `rageQuit`，立即取回本人完整本金。该入口不依赖市场管理状态、时间锁、MarketController、Gauge 可用性或 Recovery root，不改变市场、Curve、Pool、Hook 或其他用户状态。

退出顺序固定为 Vault 读取权威 allocation、写入退出 tombstone、清除本人本金聚合、精确返还本人 STOCK；未领取 Quote/Meme 奖励异步放弃，由后续 permissionless 结算再分配给剩余 active staker，或进入 forfeiture reserve。异步奖励失败不得回滚已完成本金退出。

## 3. 交易与生命周期

`launchPhase` 是唯一市场生命周期维度。Curve 交易只允许 `NotGraduated`，毕业池交易只允许 `PoolCreated` 且绑定事实完整；`Swept`/`Rescued` 是不可逆事实。所有资金写入口必须读取链上 Registry、Factory 和组件绑定，不得从 API、Indexer 或本地缓存推断额外市场状态。

## 4. 迁移不兼容清单

本版删除旧版的 MarketStatus 枚举、市场 pause/unpause/retire 函数、MarketController、Emergency activation、Recovery cap/snapshot/stateHash、Merkle root/claim 管理及其权限、事件、ABI、Indexer 投影、API 字段和前端页面。旧名 `V1_EMERGENCY_RECOVERY_LIFECYCLE.md` 已改为 `V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md`；旧 V1-EXEC-5 设计仅作 superseded 迁移索引。

## 5. 验收边界

源码、机器 manifest、生成 ABI、权限、部署 schema 与链下消费者已按 `V1-EXEC-6` 在本地同步并通过门禁。该结论不包含目标链部署、独立审计、生产 manifest、浏览器实链 E2E 或上线批准。
