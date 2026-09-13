# 当前合约安全与优化复核

> 后续实施见 [合约优化实施记录](CONTRACT_OPTIMIZATIONS_IMPLEMENTED_2026-09-13.md)。CO-06、CO-08 已确认维持原设计；CO-05 用户选择暂时保留现有退出规则。以下其他发现保留为实施前的审查证据，不表示修复后仍具有相同状态。

日期：2026-09-13。依据当前未提交工作区，HEAD 为 `2ce55ae`；不是仅审查该 commit。生产源码 SHA-256、runtime 大小及测试日志在 [证据目录](evidence/contract-optimization-review-2026-09-13/)。

本轮审查创建／首买、Curve／毕业／v4 Hook、手续费记账与领取、Stock 托管／分配／退出、Holder 快照、资产身份、治理权限和部署产物。新增故障边界测试，未修改生产合约、未部署或广播。后台自动化继续仅保留 TODO。

结论：仍有值得生产前处理的可用性和权限恢复问题。本轮未确认普通用户可直接盗取资金的新增路径；这不代表不存在漏洞，也不是独立第三方审计或生产放行证明。下面的“高”是处理优先级，外部故障、发布者失陷与普通用户攻击有不同前提。

## 优先级

| 编号 | 优先级／性质 | 当前问题 | 建议 |
| --- | --- | --- | --- |
| CO-01 | 高，可用性 | Stake 奖励仍同步依赖于 v4 交易 | 专门设计奖励记账故障隔离 |
| CO-02 | 高，权限恢复 | 快照发布者缺少立即撤销入口，关闭 AccessManager target 也无效 | 增加 Guardian 仅撤销发布资格的入口 |
| CO-03 | 高，信任边界 | Root 正确性完全依赖发布者，错误 Root 无修复入口 | 发布前独立复算、固化数据及限额策略 |
| CO-04 | 高，外部资产故障 | FeeVault 同资产缺口会影响多个市场的收费交易和领取 | 保留偿付检查，建立按资产监控和补足流程 |
| CO-05 | 高，条件性公平风险 | Stock 本金受损后仍先到先得全额退出 | 明确损失分摊政策后再改账本 |
| CO-06 | 中，已接受设计 | 拒收 ETH 的受益合约无法指定其他收款地址 | 已接受由调用者自行决定收款地址的现有边界；不新增 claimTo 入口 |
| CO-07 | 中，资产准入边界 | 通用 Quote 代理升级可能仍通过身份校验 | 明确代理升级信任边界及实现变更监控 |
| CO-08 | 中，已接受设计 | 最后一笔 Curve 买入同时承担完整毕业 | 已接受原子毕业与最后一笔买入同步的设计；保留完整毕业模拟与 Gas 预算验证 |
| CO-09 | 低，Gas | 首买 Router 重复读取 Quote 配置 | 复用同一调用内、外部变更前的配置 |
| CO-10 | 低，Gas | 新 Holder Distributor 支付存在可复用余额读取 | 复用付款后余额，保留最终双资产检查 |
| CO-11 | 低，维护 | Factory 距 runtime 上限仅剩 696 bytes | 后续增改必须带体积 gate |

## CO-01：Stake 奖励仍然可能阻塞交易

调用链：`TickerGardenMemeHookFeeExecution.afterSwap` → FeeVault `finalizeV4Credit` → `_settleV4Attribution` → Gauge `effectiveTotalActiveStock`／`creditStakerFee`。Gauge 又同步读取 AllocationManager／Vault 的历史权重、cohort 并记录累计收益状态。

代码：`contracts/src/v1/shared/TickerGardenMemeHookFeeExecution.sol:52`；`contracts/src/v1/shared/ProtocolFeeVaultV4Accounting.sol:82`；`contracts/src/v1/modules/MemeStockGauge.sol:138,218,276`。

启用 Stake 的市场，即使奖励计算不是交易核心，只要上述调用 revert，整个收费 swap 都会回滚。非 Stake 市场不走同样的 Gauge 分支；普通 ERC20 转账不调用 Gauge。新的真实 PoolManager 测试注入 Gauge 故障，验证 swap 回滚、普通转账成功、Gauge 恢复后 swap 成功。测试替换的是 fixture Registry，**没有证明用户可以替换生产 Gauge 或触发当前 Gauge 的永久故障**。

