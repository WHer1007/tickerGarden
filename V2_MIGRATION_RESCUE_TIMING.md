# TickerGarden V2 迁移、救援与计时语义

> 规格任务：`V2-P-009`  
> 状态：`REVIEW`  
> 更新时间：2026-09-03

## 1. 跨 Meme 原子迁移

`migrateAllocation(fromMarketId, toMarketId, amount)` 只迁移同一 Asset UID、同一 UserStockVault 中调用者自己的精确 `amount`。固定顺序：

```text
require from != to and amount > 0
require both markets use same assetUid and exact same Vault
require target is PoolCreated + ACTIVE and Asset ACTIVE
preflight target Gauge/Vault position consistency and target resulting minimum
checkpoint source matured slots and settle source rewards at its pre-migration weight
materialize source pending; because unlock is 24h and pending is 30s, it must now be mature
require source position exists and now >= source.unlockAt
require source activeAmount >= amount
require source remainder after removal is 0 or strictly > 0.5 STOCK
remove exactly amount active STOCK from source Gauge
Vault.moveAllocation(assetUid, user, from, to, amount)
checkpoint target matured slots and settle target rewards at its pre-migration Gauge weight
add exactly amount as target pending; merge/reset its 30s generation if needed
reset target whole-position unlockAt = now + 24h
emit AllocationMigrated
```

所有步骤 nonReentrant 且同一交易原子回滚。被迁移 amount 在源结算后立即失去权重，在目标30秒成熟前没有权重；任何时刻都不能同时计奖。源剩余仓位的 unlockAt 不改变；目标整个合并仓位重置。迁出允许源市场 PAUSED/RETIRED，但目标必须开放新增；EMERGENCY 源必须走 force release，不能 migrate。

## 2. Swept 七日救援

- `sweptAt` 只在 `NotGraduated -> Swept` 成功时写一次，使用该交易 `block.timestamp`。
- 首个允许 rescue 的时间点是 `block.timestamp >= sweptAt + 604800`；少一秒失败。
- pause/retire 不暂停或重置七日时钟。只要 LaunchPhase 仍为 Swept，PAUSED/RETIRED 下允许 permissionless rescue；Emergency 下也允许把剩余发行资产送入 baseline 固定救援路径。
- baseline 固定救援路径在 GraduationExecutor 部署时冻结为单一 rescue distributor；公开入口没有 recipient 参数，caller、creator 和管理员均不能临时重定向。Curve 最终 sweep 冻结的 exact `sweptQuote/sweptTokens` 是唯一金额来源，Executor 的同资产聚合余额与强制转入余额不得计入。
- 原生与 ERC-20 两条路径都要求 Executor 减量及固定 distributor 增量精确等于该市场记录；任一转账或 Registry 提交失败时资产、事件和状态整体回滚。
- retry graduation 只允许 `Swept + ACTIVE`；rescue 成功进入终态 Rescued，之后 retry 永久失败。
- PoolCreated 与 Rescued 竞争时以交易排序为准；任一先成功，另一条边因前态不再是 Swept 而回滚。

## 3. 状态计时

MarketRuntime 同时保存：

```text
statusSince      = 当前 MarketStatus 开始时间
restrictedSince = 本轮连续非 ACTIVE（PAUSED/RETIRED）开始时间；ACTIVE 时为0
```

迁移规则：

```text
ACTIVE -> PAUSED:  statusSince=now, restrictedSince=now
ACTIVE -> RETIRED: statusSince=now, restrictedSince=now
PAUSED -> ACTIVE:  require now >= statusSince+24h; statusSince=now, restrictedSince=0
PAUSED -> RETIRED: 仅 launchPhase != NotGraduated；statusSince=now, restrictedSince 保持不变
PAUSED/RETIRED -> EMERGENCY_EXIT: 仅 launchPhase != NotGraduated；
  require restrictedSince != 0 and now >= restrictedSince+24h
  statusSince=now, restrictedSince 保持历史起点
```

因此 `PAUSED -> RETIRED` 不会错误重置 Emergency 连续24小时资格；unpause 会清零资格并要求未来重新累计。所有加法先防 uint64 溢出并 fail closed，时间边界统一使用 `>=`。

`NotGraduated + PAUSED` 是唯一允许的未毕业受限组合：它保留 delayed unpause 后继续 Curve 交易/最终结算的路径；retire 与 Emergency 在 Controller 外部副作用前以及 Registry 最终写入处均 fail closed。

## 4. 不变量

1. 迁移前后 Vault 总 allocated 不变，源减量等于目标增量。
2. 同一 amount 不在两个 Gauge 同时 active/pending；目标等待期不计奖。
3. 迁移失败时 Vault 与两个 Gauge 均无变化。
4. `sweptAt` write-once；七日时钟不受 MarketStatus 变化影响。
5. `restrictedSince` 只在离开 ACTIVE 时开始，在恢复 ACTIVE 时清零，PAUSED→RETIRED 保持。
