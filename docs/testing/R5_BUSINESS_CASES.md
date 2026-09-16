# R5 业务测试用例目录

共 76 条。以 JSON 为唯一目录源；结果独立登记。金额使用整数最小单位，具体角色、地址、时间和输入在每次 execution 证据中冻结。

本地选择器仅证明对应断言，不能自动证明整条业务用例或其公共链环境通过。

## R5-ENV-01 · 锁定源码、部署身份及外部依赖

优先级：P0；必需环境：local, public。

前置：R5 已激活；RPC可读。

1. 记录源码哈希、releaseId和区块哈希
2. 在同一区块读取21个部署地址代码并比较manifest
3. 核实chainId和所有配置ID

验收断言：

- RPC为421614；RH4663仅为目标
- 21个runtime哈希逐一相等；缺失任何一项即停止公共写入

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-ADM-01 · 无权限账户不得更改白名单

优先级：P0；必需环境：local, public。

前置：admin与outsider分离；全新uid。

1. outsider注册、暂停、退休股票及暂停Quote
2. 管理员在隔离fixture执行同一合法操作

验收断言：

- outsider精确权限错误；配置和事件不变
- admin操作成功且只影响指定fixture

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-ADM-02 · 平台接收器配置兑换执行者和轮换

优先级：P0；必需环境：local, public。

前置：独立测试接收器与FeeVault绑定。

1. owner设置operatorA再换B
2. 非owner、零地址、自身、EOA vault及错误receiver分别设置

验收断言：

- 仅owner能配置
- 轮换后旧operator不能兑换，新operator可兑换
- 无效目标失败且原operator不变

本地支持选择器：test_configureSettlementOperator_succeedsAndRotates；test_configureSettlementOperator_rejectsUnauthorized；test_configureSettlementOperator_rejectsZeroAndSelfOperator；test_configureSettlementOperator_rejectsEOAAndWrongTreasury；test_configureSettlementOperator_revertsWhenGetterMismatchesAndRollsBack

## R5-ADM-03 · 管理员转移与最小权限角色隔离

优先级：P0；必需环境：local, public。

前置：独立组件/本地全图，不能改变活动R5所有权。

1. 枚举所有restricted入口及角色
2. 将管理权交给候选多签治理配置
3. 旧账户和新账户分别调用

验收断言：

- 新控制方能完成需要的操作；旧权限确实撤销
- 未移交模块列为缺口；不能只验证一个owner字段

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-REG-01 · 未知、暂停、退休和身份漂移股票不能创建市场

优先级：P1；必需环境：local, public。

前置：staking开启；记录预测地址和现有市场数。

1. 分别提供未知uid、paused、retired、错误代码指纹
2. 对每次失败比较预测地址代码和注册表状态

验收断言：

- 全部fail closed；不产生token/curve/gauge或预约身份
- 既有合法股票市场不受影响

本地支持选择器：test_inactiveRegistrySnapshotFailsClosed；test_allFactoryRegistryConfigClassesFailClosedWithoutReservingIdentity；test_unknownFactoryConfigIdsFailClosedAcrossEveryRegistry

## R5-REG-02 · Quote风险准入与停用

优先级：P1；必需环境：local, public。

前置：独立ERC20 fixture管理员已审核。

1. 登记Quote及经济参数
2. 使用未知和暂停Quote创建
3. 对6/8/18位精度分别计算承诺与阈值

验收断言：

- 合法登记可创建；未知暂停不可创建
- 精度只转换单位不改变经济承诺；身份漂移拒绝

本地支持选择器：test_newMarketsMaySelectDifferentIndependentActiveQuoteConfigs

## R5-REG-03 · 代币异常返回、转账扣费和回调

优先级：P0；必需环境：local。

前置：本地对抗Quote/stock fixture。

1. 无返回/false/畸形返回/扣费Quote分别执行atomic buy
2. 回调中重入router或canonical mutation
3. 比较用户余额、allowance、市场注册

验收断言：

