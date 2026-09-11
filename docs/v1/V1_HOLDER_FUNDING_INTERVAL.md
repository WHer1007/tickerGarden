# Holder 奖励批次间隔配置

当前源码版本：`TICKERGARDEN_HOLDER_CONFIGURABLE_24H_V3`。此说明不代表已部署或已广播。

## 配置与效果

- 默认间隔为 4 小时，按市场调用 `setFundingInterval(marketId, intervalSeconds)` 修改。
- 允许 3600–86400 秒（1–24 小时），不要求整小时。
- `fundingInterval(marketId)` 返回实际配置；`FUNDING_INTERVAL()` 仅返回默认值，不能作为市场当前配置。
- `nextStreamStartAt(marketId)` 返回当前最早可启动时间：上次批次开始时间加当前配置。缩短间隔可使待处理资金更早进入下一批；延长间隔只延后下一批。
- setter 不主动启动批次、不结算余额。后续注资、checkpoint、转账或领取按既有流程推进；时间到达不会自行产生链上交易。
- 同一时间戳的资金继续合并，不通过重复小额注资推迟开始时钟。
- 已开始的每批仍释放 24 小时，已有释放结束时间和已赚收益不变。
- 环形队列容量固定 24，按最短 1 小时间隔确定。不能随当前配置动态改变环形队列模数。默认 4 小时下通常最多 6 个活跃批次；改短后最多 24 个。

## 权限与部署接线

沿用 `MarketRegistry.officialStockRegistry().authority()` 对应的 AccessManager，不增加独立管理员。

新部署渲染 AccessManager 计划时，传入 `holderRewardsDistributor` 扩展地址。计划会在冻结 selector 管理及撤销部署者权限之前，将 `setFundingInterval(bytes32,uint256)` 绑定至现有 `PROTOCOL_ADMIN_ROLE`（48 小时延迟）。该字段适用于 V3 扩展，旧版本计划可省略。V3 部署必须验证该绑定及 authority 链路后才能交接。

治理通过 AccessManager `schedule` / `execute` 修改；有延迟的治理地址不能绕过计划直接调用目标。变更事件为 `HolderFundingIntervalUpdated(marketId, previousInterval, newInterval)`。

## 后端与运行

后端按已验证链上调用顺序重放每市场间隔变更，并核对链上实际值；变更事件纳入事件目录；旧 V1/V2 的模式及容量继续独立识别。V3 是新运行时版本，不能套用旧发布的代码哈希、批准标记或环形队列解释。

官方 worker 的检查频率仍由运营配置决定，它与合约允许开始批次的最短间隔不同。worker 通过 `nextStreamStartAt` 判断批次是否到期。将合约改成 1 小时、但 worker 仍每 4 小时执行，不会自动变成每小时主动执行。

不对现有已部署合约热修改；发布新版本、验证权限配置和索引识别后才生效。当前变更只涉及批次间隔，不包含双资产奖励账本或用户领取时兑换改造。