这与“交易优先于奖励”的要求仍不完全一致。建议把收费到账与复杂 Staker 结算的故障域分开，但不能仅 catch 后继续正常计账：必须保留费用发生时的权重／时间边界、避免新 Stake 获取旧费用、保证补记 exactly-once，并为失败日志和继续交易预留 Gas。读取总权重和费用桶分配本身也在同步链路中，单包住 `creditStakerFee` 不足以完成隔离。该项需要独立方案及回归，不应在审查中直接改分配规则。

## CO-02：发布钱包没有立即撤销通道

`HolderRewardsDistributorV1.setSnapshotPublisher` 拒绝零地址；正常替换受 AccessManager 治理约束，部署计划将该选择器分配给执行延迟 172,800 秒的 `PROTOCOL_ADMIN_ROLE`。`publishSnapshots` 仅检查 `msg.sender == snapshotPublisher`，不查询 AccessManager。

代码：`contracts/src/v1/modules/HolderRewardsDistributorV1.sol:109,197`；`deployments/src/v1/access-manager-plan.ts:14,181`。

因此，普通发布钱包泄露时不能用设零立即撤销；AccessManager 的 `setTargetClosed(distributor,true)` 也不能阻止它继续发布。两点均有新增通过测试。不能把“关闭 target”写成这个合约的应急操作。

建议增加独立的 Guardian 撤销动作，只能使未来 Root 停止发布；由延迟治理恢复／更换发布者。已经发布的合法 Root 仍可领取，不影响代币转账、交易，也不增加管理员提走 Holder 资金或任意改旧 Root 的权限。撤销不能追回已经恶意发布并领取的资金，因此它是缩小应急窗口，不是完整防盗方案。

## CO-03：资金预算有链上约束，持有人名单正确性没有

链上验证市场、轮次、预算、区块身份条件、排除地址和 Merkle 证明；不会验证 Root 中钱包在快照时的 Meme 余额，也不能由一个 Root 自动证明所有叶子金额之和等于预算。

新增测试由合法发布钱包把全部预算分给始终持有零 Meme 的普通地址，该地址可以领取。**这是受信任发布者权限，不是无权限伪造 proof。** 发布者失陷可影响它管理的所有市场的可发布 Holder 预算；FeeVault 归集入口无权限限制，攻击者也可以触发尚未归集的 Holder 费用进入 Distributor。已发布合法轮次的预算、其他角色的费用不能通过这个接口随意改归属。

代码：`contracts/src/v1/modules/HolderRewardsDistributorV1.sol:203–265`；`contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol`。

错误 Root 还可能包含无法领取的叶子，或使预算竞争后到用户失败；Root 不可改且无到期回收，剩余资金可能长久保留在该轮。不要为了修复它贸然增加可覆盖旧 Root 或管理员 sweep 的后门。

保持用户批准的 **FeeVault → Distributor 到账 → 发布快照 → Distributor 领取**。后台 TODO 中的余额独立复算、叶子去重、叶子总额＝预算、排除地址、finality／reorg、proof 持久保存是上线必需工作。未来可评估发布预算上限／短延迟，但这是新增业务政策，不在本轮擅自设定。当前 publisher 地址和链下采样／发布策略仍待提供与确定。

## CO-04：同资产偿付缺口具有跨市场影响

FeeVault 按市场／角色分账，但按资产检查总偿付能力。若某个外部 ERC20 扣减了 Vault 的余额，余额低于该资产总负债，相关领取会失败；新增收费入账也不能自动修复旧缺口，因为对应的新负债同步增加。对使用该收费资产的 v4 swap，失败会传播至交易。

代码：`contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol:157,331,360`；`contracts/src/v1/shared/ProtocolFeeVaultV4Accounting.sol:104`。

新增测试在真实 PoolManager 流程中模拟少 1 个最小单位：swap 和该资产领取失败、普通 Meme 转账成功；无负债补足 1 单位后恢复。已有测试另证实可以单独领取健康 Meme 资产。测试是外部余额损失注入，不是当前 RH 资产已经损失的证据。