- 不满足exact arrival或返回格式的交易整笔回滚
- 回调不能进入二次mutation；无残留市场

本地支持选择器：test_launchAndBuyERC20RejectsFeeOnTransferBeforeMarketCreation；test_launchAndBuyERC20RejectsNonCanonicalTransferReturns；test_launchAndBuyERC20TransferCallbackCannotEnterRouter；test_launchAndBuyERC20ReentrantTransferCannotEnterCanonicalMutation

## R5-CREATE-01 · 股票质押可选而且语义一致

优先级：P1；必需环境：local, public。

前置：合法模板和Quote。

1. 关闭staking+zero uid创建
2. 开启staking+zero uid创建
3. 关闭staking+非零uid创建

验收断言：

- 关闭时无Gauge且可交易领奖
- 矛盾组合拒绝；不能默默改变用户选择

本地支持选择器：test_disabledStakingCreatesWithoutStockOrGaugeAndPreservesHolderChoice；test_stakingModeRejectsContradictoryStockAndStaleEconomics

## R5-CREATE-02 · 经济承诺、命名空间和CREATE2重复创建

优先级：P1；必需环境：local, public。

前置：相同salt和不同creator/config。

1. 验证预测与实际组件地址
2. 同身份重建
3. 不同creator、tax、sharing各重用salt
4. 提交stale expectedEconomics

验收断言：

- 实际地址与预测一致；同身份拒绝
- 独立身份不互相抢占；stale承诺在部署前失败

本地支持选择器：test_predictAndCreateDeployExactComponentsAndRegisterFullSnapshot；test_sameStockAndSaltCanCreateDistinctTypedMarketsButIdenticalIdentityCannotRepeat；test_wrongEconomicsRevertsBeforeAnyAddressIsDeployed；test_creatorFeesToHoldersChangesEconomicsAndPredictedIdentity

## R5-CREATE-03 · 创建手续费和Developer buy支付边界

优先级：P1；必需环境：local, public。

前置：ETH和ERC20各一合法配置。

1. ETH分别发送应付-1/应付/应付+1 wei
2. ERC20仅发送launchFee并批准Quote
3. 测试allowance不足、零recipient和minOut过高

验收断言：

- 只接受规定value；有效调用同笔创建和买入
- 失败不留下市场、token、creator epoch或已扣资金

本地支持选择器：test_launchAndBuyNativeRequiresExactCombinedValueBeforeDeployment；test_launchAndBuyNativeRejectsInvalidBuyAndRecipientBeforeDeployment；test_launchAndBuyERC20MissingAllowanceFailsBeforeMarketCreation；test_launchAndBuyNativeBuyFailureRollsBackMarketAndCanRetrySameIdentity

## R5-CREATE-04 · 部分成交退款和合约调用者身份

优先级：P1；必需环境：local, public。

前置：atomic buy超过剩余曲线容量；合约caller。

1. ETH/ERC20分别tail fill
2. 收款合约拒收退款
3. 通过中间合约调用创建

验收断言：

- 只收实际成交；多余返回真实caller
- 拒收退款整笔回滚
- creator取msg.sender而非tx.origin；beneficiary不替代creator

本地支持选择器：test_launchAndBuyNativeTailFillReturnsExactRefundToCreatorAndLeavesNoDust；test_launchAndBuyERC20TailFillReturnsExactTokenRefundToCreator；test_launchAndBuyNativeRejectedRefundRollsBackTheWholeLaunch；test_launchAndBuyUsesImmediateContractCallerAndNeverTxOriginAsCreator；test_beneficiaryIsTypedRevenueIdentityButNeverReplacesCreatorOrMemeRecipient

## R5-CREATE-05 · 创建多组件后期故障原子回滚

优先级：P0；必需环境：local。

前置：本地故障注入部署/注册/奖励初始化。

1. 逐个组件构造、market注册、creator注册、holder注册点抛错
2. 修复故障后复用原salt重试

验收断言：

- 每次失败全部组件和预约、资金回滚
- 修复后同身份可成功创建

