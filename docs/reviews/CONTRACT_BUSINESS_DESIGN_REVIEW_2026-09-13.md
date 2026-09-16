# 合约业务与功能设计复核

> 后续版本说明：Holder 已改为钱包余额快照，本报告 BD-05／BD-06 已被后续实现取代，不再描述当前合约。最新复核见 [当前合约安全与优化](CONTRACT_OPTIMIZATION_REVIEW_2026-09-13.md)。下文保留为当时版本的审查记录。

日期：2026-09-13。代码基线：`2ce55ae`。本轮为源码、调用链和针对性测试复核，未修改合约、未部署、未重新执行主网 Fork。

## 结论与范围

本轮列出 8 项需要改进或明确接受的设计。其中，受损资产的退出公平性值得在生产前优先处理；毕业的原子同步和领取地址边界已按产品意图接受。其余涉及持币奖励、追加质押和代币经济的取舍。**这些发现不能全部归类为可被攻击者直接利用的漏洞。** 外部资产余额损失和 Holder 记账故障分别有额外触发前提，不能据此声称当前 RH 资产正在发生损失或当前代币已无法转账。

本报告依据当前链上实现，不把旧的合约内兑换、SwapRouter／Quoter 注册方式作为现存问题。也不把普通界面数据移回 RPC：数据库负责展示和索引，合约继续负责可验证的余额、权益与支付。

业务优先级含义：高＝生产前应解决或明确接受；中＝影响用户体验、经济政策或维护成本；确认项＝数学或产品承诺需明确，不表示应改公式。以下不属于外部独立安全审计或生产放行结论。

| 编号 | 优先级 | 发现 | 证据性质 |
| --- | --- | --- | --- |
| BD-01 | 高，已接受设计 | 最后一笔 Curve 买入同时承担完整毕业，毕业失败会回滚买入 | 源码调用链＋毕业回滚测试；按产品意图保留原子同步 |
| BD-02 | 高，条件性 | Stock 本金缺口时仍全额先到先得退出，损失集中到后退出者 | 已有本地余额损失测试复现 |
| BD-03 | 高，已接受设计 | 奖励只能支付给调用者，不接受 ETH 的受益合约无法改收款地址 | 已有本地测试复现；按产品意图保留调用者收款边界 |
| BD-04 | 中 | 追加 Stake 重锁整仓及旧奖励，正常退出只支持整仓 | 源码＋激活及整仓退出测试 |
| BD-05 | 中，结构性 | ERC20 转账同步依赖 Holder 记账，缺少故障后的迁移路径 | 源码；未发现现成可利用的记账故障 |
| BD-06 | 中 | Holder 待释放资金需交易触发才能启动，24 小时并非从费用产生时计算 | 源码＋资金批次测试 |
| BD-07 | 中，政策 | 开盘惩罚税很高，Creator／初始受益人豁免不只限于首买 | 源码＋反狙击测试 |
| BD-08 | 确认项 | 40% 虚拟储备比例带来约 8.16% 总供应量的永久未配对锁定 | 公式推导＋毕业资产分配源码 |

## BD-01：毕业负担集中在最后一笔买入（已接受设计）

`TickerGardenCurve.buy` 在可售库存耗尽时，直接调用 `_finalizeLaunch()`。后者先结清 Curve 手续费，再转移毕业资产，调用 Executor 完成 Pool 初始化、LP 铸造、Locker 托管和市场状态激活。任一环节失败，最后一笔买入整体回滚。

代码：`contracts/src/v1/modules/TickerGardenCurve.sol:130–172,265–295`；`contracts/src/v1/shared/GraduationExecutorEntry.sol:25–65`；`contracts/src/v1/shared/GraduationExecutorPoolExecution.sol:154–211`。

不合理之处是普通买入用户承担额外毕业 Gas 和毕业依赖的可用性风险。即使买入金额和滑点都合法，LP 或手续费结算失败仍会阻止其成交。目前没有独立的公开毕业重试入口；依赖恢复后，需要重新发起完成 Curve 的买入。不能将此概括成“所有普通买卖都一定停止”。

**接受状态：**按产品意图保留最后一笔买入同步触发完整毕业及失败整体回滚。继续要求完整毕业模拟、独立 Gas 预算和后端失败告警；不再建议引入独立 `ReadyToGraduate` 状态或拆分毕业流程。

验收应覆盖：最后一笔买入、LP 初始化失败、手续费资产异常、重复毕业、失败后重试、长期无人执行、毕业过程资产与状态一致性。已有晚期激活失败回滚测试证明回滚边界，而非证明拆分方案已实现。

## BD-02：受损 Stock 资产的损失分配仍没有解决

