# TickerGarden V2 市场状态权威模型

> 规格任务：`V2-P-001`  
> 状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> State model revision：`V2-STATE-5-FROZEN`  
> 适用执行基线：`V2-EXEC-5`
> 更新时间：2026-09-04

本文只冻结市场状态的唯一权威、字段归属、写权限和迁移图，不改变已确认的 V2 经济规则。后续 ABI、权限矩阵和合约实现必须以本文及 `spec/v2_execution_manifest.json.stateAuthority` 为准。

## 1. 唯一权威

`MarketRegistryV2` 是每个 `marketId` 的唯一规范性市场状态存储。Factory、Curve、GraduationExecutor、MarketController、Hook、Vault、AllocationManager、Gauge、FeeVault 与 Indexer 均不得保存可独立决定以下字段的第二份权威：

- 市场不可变快照；
- `launchPhase`；
- `marketStatus`；
- `poolId`；
- `sourceVersion`；
- 当前 ACTIVE fee source；
- `sweptAt`、`statusSince` 与 `recoveryEpoch`。

其他模块可保存完成本模块职责所需的执行状态。例如 Hook 的 `PoolBindingStatus` 用于 EXPECTED/initialize/ACTIVE/DISABLED 握手，Gauge 保存仓位，Vault 保存本金分配。这些状态不能覆盖 Registry 的判断：任何交易、收费、分配或恢复入口都必须同时通过 Registry 的当前状态与版本校验。

Registry 不提供通用 setter、任意 source setter、任意状态枚举 setter、delegatecall 或可升级共享存储。所有写操作都是带前置条件的语义化迁移。

## 2. Canonical schema

```solidity
struct MarketConfig {
    bytes32 assetUid;
    bytes32 ponsBaselineId;
    bytes32 quoteAssetConfigId;
    bytes32 launchTemplateId;
    bytes32 feePolicyId;
    bytes32 executionSpecId;
    bytes32 expectedEconomics;
    uint256 launchConfigId;
    address creatorRevenueBeneficiaryAtCreation;
    address memeToken;
    address curve;
    address gauge;
    address quoteAsset;
    address graduatedHook;
    address marketController;
}

struct MarketRuntime {
    bytes32 poolId;             // Swept 前为 0；PoolCreated 后固定
    uint32 sourceVersion;       // 创建时为 1；每次 ACTIVE source 代际切换/永久禁用时 checked +1
    uint32 recoveryEpoch;       // 创建时为 0；Emergency 时 checked +1
    uint64 sweptAt;             // NotGraduated -> Swept 时写一次
    uint64 statusSince;         // 每次 MarketStatus 变化时更新
    uint64 restrictedSince;     // 连续 PAUSED/RETIRED 起点；ACTIVE 时为0
    LaunchPhase launchPhase;
    MarketStatus marketStatus;
}
```

字段规则：

- `MarketConfig` 在 `registerMarket` 成功后永久不可修改；历史 Creator beneficiary 负债由独立的 Creator epoch 模型处理，不回写创建快照。
- `assetUid` 就是该市场唯一的 staking base 身份；登记时必须解析为 ACTIVE 官方 STOCK，不能为空或多选，创建后不可改绑。同一 `assetUid` 可被任意多个不同 `marketId` 使用，Registry 不保存需遍历的一对多数组。
- `minimumAllocation` 按 Asset UID 从 OfficialStockRegistry 动态读取，协议安全下限为414 raw units；它不进入市场不可变快照或 `expectedEconomics`，管理员延迟更新不得低于该下限。
- `MarketRuntime` 只能由下文列出的 Registry 入口修改。
- `marketIdByToken[memeToken]` 与 `marketId` 同次登记，之后不可重绑。
- 初始状态固定为 `NotGraduated + ACTIVE`、`poolId = 0`、`sourceVersion = 1`、`recoveryEpoch = 0`、`sweptAt = 0`、`statusSince = block.timestamp`、`restrictedSince = 0`。
- ACTIVE fee source 由状态派生，不单独接受地址写入：`NotGraduated -> curve@sourceVersion`；`Swept/Rescued -> none`；`PoolCreated -> graduatedHook@sourceVersion`；`EMERGENCY_EXIT -> none`。
- PAUSED/RETIRED 只改变业务门禁，不更换 source 身份或版本；所有交易源还必须检查 `marketStatus == ACTIVE`。
- `NotGraduated` 只允许 `ACTIVE` 或可逆的 `PAUSED`；在 Curve 完成最终结算并进入 `Swept` 前，`RETIRED` 与 `EMERGENCY_EXIT` 均不可达，以免永久关闭仍持有 Quote/Meme 的 Curve。

## 3. 唯一写路径

