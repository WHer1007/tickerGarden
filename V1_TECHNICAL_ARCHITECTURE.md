# TickerGarden V1 技术架构

> 版本：`V1-EXEC-9`；状态：`LOCAL_IMPLEMENTATION_VERIFIED / NOT_DEPLOYABLE`。
> 旧 V1-EXEC-5 市场管理与 Recovery 方案已 superseded。

## 1. 组件边界

毕业后 Hook 对每笔 1% 协议手续费均将全额转入 FeeVault；LP 协议手续费为 0，canonical LP 仍永久锁定但不获得协议 LP 手续费。FeeVault 按 Active 状态记账为 Creator40/Staker30/Platform30 或 Creator70/Staker0/Platform30，向下取整余数归 Creator。Hook 不调用 `PoolManager.donate`，LaunchLocker 不执行 collect/compound，从而避免即时池价复投/JIT 路径并减少 gas 与 keeper 运维。

系统由 Factory、配置 Registries、Launch Router、Meme Token、Curve、Vault、Allocation、Gauge、FeeVault、Hook、GraduationExecutor 和 LaunchLocker 组成。已部署市场没有 MarketController、市场级状态管理或管理型 Recovery 组件。

## 1.1 正式用户 UI 与 Rewards 边界

`website-fruit-tree/` 是 V1 唯一正式用户前端。原辅助前端已迁入 `archive/legacy-website/`，只作历史追溯并从活动构建、测试、CI、部署及功能对接范围排除。正式前端的 `Rewards` 页面保持名称，并统一承载 Position、Staker、Creator、Treasury 四类用户面板。其运行时依赖 read API、Factory、LaunchRouter、AllocationManager、FeeVault、CreatorRegistry、TreasuryDistributor 和 Treasury Proof API，并在配置、健康检查及 Factory/Registry 地址绑定无法证明时 fail closed。

本金逃生是上述常规运行时的唯一例外边界：Rewards 的 direct Vault escape 仅需钱包、配置的 Factory 与 Robinhood Chain RPC，直接沿 Factory→MarketRegistry/OfficialStockRegistry→UserStockVault 核验不可变身份、schema 反向登记和用户 allocation。它不依赖 read API、Gauge/奖励读取、market phase、lock、`minimumAllocation` 或 Asset 的新增准入状态；交易仍必须 simulation-first，并以 canonical Vault 事件、receipt-block allocation 归零和用户 STOCK 精确到账共同确认。

Treasury 合约与 Rewards 内的 Treasury 前端都是 V1 范围内的能力，但当前状态为 `NOT_DEPLOYABLE`，尚未完成实链 E2E。正式前端因此对 Treasury 使用独立发布批准门：未取得 `V1-TREASURY-EXEC-1:DEPLOYED_E2E_APPROVED` 时仍可读取链上 Epoch、Root 和 proof，但不得模拟、签名或提交 holder 写操作；本节不构成部署或上线声明。

正式前端已接通 Curve quote/buy/sell；毕业后的 Pool swap 仍是显式 fail-closed 边界。Registry 的 canonical PoolKey/PoolId 只解决路由身份发现，并不等价于已经冻结目标 Robinhood Chain V4 peripheral 合约。只有 deployment evidence 固定 Router/Quoter 地址与 runtime codehash、精确 ABI、Permit2/native settlement、deadline 规则，并完成 Fork 与浏览器实链 E2E 后，才允许加入 Pool quote/submit builder。

## 2. 市场事实

Market Registry 是 marketId 的唯一事实来源，保存 immutable 创建快照和仅含 `poolId + sourceVersion + launchPhase` 的 runtime。`launchPhase` 只允许 `NotGraduated -> PoolCreated`；不存在持久毕业中间态或第二个市场状态维度。最终 Curve 买入与最后费用 sweep、资产移交、Pool/LP/Locker 建立、Hook 激活和 Registry 提交全原子，任一失败整体回滚。Factory、Curve、GraduationExecutor、Hook、Vault、Allocation、Gauge、FeeVault、Indexer、Backend 和 Web 必须读取 canonical Registry/Factory 事实，不得自行创建市场管理状态。

## 3. 配置状态

Official STOCK、Quote、Pons baseline、Launch template Registry 继续支持对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态用于准入和新增敞口控制，不隐式暂停或退休已部署市场。

## 4. Vault 与 RageQuit

Vault allocation 是本金权威。用户在任意 launchPhase、任意时间调用 `rageQuit`，按 Vault-first 顺序写入 tombstone、清除本人 allocation 并立即返还本金；不依赖 Gauge、管理权限、时间锁或 Recovery。未领取奖励异步放弃并进入 platform forfeiture reserve，且奖励失败不回滚本金。

## 5. 安全、管理与 Gas 边界

移除市场管理面可消除平台停止已部署市场、Emergency 原子编排和 Recovery root 治理的信任假设；代价是平台失去市场级紧急刹车，风险控制转移至不可变部署约束、配置准入、用户退出和监控审计。正常路径减少管理状态写入，但异步奖励处理需要独立维护交易；旧 V1-EXEC-5 Gas 与状态矩阵不得复用。

## 6. 验收边界

Solidity、ABI、权限、Indexer、Backend、Website、Deployments schema、机器规范和生成物已同步到 `V1-EXEC-9` 并通过本地门禁。目标链部署、production manifest、独立审计、实链 E2E 与上线批准不在该本地结论内。
