# 当前合约优化复审（2026-09-11）

范围：当前工作树的统一奖励领取、Holder 双资产释放/转账检查点、Gauge 结算、费用入账和兑换、Creator 交接、质押退出。结合上一轮创建/毕业关系表核对边界。本轮未修改合约、未请求 RPC、未部署；不是全量形式化验证或独立安全审计。工作树尚有未提交修改，因此报告针对本轮读取的源码，不以 HEAD 代表全部受审内容。

结论：本轮未确认新的高危资金盗取漏洞；发现 5 项明确的 Gas/代码清理候选、2 项领取体验/可用性设计问题和 1 项需要专项验证的失败恢复边界。优化应保留用户权益隔离、精确到账、质押锁、截止权益与防重入，不恢复已取消的兑换价格参考窗口或预设最低输出。

## 发现与建议

| ID / 优先级 | 证据与触发条件 | 影响 | 建议及验收 |
| --- | --- | --- | --- |
| O01 / 优先：高频 Gas | [UserClaims](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) 的 Staker 分支连续两次 `consumeClaimable`；[Gauge](../../contracts/src/v1/modules/MemeStockGauge.sol) 每次都读取 clone 身份、检查退出标记和锁，并 `_settlePosition`。后者已结算两种资产。 | 一次领取重复执行同一仓位的检查点、跨合约查询和双资产结算。 | 用仅 FeeVault 可调用的双资产消费入口返回 `(quote,meme)`，检查一次、结算一次、分别扣账。旧单资产内部消费入口若无其他生产调用者应删除。回归锁、到期 pending、rageQuit tombstone、两用户隔离及失败返还；单独测量完整领取 Gas。 |
| O02 / 优先：高频 Gas | [Holder.checkpointTransfer](../../contracts/src/v1/modules/HolderRewardsDistributorV1.sol) 分别处理 Quote/Meme；各自 `_account` 又读取同一 token 的 from/to 余额与 excluded 状态。 | 开启 Holder 分成的每次买卖、转账都承担重复读取；普通非排除双方一次转账可有四次相同 token 的余额读取。 | Token 转账前读取双方余额/排除状态一次，复用于两套奖励账本。不得合并两套指数、应计收益或资产负债。验证 self-transfer、零额、excluded、转账失败回滚以及双资产 24 批过期边界。 |
| O03 / 低：明确重复读取 | [UserClaims](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) 先 `market(id)`，紧接着 `_canonicalFeeMarket` 再读一次并返回 MarketView，但调用方忽略返回值。 | 每次 Claim 多一次完整市场读取；之后 `_holderDistributor` 也会重新读取市场。 | 优先直接采用 `_canonicalFeeMarket` 的返回值或对已加载快照做验证；复用范围限制在本次受保护操作内。不得照搬到跨外部资产转账的 begin/finalize 边界并删除其来源复核。 |
| O04 / 低：无生产调用的代码 | [MemeStockGaugeActivationWheel._effectiveTotalActiveStock](../../contracts/src/v1/shared/MemeStockGaugeActivationWheel.sol) 仅被测试 harness 使用；当前生产 `Gauge.effectiveTotalActiveStock` 实际通过 Manager 读取 Vault 权威账本。 | 源码保留两套“有效总质押量”计算，容易让维护者误接旧算法。不是已证实的运行时缺陷。 | 删除无生产调用的 helper；如测试需要独立 oracle，应放到测试目录。不要删除激活轮本身。编译器可能已消除不可达 helper，不宣称删除可节省运行时 Gas。 |
| O05 / 低：Holder 注入重复工作 | [FeeVaultLiabilities.fundHolderRewards](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol) 与 [UserClaims.fundHolderMemeRewards](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) 分别加载市场、进入保护状态、处理绑定和注入。 | 同一市场两种资产都待注入时，官方任务需要两个入口/交易并重复固定开销。 | 可提供仅负责双资产注入的统一入口，保持逐资产精确转账、独立负债与批次排队。单入口会耦合两种资产失败，故须先决定保留单资产路径还是允许分别失败；不应为减少交易数牺牲正常资产可用性。 |
| O06 / 中等可用性：双资产领取耦合 | [UserClaims](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) 无论用户选择何种领取方式，都预先检查两种资产偿付能力、消费两种权益，并依次付款；[Liabilities._payFeeAsset](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol) 任何转账失败均回滚。 | 某 Quote 的 balanceOf/转账被发行方阻断或出现偿付问题，可能连带阻止正常 Meme 原币领取。不能将“捕获兑换失败”理解为“捕获所有付款失败”。 | 评估同一 Claim 支持资产选择，并允许收益所有者指定 recipient。必须只扣所选资产、逐资产保证偿付能力；Holder/Gauge 也须支持不消费未选权益。另测拒收 ETH 的合约钱包、单资产故障与两用户隔离。这是新接口设计，不在本轮擅自实施。 |
| O07 / 低：原币领取被兑换有效期限制 | [UserClaims.claimUserRewards](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) 在读取 `convert` 和 Meme 余额前，无条件要求 deadline 位于当前时间至后 5 分钟之间。 | 用户选择直接领原币/仅领取已有 Quote，也可能因钱包确认慢或交易排队而过期失败；没有需要限期执行的兑换。 | 仅实际尝试兑换时验证兑换 deadline；纯原币领取不要求此参数有效。仍保持用户选择与资产归属校验，不引入价格保护。测试 convert=false 配合过期/远期 deadline，以及 convert=true 且确有 Meme 的边界。 |
| O08 / 待验证：失败恢复 Gas | [UserClaims](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) 对 `this.convertUserClaim` 没有显式 gas 限额/后处理储备，catch 后还要恢复 Meme 账本并执行付款。 | 极耗 Gas 或耗尽转发 Gas 的兑换子调用可能使余量不足以完成兜底，导致整笔回滚；并非盗取资金或已复现漏洞。提高总 gas 可能避免，不能声称所有兑换异常均可无条件领取已有 Quote。 | 增加耗尽 gas 的兑换 mock，分别测试三种角色、fallback 与保留、原生/ERC20 Quote。依据最坏后处理成本评估 gas 储备；不要随意写死过低兑换限额，导致本可成功的交易被截断。 |