本地支持选择器：test_eachComponentDeploymentFailureRollsBackEarlierComponentsAndReservation；test_marketRegistrationFailureRollsBackComponentsFeeEpochAndReservation；test_creatorEpochRegistrationFailureRollsBackMarketComponentsFeeAndReservation；test_revertingCreatorFeesToHoldersRegistrationRollsBackCreation

## R5-TAX-01 · Creator tax上下限及持有人隔离

优先级：P0；必需环境：local, public。

前置：sharing开关各一组；tax=0/250/500/501。

1. 分别创建并买卖
2. 独立复算base tax及creator holder平台增量

验收断言：

- 0/250/500允许，501拒绝
- tax全部归creator；holder只分creator基础份额50%

本地支持选择器：test_creatorTaxCapAndEconomicsCommitment；test_creatorTax500IsAddedToCreatorAfterBaseFeeSplitWithActiveStake；test_creatorTax500WithZeroActiveStakeRemainsCreatorOwned

## R5-CURVE-01 · 反狙击与开发者首次购买例外

优先级：P1；必需环境：local, public。

前置：新建市场；精确时间边界。

1. 首次router atomic buy
2. 随后普通buyer同窗口购买
3. 窗口边界前后报价执行

验收断言：

- 首次特许不免Creator tax；后续不继承豁免
- 扣费符合时间函数，净额不为负

本地支持选择器：test_atomicDeveloperBuyPaysCreatorTaxEvenWhenSnipeExempt；test_creatorTaxLeavesOnePercentNetDuringAntiSnipe

## R5-CURVE-02 · 滑点、精确支付与强制余额隔离

优先级：P1；必需环境：local, public。

前置：有曲线储备和意外转入余额。

1. minOut高于可得输出买卖
2. ETH支付错误
3. 强制转入Quote/meme后重新报价及毕业进度

验收断言：

- 滑点/支付失败不改储备和余额
- 意外余额不改变定价和净毕业进度

本地支持选择器：test_tailProportionalSlippageRevertsWithoutChangingState；test_nativePaymentMustEqualDeclaredQuote；test_forcedBalancesDoNotChangePricingOrGraduationProgress

## R5-GRAD-01 · 净Quote阈值、部分成交及v4资产交接

优先级：P0；必需环境：local, public。

前置：距毕业有少量余量；ETH净门槛0.42。

1. 记录真实储备而非累计gross输入
2. 不足阈值买入
3. 超额最终买入并捕获refund及pool状态

验收断言：

- 只有净储备到阈值才毕业；费用不算筹款
- 精确退款；phase一次变更，LP/余量资产可对账
- 毕业后curve买卖拒绝

本地支持选择器：test_tailNativeBuyPartiallyFillsRefundsCallerAndCompletes；test_exactErc20TailBuyRefundsInTheSameAsset；test_completedMarketRejectsFurtherTrades

## R5-GRAD-02 · 毕业hook/PoolManager/收费故障原子回滚

优先级：P0；必需环境：local。

前置：本地真实部署图故障注入。

1. 最终买入在sweep/plan/pool commit分别失败
2. 比较之前reserve phase fee nonce部署池及余额

验收断言：

- 不得留下半毕业状态
- 所有收费、买入输出和phase回滚

本地支持选择器：test_failedAutomaticGraduationRollsBackEntireFinalBuy；test_finalFeeSweepFailureRollsBackTheEntireFinalBuy；test_poolCommitFailureRollsBackFeesAssetsAndFinalBuy

## R5-FEE-01 · 无质押市场创建者和平台可领取

优先级：P0；必需环境：local, public。

前置：staking关闭，Gauge为zero；ETH/ERC20费用均已入账。

1. 外部账户触发creator/platform claim
2. 比较真实收款人余额与各bucket
3. 再次领取；尝试claimStaker

验收断言：

- creator/platform准确收到各自费用，债务清零
- 二次领取不重复付款；staker路径InvalidFeeMarket

本地支持选择器：test_disabledStakingCreatorConversionAndQuoteClaimWithoutGauge；test_disabledStakingCannotConvertStakerItems