新存款前检查 `balance >= totalDeposited` 的修复有效；当前退出路径仍按用户账面本金精确支付，没有把资产缺口分摊给所有存款人。

代码：`contracts/src/v1/shared/UserStockVaultDeposits.sol:25–48`；`contracts/src/v1/shared/UserStockVaultExits.sol:35–62`。

现有测试 `testAudit_deficitDoesNotBlockRemainingFreePrincipalOrRageQuit` 的具体结果：Alice 存 200、Bob 存 100，Vault 外部余额从 300 降为 250；Alice 正常提取及 rageQuit 共拿回 200，Bob 账面仍为 100，但 Vault 仅剩 50。新存款保护不等于旧用户公平承担损失。

这延续了“尽量不阻止剩余本金退出”的既有策略，不是本轮发现新存款保护失效。触发前提是外部扣减、负向 rebase 等造成资产余额不足；正常不扣减的资产不会凭空触发该场景。

**建议：**生产前明确受损资产政策。若继续保证剩余本金随时可退出，应明确接受先到先得，并建立逐资产监测与补足响应。若目标是公平分摊，需要单独设计逐资产 impairment 状态和按比例偿付／恢复机制；不能只在所有提款前增加“必须完全偿付”的检查，因为那会冻结所有人的剩余本金。单纯换成 shares 也无法解决发行方冻结转账等问题。

验收应覆盖：多人退出顺序、部分亏损、补足、仅一个资产受损、锁定仓位与 rageQuit、无新用户承担旧缺口；任何损失分配变更都需要作为经济规则单独确认。

## BD-03：领取入口缺少用户指定收款地址的能力（已接受设计）

当前 Raw Claim 已正确去掉兑换。领取资格用 `msg.sender` 判断，但最终支付也固定为 `msg.sender`，没有 `recipient` 参数。

代码：`contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol:42–74,84–103`。

对于没有 ETH 接收能力、且不能升级的合约钱包，ETH 支付会回滚。将 Creator 转给新受益人也不能领取旧 epoch 的 ETH，因为历史权益仍属于旧地址。已有 `testAudit_nativeRejectingBeneficiaryCannotRedirectOldEpoch` 复现，选取 Meme 单资产领取仍然可用。

**接受状态：**按产品意图保留权益归属和支付对象均为调用者的边界，不新增用户指定收款地址的 `claim…To(..., recipient)` 入口。兑换继续留给外部钱包操作，不重新引入合约路由或任意执行器。

记录边界时应覆盖：旧 epoch 归属、非 payable 调用者、原生资产拒收、重入、单资产领取、失败时权益恢复和最终偿付检查。合约完全无法主动发出领取调用时，现有领取入口无法替其完成调用；该限制属于已接受设计边界。

## BD-04：追加质押的影响超过追加部分

每次增加仓位都会将 `position.unlockAt` 重置为当前时间加 24 小时。已有 pending 会与新金额合并，并重置其 30 秒激活时间；已经激活的仓位仍继续计权，但也使用新的整仓解锁时间。领取奖励检查相同的解锁时间。正常退出移除全部 active 仓位，没有指定部分数量的接口。

代码：`contracts/src/v1/shared/MemeStockGaugePendingPositions.sol:30–84`；`contracts/src/v1/shared/MemeStockGaugeLockedPositions.sol:20–38`；`contracts/src/v1/modules/MemeStockGauge.sol:160–170`；`contracts/src/v1/shared/AllocationManagerIncreases.sol`。

例如：已经到期的 100 个 Stake，追加很小数量后，旧本金和旧的未领取奖励也重新受 24 小时限制。最低数量约束检查的是追加后的总仓位，因此达到门槛后的小额追加同样触发整仓重锁。操作由用户主动执行，没有证明第三人可以替用户强行重锁。

**建议：**最低成本方案是把“追加将重锁整仓及奖励”作为交易前的明确预览。更合理但需要改账本的方案是分批到期，或分离“已赚奖励可领时间”和新增本金锁定；部分退出也可评估，但须规定剩余仓位低于最低值时的处理。不要仅改一个时间字段，造成新资金绕过锁定或重复计权。

已有测试覆盖 pending 重排、成熟处理、整仓到期退出和退出后奖励保留；它们验证了当前行为，不代表用户已经理解这一行为。

## BD-05：Holder 奖励是整个代币的同步可用性依赖

`TickerMemeTokenV1._update` 在奖励启用后，每次余额变化都先调用固定 Distributor 的 `checkpointTransfer`，再更新 ERC20 余额。Distributor 地址不可变、奖励只能启用一次，没有迁移或停用入口。

代码：`contracts/src/v1/modules/TickerMemeTokenV1.sol:9–35`；`contracts/src/v1/modules/HolderRewardsDistributorV1.sol:206–238,465–474`。

