# TickerGarden V1 可验证执行规范

> 版本：`V1-EXEC-8`  | 状态：`LOCAL_SECURITY_REMEDIATIONS_VERIFIED / GLOBAL_INTEGRATION_BLOCKED / NOT_DEPLOYABLE`
> 2026-09-04：本版在 V1-EXEC-7 手续费规则上加入 BL-01、BL-03 修复，并升级 Vault schema 与跨模块 ABI；旧 V1-EXEC-7 已 superseded。

本版手续费规则：毕业后总协议手续费维持 1%，LP 协议手续费为 0%。存在 Active staker 时按 Creator 40% / Staker 30% / Platform 30% 分配；不存在 Active staker 时按 Creator 70% / Staker 0% / Platform 30% 分配。Staker 与 Platform 份额向下取整，整数余数归 Creator。Hook 不再调用 `PoolManager.donate`，LaunchLocker 不再 collect/compound；canonical LP 仍永久锁定但不获得协议 LP 手续费。该调整消除了基于即时池价的复投/捐赠路径及其 JIT 经济风险，并减少链上 gas 与 keeper 运维面；全部手续费统一进入 FeeVault 记账。

## 1. 市场永久自治

市场部署后没有平台市场级暂停、退休、紧急接管或 Recovery 管理状态。市场 Registry 只保存一次性 `launchPhase` 事实及其单向变更：`NotGraduated -> Swept -> PoolCreated`，或 `Swept -> Rescued`。不存在 `MarketStatus`、`statusSince`、`restrictedSince`、`recoveryEpoch` 或 Controller 写入入口。

资产、Quote、Pons baseline 和 launch template 仍由各自 Registry 执行对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态限制新增准入或新增敞口，不改变已部署市场的生命周期，也不阻止既有用户退出和领取已归属负债。

## 2. 用户即时 RageQuit

用户可在任意 `launchPhase`、任意时间调用 `rageQuit`，立即取回本人完整本金。该入口不依赖市场管理状态、时间锁、MarketController、Gauge 可用性或 Recovery root，不改变市场、Curve、Pool、Hook 或其他用户状态。

退出顺序固定为 Vault 读取权威 allocation、从 Vault 权威 reward-eligibility 总量中移除本人权重、快照 Gauge 最新 Quote/Meme accumulator 以及退出后的有效权重/cohort nonce、写入退出 tombstone、清除本人本金聚合、精确返还本人 STOCK；未领取 Quote/Meme 奖励异步放弃。后续 permissionless 结算仅在 cohort 与权重未变化时向退出时剩余 active staker 重分配，否则 fail closed 到 forfeiture reserve，后加入者不能分享。异步奖励失败不得回滚已完成本金退出。

Gauge 清理延迟期间，FeeVault 只读取 Vault 的有效 Active 总量；退出用户的预览与最终 forfeiture 均固定在本金退出交易记录的 accumulator cutoff。因此退出后的新手续费不会再分给该用户，也不会稀释仍 Active 用户，且 RageQuit 不能绕过24小时锁领取收益。

## 3. 交易与生命周期

`launchPhase` 是唯一市场生命周期维度。Curve 交易只允许 `NotGraduated`，毕业池交易只允许 `PoolCreated` 且绑定事实完整；`Swept`/`Rescued` 是不可逆事实。所有资金写入口必须读取链上 Registry、Factory 和组件绑定，不得从 API、Indexer 或本地缓存推断额外市场状态。

## 4. 毕业经济域准入

`PonsBaselineRegistry` 与 `ApprovedQuoteRegistry` 分别拒绝超过 `int128.max` 的 supply、phantomQuote 和 graduationThreshold。Factory 的 preview/create 在预留 marketId 或部署任何组件之前，再对实际 baseline + quote 组合执行联合校验：计算 Pons supply/终点 Quote 分区，并对 Meme/Quote 两种地址排序运行与毕业执行相同的 `GraduationPoolMath`，覆盖 v4 signed amount、sqrt price、tick 与 max-liquidity 域。由于任意多笔买卖的整数舍入会使真实终点 Quote 与初始理论终点产生偏差，Curve 在最终 fee sweep 后、写入 escrow 或 `markSwept` 前，还必须用真实 swept Quote/Meme 与 Registry canonical PoolKey 再执行一次相同数学；不可表示时整笔最终买入回滚，市场保持 `NotGraduated`，不得形成不可毕业的 `Swept` 托管。Factory 还要求 Stock Vault 是 Registry 中 canonical `MultiAsset.v6` reverse binding，且 Vault 自报的 Registry、MarketRegistry、AllocationManager 与 schema 全部匹配。无法形成可表示 canonical pool 或仍绑定旧 Vault schema 的组合不得创建市场。

## 5. 迁移不兼容清单

本版删除旧版的 MarketStatus 枚举、市场 pause/unpause/retire 函数、MarketController、Emergency activation、Recovery cap/snapshot/stateHash、Merkle root/claim 管理及其权限、事件、ABI、Indexer 投影、API 字段和前端页面。旧名 `V1_EMERGENCY_RECOVERY_LIFECYCLE.md` 已改为 `V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md`；旧 V1-EXEC-5 设计仅作 superseded 迁移索引。

## 6. 验收边界

手续费域、BL-01 reward cutoff、BL-03 联合经济域准入、机器 manifest、生成 ABI 与直接消费者按 `V1-EXEC-8` 同步后，必须共同通过规范、合约、构建和专项门禁。Treasury V1 的 `ROOT_PUBLISHER_ROLE` 与 `ROOT_REVIEW_ROLE` 已进入本地 AccessManager 计划、deployment schema、manifest 语义校验和固定数量门禁：当前 19 个模块共有 86 个协议 mutation，其中 22 个由 5 类角色门控、64 个为 immutable direct/public/module caller；Root publisher 与 independent reviewer 使用两个独立 Safe 成员。Treasury 的生产式集成测试还必须证明 Protocol Admin 的 48 小时 schedule/execute、Guardian 取消、四个特权 selector 的精确隔离、bootstrap `ADMIN_ROLE` 最终撤销；只读 preflight 必须证明 `authority()` 指向该 AccessManager 且 `marketRegistry()` 指向 canonical `MarketRegistryV1`。该本地闭环不等于可部署：目标 Safe 身份、生产 manifest、目标链部署、独立审计、实链 Fork/浏览器 E2E 与上线批准仍未完成。