## R5-FEE-02 · 多资产多市场多epoch隔离与偿付

优先级：P0；必需环境：local, public。

前置：两市场/两creator epoch/Quote和meme都有负债。

1. 只领取一bucket并记录其他bucket
2. 插入不足总backing场景再领取兑换

验收断言：

- 未选bucket不变；资产总余额不低于总负债
- 不足总backing时整体拒绝，不抢先付给一个用户

本地支持选择器：test_quoteAndMemeCreditsUseIndependentLiabilitiesAndGaugeAssets；test_insufficientTotalBackingRollsBackSelectedBatch

## R5-FEE-03 · 有效质押零与正值分配切换及舍入

优先级：P0；必需环境：local, public。

前置：已毕业staking市场；0/小额/大额active stock。

1. 0active交易；激活后交易；全退出后再交易
2. 独立整数计算含1wei等极小fee

验收断言：

- 0active基础70/0/30；正active40/30/30
- holder再从creatorBase取floor(50%)；tax独立
- 各方总和精确等于fee，余数遵循creator归集

本地支持选择器：test_zeroActiveStockCreditsSeventyZeroThirtyAndSkipsGaugeCredit；test_maturedActiveStakeIsCheckpointedBeforeSnapshotAndCreditsGauge；test_integerRemainderGoesToCreatorAfterFixedBeneficiaryFloors；test_creatorTaxAndBaseFeeBothUseFloorRoundingForTinyBase

## R5-FEE-04 · 收费入口nonce重放与身份漂移

优先级：P0；必需环境：local。

前置：合法fee记录已提交；本地可控制hook身份。

1. 重复feeId或nonce；改market/asset/epoch/policy
2. checkpoint或Gauge credit故障

验收断言：

- 全部异常不改变收款/负债/nonce
- 合法下一序号仍可使用

本地支持选择器：test_feeIdAndNonceMustMatchEveryCanonicalFieldAndSequence；test_policyOrCreatorEpochDriftRollsBackEverything；test_gaugeCheckpointOrCreditFailureRollsBackTransferFeeIdAndNonce

## R5-STAKE-01 · 直接钱包质押准入与失败无扣款

优先级：P0；必需环境：local, public。

前置：staking开/关及未毕业/已毕业市场；股票在钱包。

1. 在禁止状态stake
2. allowance不足、wallet不足、低于minimum
3. 正确approve Vault后stake100

验收断言：

- 禁止状态精确拒绝且钱包不变
- 成功钱包减少100，Vault allocation和Gauge position增加100

本地支持选择器：test_stakeWalletFundsFullRoundTripAndPreservesRewards；test_stakeCannotUseFreeLedgerWhenWalletIsInsufficient；test_stakeBelowMinimumRevertsAndDoesNotPullWalletFunds

## R5-STAKE-02 · 两用户权重与激活、追加锁定

优先级：P1；必需环境：local, public。

前置：A=100，B=300；新增stake尚未激活。

1. 激活前交易
2. 等pendingGeneration后checkpoint
3. 再次交易；A增加100后比较pending/active和unlock

验收断言：

- 未激活本金不获奖励
- 激活后按1:3分30%bucket，追加不篡改既有奖励
- unlock按规则更新，Vault总账保持一致

本地支持选择器：test_allDepositPathsOnlyIncreaseOnePosition；test_realGaugeDistributesStakerBucketByActiveRawStockAndClaimsThroughVault

## R5-STAKE-03 · 正常整仓退出及精确本金

优先级：P0；必需环境：local, public。

前置：有本金和已赚奖励，锁定期结束时间已读出。

1. unlockAt-1拒绝
2. unlockAt和+1各独立状态退出
3. 重复退出；尝试指定他人收款或部分退出

验收断言：

- 仅整仓返还原用户本金，无跨用户绕过
- 奖励保留；重复不重复释放

