# 用户选择收益领取方式

更新：2026-09-10。适用于 `TICKERGARDEN_USER_CLAIM_V1` 与 Holder `TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4`。该版本已部署到 Robinhood testnet release `0x6e743e8bf90c0e91cd7de52711a1a68976401c494187f1e015fc66ef17310f95`，状态为 `ACTIVE_TEST_ONLY`；旧合约继续沿用旧规则，不能混用版本，前端切换仍受该 release 的公开市场 E2E gate 约束。

## 领取

Creator、Staker、Holder 在 Claim 确认框选择：

- **Convert And Claim**：领取已有 Quote，并只兑换本人已归属、可领取的 Meme。
- **Claim Original Assets**：直接领取 Quote 和 Meme 两种原资产，不再要求额外等待 7 天。
- 兑换模式可单独授权失败或部分成交后的原币兜底，默认不勾选。

Holder 的两种权益按相同有效持仓权重分别记账，每批分别释放 24 小时；注入间隔继续按市场配置，默认 4 小时。卖出代币不会消除之前已经赚取的权益。释放条件、排除地址、Staker 本金锁和 rage-quit 结算门槛不变。

## 兑换边界

用户最新确认：不恢复最低到账保护。项目调用 Hook 时 minimumQuote=0，不限制价格冲击，不使用参考价偏差、最低输出折扣或 20 分钟窗口门槛。20 分钟参考窗口常量、历史价格存储及更新调用已移除，交易和兑换不再维护这套记录。池子模拟仅展示预计到账。交易有效期不超过 5 分钟，前端使用 4 分钟。

价格很差但执行成功，不属于兑换失败，不触发兜底。PoolManager 仍使用合法 TickMath 价格边界；LP fee 保持零，可兼容既定 Core protocol fee，内部兑换不重复收本项目手续费。

## 原子性与资产隔离

FeeVault 在受保护领取中扣减本人两种权益。兑换通过仅合约自身可调用的子调用执行，授权、余额核对和资产流转位于该子调用内。失败全部回滚至兑换前，外层仍可支付已有 Quote。

- 完全失败：授权兜底则发放该用户 Meme，否则恢复其待领取 Meme。
- 部分成交：发放实际得到的 Quote；剩余 Meme 按授权发放或恢复。回执单独记录已兑换、已发原币和保留数量。
- Holder 先从分配器提取本人已释放的两种资产；保留部分退回分配器并恢复原用户已赚取余额，不重新释放、不分配给别人。
- Creator 按历史 creator epoch 固定归属；Staker 保留 Gauge 的锁定与权益校验。
- 保留实际正数到账、前后余额差、资产偿付能力、回调来源、防重入和授权清理校验。

新 FeeVault 停止 operator 集体兑换，旧原币等待期开关不再支持。后台任务仅归集并注入两种资产，不能代替用户选择兑换。

## 版本与数据

前端先检查 FeeVault 的 userClaimMode；Holder V4 单独使用部署完成的 release approval，不能沿用 V3 的批准。新部署必须同时更新 FeeVault、Hook、Holder distributor、Gauge pin、Factory、ABI 与发行目录；不存在对既有不可升级市场的原地升级。

Quote/Meme 注入使用 HolderAssetFunded 事件，按实际转移扣减 FeeVault 负债；开始释放不再被误作新的资金注入。后端区分两资产资金覆盖。旧单资产历史重放器不能用于 V4；即时领取余额取链上 claimableAssets，不能用旧历史投影生成领取权限。