如果该市场的记账进入无法处理的状态，或集成方给转账预留的 Gas 不足，代币转账及依赖转账的买卖也会失败。当前流数量有上限，已有 24 批次过期后的有界工作量测试通过；本轮没有找到能让攻击者任意制造永久故障的现成路径。因此本项是架构风险与可组合性约束，不是已证实的拒绝服务漏洞。

**建议：**首先把高负载转账、零额／自转账、双资产、长期无交易和所有奖励状态切换作为代币核心验收，明确支持的转账 Gas。若要求生产后具备纠错能力，必须预先设计安全的版本迁移和旧权益保留；不能简单 catch 后忽略 checkpoint，否则余额转移和奖励权重脱节，可能重复领取。用户权益也不应交由前端数据库决定。

## BD-06：Holder 的 24 小时释放不包含所有排队时间

资金可先进入 `idle`。默认批次准入间隔为 4 小时，但到期不会自动产生链上交易；实际调用 `_restartIdle` 时，才把结束时间设为当前时间加 24 小时。触发来自入金、转账、领取或公开 `checkpoint`。

代码：`contracts/src/v1/modules/HolderRewardsDistributorV1.sol:344–350,477–504`。

例子：一个流在 T0 开始，T0+1h 新增费用排队。它最早 T0+4h 可入新流；若此后没有触发，直到 T0+10h 才 checkpoint，新资金释放到 T0+34h，而非 T0+28h。既有流不会因此整体延长；本项讨论排队资金。零合格供应时还会继续等待。

**建议：**先明确产品承诺。如果保留现有机制，后端按 `nextStreamStartAt` 定时调用已有公开 checkpoint，展示“待启动／释放中／可领取”，并监控执行失败；数据库更新本身无法推进链上奖励。如果要求无需 keeper 也按固定时刻开始，需要修改准入会计，使后续调用能正确追溯计划时间，而不是仅修改展示时间。本轮只验证源码机制与现有批次测试，未进行线上 keeper 可用性测试。

## BD-07：反狙击政策与公平开盘存在张力

开盘前 5 秒的 raw 惩罚税依次为 99%、24.75%、3.09%、0.19%、0.01%；实际税还受基本费、Creator Tax 和至少 1% 净投入约束。Creator 与创建时受益地址直接豁免，和“认证 Router 原子首买”的豁免是不同分支：前者可在窗口内多次使用，并非只有首笔。

代码：`contracts/src/v1/libraries/TickerGardenAntiSnipe.sol:9–19,46–78`；`contracts/src/v1/modules/TickerGardenCurve.sol:369–398`。

这会导致同一早期窗口内普通买家和 Creator 的交易成本差异很大。不能宣称它天然保证公平启动，也不能把 raw 99% 当作所有交易精确收取的最终比例。

**建议：**若目标只保护一次创建首买，收窄至经过认证的原子首买豁免；否则保留规则但明确披露 Creator／初始受益人的窗口豁免。交易签名前必须显示当前执行条件下的实际扣费与最少得到数量。税表和豁免属于经济规则，不能借优化名义直接改掉。

## BD-08：永久锁定的未配对资产不是少量 dust

设总供应量为 S，毕业阈值为 G，虚拟储备 V=0.4G。忽略最小单位舍入：

- Curve 可售：`S × G/(V+G) = 5/7 S ≈ 71.4286%`。
- 毕业时剩余 Meme：`S × V/(V+G) = 2/7 S ≈ 28.5714%`。
- 计划投入 LP 的 Meme：`(2/7 S) × G/(G+V) = 10/49 S ≈ 20.4082%`。
- 未配对永久锁定 Meme：`2/7 S − 10/49 S = 4/49 S ≈ 8.1633%`。

代码：`contracts/src/v1/libraries/TickerGardenSupplyMath.sol:30–74`；`contracts/src/v1/shared/GraduationExecutorAssetAccounting.sol:111–143`；`contracts/src/v1/shared/GraduationExecutorPoolExecution.sol:198–211`；`contracts/src/v1/shared/LaunchLockerCustody.sol:9–12,48–51`。

这是 LP 初始价格与 Curve 终点衔接的公式结果。最终 LP 铸造的单位／价格舍入还可能产生额外未配对余量。Locker 没有取款、转移 LP 或管理救援入口，不能日后把这些资产拿来当运营资金。

**建议：**保留价格连续性；在 tokenomics 中明确“Curve 售出、LP 配对、永久未配对锁定”三项。后台供应量统计应区分总供应、流通量与锁定量，不能把 8.16% 描述成可随时回收的零头。若希望这部分进入流通，需要重新设计供应分配与毕业定价，不能直接把全部剩余 Meme 加进原 LP。