本地支持选择器：test_closeAtUnlockRemovesAndReleasesTheWholePosition；test_unstakeLockedRevertsWithoutChangingPrincipal；testFuzz_unstakeAlwaysReturnsExactlyTheFullPrincipal；test_vaultWithdrawalEndpointRejectsCrossUserCaller；test_canonicalSurfaceHasNoDecreaseMigrationOrRecipientBypass

## R5-STAKE-04 · 暂停/退休时仍可退出；转账失败回滚

优先级：P0；必需环境：local, public。

前置：本地或独立fixture有stake。

1. pause/retire后新增stake
2. 正常整仓退出
3. 注入stock转账失败、Gauge故障或重入

验收断言：

- 新stake禁止，正常退出仍可行
- 转账/账本失败时Gauge Vault wallet全部回滚

本地支持选择器：test_unstakePausedAndRetiredAssetStillWithdraws；test_unstakeWithdrawalTokenFailureRollsBackGaugeVaultAndWallet；test_gaugeFailureNoopWrongReturnAndReentrancyRollBackTheWholeClose

## R5-STAKE-05 · 提前退出本金优先与奖励清算重试

优先级：P0；必需环境：local, public。

前置：未unlock，有pending/active及两种奖励。

1. rageQuit；模拟奖励清算失败
2. 比较本金到账和deferred状态
3. permissionless settleRageQuitRewards重试两次

验收断言：

- 本金只回一次且无残留allocation
- 应没收奖励不得领取；清算失败可独立重试
- 旧position/tombstone不会污染重新stake

本地支持选择器：test_rageQuitStillWithdrawsTheWholePositionDirectly

## R5-REWARD-01 · 创建者和质押者内部批量兑换

优先级：P0；必需环境：local, public。

前置：同市场creator与staker meme奖励>0。

1. operator以两item兑换且minQuote>0
2. 比较meme支出、Quote到账及item分摊
3. 第三方触发creator quote claim

验收断言：

- Quote按实际输出分配且总和守恒；不二次扣普通fee或tax
- 接收者不可替换；holderbucket完全不变

本地支持选择器：test_creatorAndStakerBatchProRataPreservesFixedRecipients；test_nativeQuoteConversionUsesExactBalanceDelta；test_partialOutputRefundReturnsToOriginalOwner

## R5-REWARD-02 · 兑换授权、deadline、重复项和滑点失败

优先级：P0；必需环境：local, public。

前置：有可转换奖励；前后快照固定。

1. 非operator、过期、超过最大deadline、重复item、错误epoch beneficiary、过高minQuote分别调用

验收断言：

- 全部精确拒绝且所有用户负债/资金原样
- 合法重试可成功，不因失败耗掉nonce或权益

本地支持选择器：test_badOperatorAndDuplicateItems；test_historicalEpochRecipientValidation；test_minOutputAndBalanceMismatchRollback

## R5-REWARD-03 · Quote领取锁定与原币7天退出

优先级：P0；必需环境：local, public。

前置：已兑换staker Quote；未unlock；creator有meme。

1. lock前领取Quote
2. requestRawRewardExit并重复request
3. cancel后再request
4. readyAt-1/readyAt/+1领取meme

验收断言：

- Quote按各角色锁定规则，creator不受meme raw gate影响
- 重复request不绕过等待；cancel重新计时
- 到期原币只发给真实权益人且只发一次

本地支持选择器：test_rawExitBlocksClaimsUntilReadyAndSettlementExcludesReady；test_quoteClaimsUnaffectedByMemeExitGate；test_disabledStakingCreatorRawExitStillRequiresDelay

## R5-CREATOR-01 · 创建者收益权转移与历史epoch

优先级：P0；必需环境：local, public。

前置：两beneficiary，曲线有未sweep费用。

1. 旧beneficiary转给新地址
2. 转移前后各交易和claim
3. 非owner、same地址、zero地址尝试转移

验收断言：

- 旧费用先结算旧epoch；新fee归新epoch
- 历史权益不可被新beneficiary盗领
- 错误转移拒绝，epoch不可溢出