保持统一 FeeVault 及分账方案。建议按资产监测余额减总负债、对异常资产告警、准备无新增负债的补足与复核流程。不能取消偿付检查，让先领取的人把缺口留给其他角色；批量归集的失败隔离也不等于修复了资不抵债。

## CO-05：Stock 受损后的退出公平性仍未解决

现有存款本金缺口检查已经阻止新资金承担旧缺口，但 `_withdrawFreeStockUnchecked` 仍按账面数量全额转出，只要实物足够就成功。若多位用户的总账面本金大于实际余额，先退出者可能足额领取，后退出者承担集中损失。

代码：`contracts/src/v1/shared/UserStockVaultDeposits.sol:35`；`contracts/src/v1/shared/UserStockVaultExits.sol:35`。回归：`StockVaultCustodyBoundary.t.sol:testAudit_deficitDoesNotBlockRemainingFreePrincipalOrRageQuit`。

这是资产发生外部扣减时的政策缺口，不应宣称常规存取可以制造损失。若要改为按比例退出，须同时处理已有 allocation、损失后的补足、舍入和后续资产恢复；单纯冻结所有提现也违背本金优先退出。应先明确分摊／恢复规则再实现，不建议作为小补丁顺手修改。

## CO-06：由受益人决定的收款地址（已接受设计）

当前用户奖励和 Holder 快照将资产支付给调用者；不接受 ETH 的智能合约账户无法把应得 ETH 重定向至其他地址。Creator 换受益人只影响新 epoch，不能改变旧 epoch 的权益，因此不能救回旧领取兼容问题。

证据：`contracts/test/v1/audit/FeeClaimSafetyBoundary.t.sol:117`；`contracts/src/v1/modules/HolderRewardsDistributorV1.sol:263`。

本项作为有意的领取边界接受：权益归属于受益人，领取支付给调用者；不新增 `claimTo` 或签名代领入口。原生首买退款也有拒收兼容性，但当前失败会整体回滚创建／买入，不会留下半笔首买。

## CO-07：通用 Quote 代理升级未被外壳 codehash 捕获

`ApprovedQuoteRegistry` 的通用 ERC20 分支检查 codehash 和 decimals。ERC1967 代理实现升级时，代理自己的 runtime 和 decimals 可以不变，因此仍返回 `quoteIdentityCurrent=true`。

代码：`contracts/src/v1/modules/ApprovedQuoteRegistry.sol:191–219`。新增测试通过有权限的管理员升级合成代理，确认实现行为从 1 变为 2 而身份检查仍通过。**没有据此断言当前 USDG 使用该结构或已经发生升级。** Stock Quote 有单独绑定与指纹校验，不能把本项泛化为 Stock 身份检查完全无效。

建议每个通用 Quote 的准入档案明确不可升级／代理类型、实现、管理员和升级延迟；可验证的代理依赖可加入对应校验，其他类型由链下监测实现变更。不能假定合约可直接读取另一个代理的任意 ERC1967 存储槽。资产冻结、黑名单和非精确转账风险仍需独立评估。已有市场不受新资产准入状态的任意冻结控制，监测告警也不是停止已有交易的保证。

## CO-08：毕业是最后一笔买入的同步依赖（已接受设计）

Curve 可售库存耗尽时，同一笔交易完成费用扫入 FeeVault、资金交 Executor、LP 初始化／铸造、Locker 托管和 Registry 激活。任一环节失败，整笔最后买入回滚。

代码：`contracts/src/v1/modules/TickerGardenCurve.sol:130,265`；`contracts/src/v1/shared/GraduationExecutorEntry.sol:25`。现有 Curve／GraduationExecutor 测试覆盖下游失败及后期激活失败全回滚。

原子回滚保护资金一致性，本身不是盗币漏洞。本项作为有意的原子毕业设计接受；继续要求最后买入的完整毕业模拟和真实资产 Gas 预算，不提出拆分为独立毕业状态机的修复建议。

## CO-09～11：小范围 Gas 与维护优化

