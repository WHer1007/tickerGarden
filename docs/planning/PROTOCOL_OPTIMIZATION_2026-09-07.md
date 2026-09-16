# 协议优化操作指南（2026-09-07）

状态：已实现代码与前端接线，尚未广播或部署到生产；维护任务仍需要接入受信任的持久化 transport 后才能执行。

## 防抢跑窗口

买入侧使用 5 秒固定窗口。按交易所在区块的经过秒数计算额外防抢跑费率（实际受最低净买入保护限制）：

| 经过时间 | 额外费率（bps） |
| --- | ---: |
| 0 秒 | 9,900 |
| 1 秒 | 2,475 |
| 2 秒 | 309 |
| 3 秒 | 19 |
| 4 秒 | 1 |
| 5 秒及以后 | 0 |

该规则只影响非豁免买入，卖出和现有协议地址豁免规则保持不变。实现位置是 `TickerGardenAntiSnipe.sol`；前端报价必须从链上读取，不能用旧的 3 秒表硬编码。旧 3 秒观察结果属于历史证据，不能用于验证新发布版本。

## 创建者收益地址交接

交接是两步操作，避免当前受益人被单笔交易意外替换：

1. 当前受益人调用 `transferCreatorRevenueBeneficiary(marketId, newAddress)` 提名地址。此时 epoch、收益归属和可领取余额不变；新的提名会覆盖旧的待确认提名。
2. 新地址调用 `acceptCreatorRevenueBeneficiary(marketId)`。合约先执行必要的曲线手续费归集，并要求没有未结清的曲线手续费，然后创建新的 append-only epoch。

当前受益人可以调用 `cancelCreatorRevenueBeneficiaryTransfer` 取消提名。提名地址不能自行取消或提前领取旧 epoch 的收益。人工操作后应核对 `pendingCreatorRevenueBeneficiary`、`currentCreatorEpoch` 和事件日志；接收地址丢失时只能由当前受益人取消并重新提名，不能由管理员强行接管。

## 持有人收益生命周期

真实到账的 Quote 进入 24 小时线性释放流。领取不需要等待 24 小时；用户只能领取已累计部分，尚未释放的部分继续显示为 pending。每次 funding 有独立结束时间，追加 funding 不会重置已有流的结束时间。资金兑换失败时不得虚记可领取余额。

管理员和前端应区分：待归集/待兑换、正在 24 小时释放、已累计可领取。`releaseState(marketId)` 用于查看未释放金额、闲置 Quote、下一结束时间和活动流数量；`lastFundingAt` 只表示最近一次真实入账时间，不是用户收益结算时间。零有效供应时进入 idle，不能把无人持有期间的奖励追溯给下一位买家。

## 内部兑换维护队列

`services/maintenance-runner` 的 conversion queue 只负责有界调度，不负责定价或私钥管理。每个任务必须带 chain、release、factory、market 和 rewardKind（creator-staker 或 holder）身份；执行前重新读取绑定、待兑换余额和新鲜流动性上限，读取的 observedAt 不得超过 30 秒；取待兑换金额、流动性上限、退避 cap 和任务上限的最小值作为本批 cap。

执行要求：

- 使用数据库或等价存储实现跨 worker 原子 lease、状态保存和幂等 key。
- 先保存 `pending` 意图，再调用既有 quote-bound settlement transport；广播结果必须可 reconcile。
- `confirmed` 后才允许下一批；`pending` 等待确认；`reverted` 或 `unknown` 阻断该市场，不能盲重试未知广播结果。
- 价格类失败将 cap 减半并指数退避，最多 6 次；其他市场必须继续处理。
- 当前 CLI 的 `--execute-transport` 是适配器入口。没有可信 durable adapter、receipt reconciliation 和密钥隔离时，只能生成计划，不能宣称已执行或已上线。

## 多 release 市场绑定

前端从 `VITE_MARKET_RELEASE_CATALOG` 读取 release catalog，再以链上 factory、market registry、hook、FeeVault、creator registry、holder distributor、launch router 和 allocation manager 交叉核验。未知 factory、重复 factory、零地址或跨合约绑定不一致时，市场必须锁定，不能回退到全局旧地址。

旧 release 与新 release 可并存。索引、维护任务和领取操作必须携带 release identity；升级时新增 catalog 条目并保留旧条目，不能覆盖历史绑定。发布前要为每个市场保存链 ID、factory 和全部绑定地址的快照。

## 发布前人工检查

确认 ABI、runtime hash、权限矩阵和部署 manifest 已由同一份编译产物生成；逐市场验证 release bindings；用小额测试资金验证 5 秒边界、提名/确认交接、24 小时流状态和兑换失败隔离。任何测试网或生产广播都必须另行记录链 ID、部署地址、交易哈希和代码 hash。本文件不构成部署完成证明。

