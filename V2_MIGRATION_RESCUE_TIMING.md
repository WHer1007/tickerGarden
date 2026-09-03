# TickerGarden V2 Allocation 退出、救援与计时语义

> 规格任务：`V2-P-009`
> 状态：`FROZEN / V2-EXEC-5`
> 更新时间：2026-09-04
> 历史说明：文件名沿用 V2-P-009 审计索引；V2-EXEC-5 已删除跨 Meme allocation 迁移。

## 1. Allocation 只增不减与整仓退出

正常 allocation 只有新建/增仓和整仓关闭两个方向。`closeAllocation(marketId)` 不接受数量、owner 或 recipient；`decreaseAllocation`、`migrateAllocation` 与 `Vault.moveAllocation` 不属于 V2-EXEC-5 ABI。固定顺序：

```text
require the caller's market position exists
require now >= position.unlockAt
checkpoint matured slots and settle both rewards at the old full weight
Gauge.removeAllocation(user) clears active + pending and returns full principal
require returned principal == Vault allocation(assetUid, user, marketId)
Vault.releaseAllocation(assetUid, user, marketId) clears and returns the same full principal
principal becomes the caller's Vault free balance
```

所有步骤 nonReentrant 且同一交易原子回滚。正常 close 保留已计提收益，本金先回 Vault free balance，用户随后自行 `withdrawFreeStock`。`rageQuit(marketId)` 则绕过24小时锁、整仓直接返还本金并放弃全部未领取收益。用户若更换 Meme，必须先完整关闭源市场，再以独立交易将 free balance 分配到目标市场；目标重新执行最低仓位、30秒激活和24小时锁定。

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

状态转换规则：

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

1. Manager、Gauge、Vault 均不存在按 amount 部分释放或跨市场搬移 selector。
2. close/rageQuit 清除的 Gauge 总仓位必须等于 Vault 对应市场总 allocation；不一致时整笔回滚。
3. 更换市场由两笔独立操作完成，同一 STOCK 不会在两个 Gauge 同时 active/pending；目标等待期不计奖。
4. `sweptAt` write-once；七日时钟不受 MarketStatus 变化影响。
5. `restrictedSince` 只在离开 ACTIVE 时开始，在恢复 ACTIVE 时清零，PAUSED→RETIRED 保持。