- **Router 重复配置读取：** `LaunchAndBuyRouter.sol:19` 读取配置用于分支，Native `:119`／ERC20 `:68` 再次读取。可将首次结果传入内部函数；此区间尚无会修改状态的外部调用。Factory 在资产转入等外部操作后进行的独立校验仍应保留。尚未测量收益，不宣称可节省某个百分比。
- **Distributor 余额复用：** `HolderRewardsDistributorV1.sol:279–300` 的 ERC20 `_pay` 付款前偿付检查、前余额、后余额、付款后偿付检查，加上外层最终检查，同一支付会读 Distributor 余额五次。可复用精确转账校验中的后余额完成局部偿付检查；外层在另一资产回调后的最终检查必须保留。FeeVault 已有对应复用，不能把旧 FeeVault 五次读取问题重新当成未修复项。
- **Factory 体积：** 当前编译 runtime 为 23,880 bytes，距 24,576 bytes 上限仅 696 bytes；FeeVault 20,580，Distributor 11,551。后续加功能应先评估可安全拆出的代码和部署字节码变化，保留体积 gate；不能用任意可升级 delegatecall 换空间。

## 仍需明确的业务政策

- Stake 的 30 秒激活、24 小时锁定仍在 `AllocationManagerIncreases.sol:22`；追加会更新整仓解锁时间，正常退出为整仓。最低值检查追加后的总仓位，不是要求每次追加都超过最低值。这些是 Staker 规则，不能与已删除的 Holder 24 小时释放混淆。
- 开盘前 5 秒反狙击规则和 Creator／初始受益人豁免仍在 `TickerGardenAntiSnipe.sol`，后者不仅适用于首买。属于经济政策，应确认说明和预览，不在本轮自动改税率。
- 40% 虚拟储备的毕业分配包含永久锁定的未配对 Meme。保留已批准经济配置，不因“优化”改为可由管理员取走。

## 已解决或应继续保留的边界

- Holder ERC20 转账同步回调、固定释放周期已移除；旧业务审查 BD-05／BD-06 不再描述当前实现。
- Stock Vault 注册时字节码扫描、后续 codehash／依赖校验已经实施；不再使用旧的每次存款约 335 万 Gas 扫描结论。
- 合约内外部兑换／SwapRouter／Quoter 耦合已移除；直接原资产领取不再依赖兑换成功。
- Holder 批量归集固定入口、单资产子调用回滚、Gas 预留、有界返回数据和续跑游标保留。批次尝试完成不等于每项成功，后台仍须读取结果事件。
- Creator 历史 epoch 权益、Holder 市场／轮次预算、领取资产 mask、重入保护、精确资产差额及最终偿付检查应继续保留。
- Stock 正常退出与应急本金退出分开；应急奖励清理不应再重新变成本金转出的强制条件。

## 验证与生产边界

新增 `contracts/test/v1/audit/CurrentContractOptimizationBoundary.t.sol` 的 6 个专项测试全部通过，覆盖 Gauge 故障传播、FeeVault 缺口传播及恢复、发布者零余额分配、无法零地址撤销、AccessManager 关闭不影响发布、通用代理升级身份边界。前两项是故障注入，后三项发布者测试涉及受信任权限，不能统称 6 个可利用漏洞。

完整非 Fork 回归：87 suites、925 passed、0 failed、0 skipped，见 `contracts.log`。其中本轮新增 6 个专项场景；新测试类还继承并重跑 26 个已有场景，因此相对前轮 893 不能表述为新增 32 个独立场景。Python spec／当前接口 66 项、部署配置／权限 66 项通过。fixture、接口生成、product artifact、compiled manifest 和 V1 boundary 检查通过。命令见证据目录验证摘要。

本轮未重新执行 RH 真实 Fork。上一轮公共 RPC 缺少历史状态的阻塞记录仍在 [Holder 快照审查](HOLDER_WALLET_SNAPSHOT_CONTRACT_REVIEW_2026-09-13.md)，本轮没有证据将其解除。生产前还须提供发布钱包、完成后台 TODO、重新生成当前字节码部署计划、真实 Fork／逐资产模拟及端到端领取验收。本轮不能标记为生产可部署。
