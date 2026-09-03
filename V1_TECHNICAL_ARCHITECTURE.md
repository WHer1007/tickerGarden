# TickerGarden V1 技术架构

> 版本：`V1-EXEC-6`；状态：`LOCAL_IMPLEMENTATION_VERIFIED / NOT_DEPLOYABLE`。
> 旧 V1-EXEC-5 市场管理与 Recovery 方案已 superseded。

## 1. 组件边界

系统由 Factory、配置 Registries、Launch Router、Meme Token、Curve、Vault、Allocation、Gauge、FeeVault、Hook、GraduationExecutor 和 LaunchLocker 组成。已部署市场没有 MarketController、市场级状态管理或管理型 Recovery 组件。

## 2. 市场事实

Market Registry 是 marketId 的唯一事实来源，保存 immutable 创建快照和仅含 `poolId + sourceVersion + sweptAt + launchPhase` 的 runtime。`launchPhase` 只单向记录 `NotGraduated`、`Swept`、`PoolCreated` 或 `Rescued`；不存在第二个市场状态维度。Factory、Curve、GraduationExecutor、Hook、Vault、Allocation、Gauge、FeeVault、Indexer、Backend 和 Web 必须读取 canonical Registry/Factory 事实，不得自行创建市场管理状态。

## 3. 配置状态

Official STOCK、Quote、Pons baseline、Launch template Registry 继续支持对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态用于准入和新增敞口控制，不隐式暂停或退休已部署市场。

## 4. Vault 与 RageQuit

Vault allocation 是本金权威。用户在任意 launchPhase、任意时间调用 `rageQuit`，按 Vault-first 顺序写入 tombstone、清除本人 allocation 并立即返还本金；不依赖 Gauge、管理权限、时间锁或 Recovery。未领取奖励异步放弃，由 permissionless 结算再分配或进入 reserve，且奖励失败不回滚本金。

## 5. 安全、管理与 Gas 边界

移除市场管理面可消除平台停止已部署市场、Emergency 原子编排和 Recovery root 治理的信任假设；代价是平台失去市场级紧急刹车，风险控制转移至不可变部署约束、配置准入、用户退出和监控审计。正常路径减少管理状态写入，但异步奖励处理需要独立维护交易；旧 V1-EXEC-5 Gas 与状态矩阵不得复用。

## 6. 验收边界

Solidity、ABI、权限、Indexer、Backend、Website、Deployments schema、机器规范和生成物已同步到 `V1-EXEC-6` 并通过本地门禁。目标链部署、production manifest、独立审计、实链 E2E 与上线批准不在该本地结论内。