本地支持选择器：test_notGraduatedSweepsOldEpochBeforeCheckedIncrement；test_onlyCurrentBeneficiaryCanTransferAndInputMustChange；test_closedLaunchPhasesDoNotResweepButStillRequireZeroAccrued；test_epochIncrementCannotWrapUint32

## R5-HOLDER-01 · 持有人独立兑换、周期注资与开关

优先级：P0；必需环境：local, public。

前置：sharing开关及tax0/500市场都有费用。

1. 分别兑换creator和holder meme
2. fundHolderRewards至epoch
3. 第三方重复fund；检查creator未受影响

验收断言：

- 关时holder为0；开时只含creator基础份额一半
- holderQuote进入对应epoch且不重复记账
- Creator tax仍100%在creator路径

本地支持选择器：test_disabledCreatorFeesToHoldersPreservesExistingFlow；test_enabledCreatorFeesToHoldersRegistersImmutableSharingConfig

## R5-HOLDER-02 · 7天周期起止与finality

优先级：P1；必需环境：local, public。

前置：已毕业sharing市场，epochWindow已取得。

1. end-1请求root
2. end加所需秒和区块后请求
3. 查询第2epoch起始

验收断言：

- 未满足7天及finality必须拒绝
- epoch2恰好接epoch1，不能重叠/漏秒
- 自然时间真实请求回执与本地warp分开

本地支持选择器：test_sevenDaysMinusOneSecondCannotRequest；test_sevenDaysPlusFinalityCanRequest；test_epochTwoStartsExactlyAtSevenDayBoundary

## R5-HOLDER-03 · 真实持仓积分和根发布到领取

优先级：P0；必需环境：local, public。

前置：真实R5市场已满epoch；indexer完成canonical finality。

1. 回放实际Transfer与排除地址
2. 独立计算TWAB根
3. requestRoot、publish、审核finalize
4. 两holder提交proof并比较余额

验收断言：

- 根总量和periodQuote、积分可独立复算
- 只有有效完整证明领取且不超funded
- 全过程真实链上事件与服务任务可追溯

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-HOLDER-04 · 错误根、proof、重复领取与挑战

优先级：P0；必需环境：local, public。

前置：独立周期有funding和已发布根。

1. wrongchain/market/epoch/account/amount proof
2. 重复claim、过早finalize、过期publish
3. 触发并解决challenge

验收断言：

- 错误根/证明不可支付；重复领取不可重复付款
- 争议期不允许绕过finalize；bond处理可对账

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-HOLDER-05 · 30天领取截止与结转

优先级：P1；必需环境：local, public。

前置：已finalize且有未领取余额。

1. claimDeadline-1/at/+1各独立状态claim
2. 窗口后结转并尝试旧proof

验收断言：

- 领取截止规则精确；超期旧proof拒绝
- 未领资金不丢失或重复使用，结转有完整会计

本地支持选择器：test_thirtyDayClaimWindowIsIndependentFromSevenDayEpoch

## R5-REG-04 · 股票解暂停延时与身份复验

优先级：P1；必需环境：local, public。

前置：独立已pause股票。

1. pause后立刻unpause
2. unlock-1/at/+1
3. 等待中改变fingerprint再解暂停

验收断言：

- 时间未到拒绝；到期仍须身份匹配
- 不能用等待绕过风险审核

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-SERVICE-01 · 索引器重复回放和链重组

优先级：P0；必需环境：local, public。

前置：R5实际交易回执与日志；独立数据库。

1. 同区块批量导入两次
2. 重启后从checkpoint续跑
3. 模拟canonical分支撤销重放

验收断言：

- 事件唯一键不重复；回滚影响投影和cursor一致
- 最终投影与真实canonical余额/market/fee事实一致

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-SERVICE-02 · 维护任务幂等、租约与失败恢复

优先级：P0；必需环境：local, public。

前置：隔离维护数据库/worker。

1. 两个worker抢同任务
2. 签名前失败、签后无响应、已上链未回写
3. 恢复并按hash/nonce查询receipt

验收断言：