## 已保留且不建议为省 Gas 删除的边界

- FeeVault begin/finalize 之间有外部资产转账，保留转账后的来源复核、feeId/nonce 防重复入账和精确余额差验证。
- Gauge 权重使用 Vault 的本金退出/奖励截止记录，保留 cohort、tombstone、pending 激活等检查；不能直接用一个缓存 totalStake 替代。
- Creator beneficiary epoch 属于收益权交接后的归属隔离，不是已废弃七天周期。
- Holder 的双资产负债、24 小时释放、1–24 小时可配置批次及固定 24 槽环形存储属于当前规则。
- 兑换继续由领取人选择；保留实际正数输出、池身份、deadline（兑换场景）和资产流量验证，不恢复价格窗口/预设最低到账。
- 目前没有证据支持为了“架构简洁”重写 Factory、毕业原子流程或永久 LP Locker。

## 本轮验证

实际运行 84 项测试，0 失败、0 跳过：

1. `node tools/run-forge.mjs test --match-path 'test/v1/shared/UserRewardClaims.t.sol' -vv`：10 项。
2. `node tools/run-forge.mjs test --match-contract 'HolderPoolFlowTest|RewardConversionPoolTest|HolderFundingIntervalTest|AllocationManagerExitsTest|CreatorRevenueRegistryTest' -vv`：74 项，含 256 次 fuzz 用例。

覆盖统一 Claim 的失败/部分兑换/用户隔离、额外协议费真实池模拟、Holder 间隔变更与批次过期、正常退出、创作者交接。当前测试通过不代表上述优化已实施，也不代表新增异常场景均已覆盖。

已有测试日志测得六批过期后的 Holder 转账约 258,869 gas，这是特定本地测试场景的原始值；不是 O02 的可节省量。未制作优化前后 A/B 基准，不承诺任何 Gas 节省百分比。

Foundry 曾打印预处理重复符号告警及签名缓存目录写入告警，最终两次命令均退出 0、所有列出的测试通过。没有真实 Fork 执行或新部署证明；完整发布资格不能由本轮定向测试替代。