## 其他业务链路的判断

| 链路 | 当前设计判断／保留边界 |
| --- | --- |
| 创建／首买 | 协议只接收已准备的 Quote 执行创建和首买，外部兑换不应回到核心合约。创建签名、nonce、接收方及精确收款仍是必要检查。 |
| 外部交易服务 | SwapRouter／Quoter 已移出 MarketRegistry；实际承载池资产的 PoolManager、PositionManager、Hook 绑定仍是结算边界，不能等同普通链下服务而删除校验。 |
| Quote 经济配置 | 已创建市场使用固定配置有助于防止管理员事后改价。新增版本改变未来市场，旧市场不追随修改，是合理边界。 |
| 196 种 Quote | 7000 USD 等值 Stock 数量是配置时参考值，之后不随股票价格自动变动。ETH 3 ETH 也是独立已批准规则。无需为维持界面美元估值而加入链上价格 oracle。 |
| 194 种 Stake | 0.5 是各资产最低总数量，不是统一美元价值；追加后总仓位满足即可。资产价格差异属于已批准政策，不应误报为计算错误。 |
| 资产准入 | 存款 codehash／依赖绑定／精确余额变化约束应保留；外部发行方暂停、升级、冻结仍是业务信任边界。注册时审查不能保证未来永不变化。 |
| Creator 转移 | 两步接收、历史 epoch 不变、转移前结清旧费用有助于防止历史收益归属被改写；领取支付对象边界按已接受设计保留。 |
| 费用分配 | 当前 LP 份额为 0；有活跃 Stake 时 Creator 40%、Staker 30%、平台 30%，无活跃 Stake 时未分给 Staker 的份额归 Creator。Curve 常规分桶为 Creator 70%、平台 30%。不能引用旧 LP 份额来声称 Locker 正在积累可领取 LP 手续费。 |
| Raw Claim | 按原资产领取、可选单资产是正确简化；无需恢复兑换失败 fallback。单个 FeeVault 内相同资产的偿付风险共享，资产异常可跨该资产的多个市场影响领取；选取另一资产可隔离部分影响。 |
| 正常退出／rageQuit | 正常退出保留收益，rageQuit 以本金优先并放弃未领取收益，两者不应合并；奖励结算故障不应重新成为应急本金退出的强依赖。 |
| Treasury | 延迟提案、新 Treasury 接收、Guardian 取消比永久写死收款地址合理；不应给管理员增加可任意搬走用户本金的紧急提款。 |
| 治理／恢复 | 暂停与延迟恢复分权是合理约束。资产准入暂停不应自动剥夺旧用户退出权。不同延迟是否重叠须按具体调用时序判断，不能把所有延迟简单累加。 |

## 验证与交付边界

本轮命令：

```sh
node tools/run-forge.mjs test --match-path 'test/v1/{audit/{StockVaultCustodyBoundary,FeeClaimSafetyBoundary},shared/{MemeStockGaugePendingPositions,MemeStockGaugeLockedPositions,TickerGardenAntiSnipe,GraduationExecutorPoolExecution,TickerGardenMemeHookLifecycle},treasury/product/HolderFundingInterval}.t.sol' -vv
```

结果：**8 个套件，121 项通过，0 失败，0 跳过**。包括所选套件继承的基础测试，并非本轮新增 121 项用例。日志：`docs/reviews/evidence/contract-business-design-2026-09-13/focused-tests.log`。

关键复现包括 `testAudit_deficitDoesNotBlockRemainingFreePrincipalOrRageQuit`、`testAudit_nativeRejectingBeneficiaryCannotRedirectOldEpoch`、`test_crossSecondIncreaseMovesOldBucketAndResetsBothTimers`、`test_exactUnlockMaterializesSettlesAndRemovesTheFullPosition`、`test_lateActivationFailureRollsBackLockerNftLiquidityDustAndBindings`、`test_atomicGraduationFailureRollsBackRegisterInitializeAndActivate`。

源码与现有测试支持上述现状判断；所有建议均未实施或验证。没有重新跑全仓测试、主网 Fork、实时资产核验或桌面／移动端验收，本轮也没有产生新的 Gas 性能测量。既有工作区的前后端改动未纳入本报告的完成范围。

建议先明确 BD-02 的损失政策；BD-04、BD-07 涉及锁定与经济承诺；BD-05、BD-06 应分别安排极端状态验证与链上任务运行保障；BD-08 优先补齐公开 tokenomics。BD-01 与 BD-03 按已接受设计保留。报告不改变当前 `NOT_PRODUCTION_READY / NOT_BROADCAST` 边界。