- 同任务不双发；未知交易先reconcile
- 租约过期能恢复，永久失败不无限重试
- 确认链上事实后再标success

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-SERVICE-03 · 根生成器确定性、精度和排除地址

优先级：P0；必需环境：local, public。

前置：已冻结canonical输入文件。

1. 不同输入顺序重复生成
2. 积分为0、极小余额、精度大数
3. 恶意/缺失/重复用户及错误epoch输入

验收断言：

- 相同事实相同root和proof
- 分配总和不超资金，零积分按规则处理
- 无效输入fail closed而非静默剔除

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-SERVICE-04 · 后端读API、报价与错误配置

优先级：P1；必需环境：local, public。

前置：连接R5的独立服务实例。

1. 错chain/旧release/失效价格调用
2. 服务重启、RPC429/timeout/停服
3. ReadAPI分页和canonical状态比对

验收断言：

- 错误或过时数据不驱动签名/结算
- 不可用状态清楚，恢复不重复处理事件
- API结果绑定正确chain release和最终区块

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-SERVICE-05 · 真实服务端到端领取链路

优先级：P0；必需环境：local, public。

前置：R5已成熟epoch和独立运行服务。

1. 实际公共链事件→indexer→root input→publisher→finalizer→API→claim
2. 重启其中一个服务后恢复

验收断言：

- 任务状态与链上receipt一一一致
- root来自真实历史，不用预造fixture替代
- 可复现操作命令和日志完整

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-UI-01 · Chrome MetaMask创建交易质押领取联合测试

优先级：P1；必需环境：frontend, public。

前置：用户确认纳入且钱包为Arbitrum Sepolia。

1. 核对页面R5地址
2. 创建、buy/sell、stake、convert/claim、拒签、切错链、交易pending恢复

验收断言：

- 展示数量和签名calldata一致；拒签不显示success
- 切链阻止错误网络发送；待确认和失败清晰
- 实际钱包截图/tx，不以单测替代

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-PROD-01 · RH生产依赖与stock实际行为

优先级：P0；必需环境：rh-fork。

前置：RH目标网络独立只读/Fork；不得广播。

1. 核实PoolManager等runtime和chain
2. 真实RH Stock Token代码/转移限制/升级指纹
3. 目标Quote池流动性和执行滑点

验收断言：

- 兼容性证据绑定真实RH地址区块
- 合成Stock不算同源码验证；Arbitrum通过不能自动放行RH

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-PROD-02 · 生产治理、密钥恢复与经济参数门禁

优先级：P0；必需环境：production-plan。

前置：正式多签治理/运营方案尚待配置。

1. 复核治理角色、应急暂停、换operator和恢复流程
2. 用生产参数回测launch/graduation/兑换滑点和gas预算
3. 演练RPC中断和人工恢复

验收断言：

- 明确多签阈值、延时、监控及恢复责任
- 0.42测试门槛不等于4.2生产经济验证
- 门禁未完成不出生产可上线结论

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H0-T0-CORE · ETH-S0-H0-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=False；tax=0bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=False；holder=False；tax=0bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H0-T0-GRAD · ETH-S0-H0-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=False；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H0-T500-CORE · ETH-S0-H0-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=False；tax=500bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=False；holder=False；tax=500bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H0-T500-GRAD · ETH-S0-H0-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=False；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H1-T0-CORE · ETH-S0-H1-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=True；tax=0bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=False；holder=True；tax=0bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H1-T0-GRAD · ETH-S0-H1-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=True；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 独立兑换holder并fund epoch
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H1-T500-CORE · ETH-S0-H1-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=True；tax=500bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=False；holder=True；tax=500bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S0-H1-T500-GRAD · ETH-S0-H1-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=False；holder=True；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 独立兑换holder并fund epoch
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H0-T0-CORE · ETH-S1-H0-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=False；tax=0bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=True；holder=False；tax=0bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H0-T0-GRAD · ETH-S1-H0-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=False；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H0-T500-CORE · ETH-S1-H0-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=False；tax=500bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=True；holder=False；tax=500bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H0-T500-GRAD · ETH-S1-H0-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=False；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H1-T0-CORE · ETH-S1-H1-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=True；tax=0bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=True；holder=True；tax=0bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H1-T0-GRAD · ETH-S1-H1-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=True；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 独立兑换holder并fund epoch
6. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H1-T500-CORE · ETH-S1-H1-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=True；tax=500bps；已白名单；creator与buyer隔离。