| Registry 入口 | 唯一 caller | 允许的写入 | 关键前置条件 |
|---|---|---|---|
| `registerMarket(marketId, config)` | immutable `TickerGardenFactoryV2` | 创建 config/runtime、token 反查 | market/token 未登记；全部 config ACTIVE 且 economics 匹配 |
| `markSwept(marketId)` | 该市场登记的 `curve` | `NotGraduated -> Swept`、写 `sweptAt` | 市场 ACTIVE；Curve 已停止交易、完成最终结算和最终 sweep |
| `commitPoolCreated(marketId, poolId)` | immutable `GraduationExecutor` | `Swept -> PoolCreated`、写 `poolId`、`sourceVersion + 1` | 市场 ACTIVE；pool 非零且 canonical；Hook binding 已 ACTIVE；LP 已永久锁定；同一子调用原子完成 |
| `markRescued(marketId)` | immutable `GraduationExecutor` | `Swept -> Rescued` | `block.timestamp >= sweptAt + baselineRescueDelay`；无 ACTIVE/残留 EXPECTED pool binding |
| `setMarketPaused(marketId, reasonHash)` | immutable `MarketController` | `ACTIVE -> PAUSED`、更新 `statusSince/restrictedSince` | Controller 已校验 Guardian 权限 |
| `setMarketActive(marketId)` | immutable `MarketController` | `PAUSED -> ACTIVE`、更新 `statusSince`、清零 `restrictedSince` | Controller 已执行 24h delayed unpause |
| `setMarketRetired(marketId, reasonHash)` | immutable `MarketController` | `ACTIVE/PAUSED -> RETIRED`、更新 `statusSince`；已有 `restrictedSince` 保持 | `launchPhase != NotGraduated`；Controller 已执行 48h delayed admin 操作 |
| `commitEmergencyExit(marketId, snapshotBlock, stateHash)` | immutable `MarketController` | `PAUSED/RETIRED -> EMERGENCY_EXIT`、`sourceVersion + 1`、`recoveryEpoch + 1`、更新 `statusSince` | `launchPhase != NotGraduated`；前态连续至少24h；snapshotBlock 固定为激活块减1；Hook/Gauge 已在同一调用中永久禁用；recovery cap 已冻结 |

Registry 对模块地址使用 immutable/direct caller check；治理角色不能直接调用上述模块入口。AccessManager 权限位于 Factory/Controller 等业务入口，不能绕过其状态校验直接改 Registry。

## 4. 完整迁移图

```text
LaunchPhase
NotGraduated --curve/final-sweep--> Swept
Swept --GraduationExecutor/atomic-child--> PoolCreated [terminal]
Swept --GraduationExecutor/after-7d--> Rescued [terminal]

MarketStatus
ACTIVE --Controller/pause--> PAUSED
PAUSED --Controller/delayed-unpause--> ACTIVE
ACTIVE --Controller/delayed-retire; phase != NotGraduated--> RETIRED
PAUSED --Controller/delayed-retire; phase != NotGraduated--> RETIRED
PAUSED --Controller/recovery-after-24h; phase != NotGraduated--> EMERGENCY_EXIT [terminal]
RETIRED --Controller/recovery-after-24h; phase != NotGraduated--> EMERGENCY_EXIT [terminal]
```

没有清单外返回边。`LaunchPhase` 与 `MarketStatus` 是独立维度，但其笛卡尔积受安全约束：`NotGraduated + RETIRED/EMERGENCY_EXIT` 非法；暂停不会回滚毕业阶段，毕业也不会自动恢复市场状态。

## 5. 原子性与读路径

- 最终 Curve 交易按“最终成交/退款 -> 最终 sweep -> 停止新交易 -> `markSwept` -> 调用 `GraduationExecutor.graduateFromCurve`”执行；前四步任一步失败则整笔回滚，毕业子调用失败由 Curve 捕获并只保留 `Swept`。
- 毕业子调用按“部署 per-market Locker -> 登记 EXPECTED pool -> initialize -> 建仓 -> 永久锁 LP -> 激活 Hook binding -> `commitPoolCreated`”执行；Registry commit 必须最后发生，任一步失败则整个子调用回滚并保留外层已提交的 `Swept`。
- Emergency 外部 ABI 只有 `activateEmergencyExit(marketId)`；Controller 读取 Registry 后先拒绝 `NotGraduated`，再按“计算 epoch/snapshot/hash -> FeeVault 冻结 exact caps/snapshot -> 禁用 Gauge -> 禁用 Hook -> `commitEmergencyExit`”执行；Registry 再次校验 phase 且 commit 最后发生，并与前述动作原子。
- Curve、Hook、FeeVault、AllocationManager、Vault 和 Gauge 只通过 Registry view 读取 canonical 状态。Indexer/Backend 只做缓存与展示，不参与安全判断。
- Hook 的 `PoolBindingStatus` 与 Registry 必须满足：`PoolCreated` 时 exact pool binding 为 ACTIVE；`EMERGENCY_EXIT` 时其为 DISABLED。发现不一致时所有资金写入口 fail closed。

## 6. 必须持续成立的不变量

1. 每个 `marketId` 恰有一个 Registry config/runtime；每个 Meme Token 最多映射一个 marketId。
2. 任一市场最多一个 ACTIVE fee source，且由 phase、status、sourceVersion 唯一确定。
3. `sourceVersion` 永不回退、回绕或复用；`sourceVersion == 0` 无效。
4. `poolId != 0` 当且仅当 `launchPhase == PoolCreated`。
5. `sweptAt != 0` 当且仅当市场已经离开 `NotGraduated`。
6. `Rescued` 永远不能进入 PoolCreated；PoolCreated 永远不能救援或回到曲线。
7. Factory 只能登记，Curve 只能关闭自己的曲线阶段，Graduation 只能推进 Swept，Controller 只能改变 MarketStatus。
8. Vault/Gauge/Hook 的本地执行状态不能单独开放交易、收费、分配或本金恢复。
9. Emergency 连续24小时门槛使用 `restrictedSince`；`PAUSED -> RETIRED` 保持该时间，恢复 ACTIVE 才清零。
10. 任何 `NotGraduated` 市场均不能进入 `RETIRED` 或 `EMERGENCY_EXIT`；暂停后始终保留延迟 unpause 回到 Curve 交易/最终结算的路径。