1. 以0.001 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=ETH；staking=True；holder=True；tax=500bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ETH-S1-H1-T500-GRAD · ETH-S1-H1-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=ETH；staking=True；holder=True；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 独立兑换holder并fund epoch
6. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H0-T0-CORE · ERC20-S0-H0-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=False；tax=0bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=False；holder=False；tax=0bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H0-T0-GRAD · ERC20-S0-H0-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=False；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H0-T500-CORE · ERC20-S0-H0-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=False；tax=500bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=False；holder=False；tax=500bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H0-T500-GRAD · ERC20-S0-H0-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=False；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H1-T0-CORE · ERC20-S0-H1-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=True；tax=0bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=False；holder=True；tax=0bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H1-T0-GRAD · ERC20-S0-H1-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=True；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 独立兑换holder并fund epoch
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H1-T500-CORE · ERC20-S0-H1-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=True；tax=500bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=False；holder=True；tax=500bps
- Gauge为零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S0-H1-T500-GRAD · ERC20-S0-H1-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=False；holder=True；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 兑换creator
4. 独立兑换holder并fund epoch
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，任何时刻无stakerbucket；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H0-T0-CORE · ERC20-S1-H0-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=False；tax=0bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=True；holder=False；tax=0bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H0-T0-GRAD · ERC20-S1-H0-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=False；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H0-T500-CORE · ERC20-S1-H0-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=False；tax=500bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=True；holder=False；tax=500bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=0；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H0-T500-GRAD · ERC20-S1-H0-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=False；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H1-T0-CORE · ERC20-S1-H1-T0 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=True；tax=0bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=True；holder=True；tax=0bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H1-T0-GRAD · ERC20-S1-H1-T0 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=True；tax=0bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 独立兑换holder并fund epoch
6. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H1-T500-CORE · ERC20-S1-H1-T500 创建—曲线—领取

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=True；tax=500bps；已白名单；creator与buyer隔离。

1. 以1 Quote执行atomic developer buy
2. buyer再买同数量；卖出其token的1/4
3. sweep全部curve fees
4. outsider触发creator/platform claim并重复eth_call

验收断言：

- 市场配置精确等于Quote=测试ERC20(18位)；staking=True；holder=True；tax=500bps
- Gauge非零；developer获得实际token
- creatorBase=basic-floor(basic*30%)；holder=floor(creatorBase/2)；tax全部creator
- 各笔CurveBuy/Sell原始fee独立复算分配，Quote总负债守恒
- 真实收款人余额增加对应bucket，bucket清零，重复无付款

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。

## R5-MATRIX-ERC20-S1-H1-T500-GRAD · ERC20-S1-H1-T500 毕业—v4—兑换

优先级：P1；必需环境：local, public。

前置：Quote=测试ERC20(18位)；staking=True；holder=True；tax=500bps；CORE完成；有足额毕业本金。

1. 最终买入触发毕业且超额退款
2. 无active stock时v4买和卖
3. 两用户stake100/300；自然激活后再买卖
4. 兑换creator和staker批次
5. 独立兑换holder并fund epoch
6. 领取creator/platform并检查time-gated staker

验收断言：

- 净门槛达标一次毕业；买入fee为meme，卖出为Quote
- 无active70/0/30，active40/30/30按1:3权重；holder只分creator基础一半
- 兑换不再收base/tax；batch输出与item精确守恒；holder与creator互不污染
- 逐asset余额>=totalLiability；真实锁定期未到不冒充staker已领

本地支持选择器：尚无完整直接映射，必须登记覆盖缺口。
