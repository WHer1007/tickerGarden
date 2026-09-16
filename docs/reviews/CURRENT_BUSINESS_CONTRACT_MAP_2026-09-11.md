# 当前业务链路—合约代码关系表

核对日期：2026-09-11。范围：当前工作树 `contracts/src/v1`，包括模块继承的 `shared` 实现；文件名中的 V1 不表示保留旧业务。本文用于查缺补漏，不是新一轮安全审计结论，也不是链上部署证明。

当前有 18 个核心模块和 1 个 Holder 奖励扩展。以下“已实现”仅表示源码存在相应路径。已有本地验证见[清理复审](CURRENT_CONTRACT_CLEANUP_AUDIT_2026-09-11.md)；当前版本的真实 Fork 执行、新 release 部署及前后端全链路验收仍待完成。本次仅核对源码和测试索引，未请求 RPC、未重新运行测试、未广播交易。

## 1. 创建、交易与毕业

| 编号 / 业务 | 触发者与入口 | 主要代码关系 | 查漏检查点 / 当前边界 |
| --- | --- | --- | --- |
| L01 Stock 白名单 | 治理：`registerAsset`、`setMinimumAllocation`、资产状态与身份更新 | [OfficialStockRegistryV1](../../contracts/src/v1/modules/OfficialStockRegistryV1.sol) → Stock 身份、地址、精度、共享 Vault、最低仓位 | 已实现链上准入。Logo 属于链下资料。发行方暂停、拉黑、升级的外部风险不会被本项目的退出函数消除。 |
| L02 Quote 与发行配置 | 治理注册配置；前端调用 `resolve` / `previewMarketEconomics` | [ApprovedQuoteRegistry](../../contracts/src/v1/modules/ApprovedQuoteRegistry.sol)、[BaselineRegistry](../../contracts/src/v1/modules/TickerGardenBaselineRegistry.sol)、[TemplateRegistry](../../contracts/src/v1/modules/LaunchTemplateRegistry.sol) → [Resolver](../../contracts/src/v1/modules/LaunchConfigResolver.sol) → Factory 验证 | 已实现。Quote 与质押 Stock 是不同配置维度；毕业金额、Anti-snipe、供应量来自选中的配置，不能把测试环境值当主网值。 |
| L03 图片、网站、X、描述公开 | 创建页面 → 元数据服务 → IPFS/公开 URI → 创建参数 | [metadata.ts](../../apps/web/src/create/metadata.ts) → [TickerMemeTokenV1.metadataURI](../../contracts/src/v1/modules/TickerMemeTokenV1.sol) | Token 保存 URI，不逐项保存图片、网站和 X。IPFS 发布、资料包、浏览器/行情平台收录属于链下链路；后两者不会因写入 URI 自动完成。 |
| L04 创建市场、发行固定总量 | 用户：`createMarket`；官方首买 Router：`createMarketFor` | [Factory](../../contracts/src/v1/modules/TickerGardenFactoryV1.sol) → Token、Curve、可选 Gauge → [MarketRegistry](../../contracts/src/v1/modules/MarketRegistryV1.sol)、[CreatorRevenueRegistry](../../contracts/src/v1/modules/CreatorRevenueRegistry.sol)、可选 Holder 注册 | 已实现原子部署及身份绑定。Token 固定发行量，无管理员增发/税率修改/元数据修改入口。交易成功回执与详情索引可读是两个前端状态。 |
| L05 原子首买 / Developer buy | 用户：`launchAndBuy` | [LaunchAndBuyRouter](../../contracts/src/v1/modules/LaunchAndBuyRouter.sol) → Native / ERC20 / Native 换 Quote 分支 → Factory → Curve，必要时进入毕业后池路径 | 已实现原子创建与买入；多余款项、授权和失败回滚需联调。Native 购买 ERC20 Quote 依赖真实可用的外部池，不能理解为任意 Stock 都可自动购得。 |
| L06 Growing 报价与买卖 | 用户：`quoteBuy` / `quoteSell`、`buy` / `sell` | [TickerGardenCurve](../../contracts/src/v1/modules/TickerGardenCurve.sol) → Curve 数学、Anti-snipe、精确资产转账、储备更新、`CurveBuy` / `CurveSell` | 已实现。普通 Curve 买卖接口仍有调用者传入的 `minTokensOut` / `minQuoteOut`；这与已删除的“奖励兑换预设最低到账”不是同一接口。 |
| L07 Growing 手续费归集 | 任意调用者：`sweepCurveFees`；毕业和创作者收益权交接也会归集 | [Curve](../../contracts/src/v1/modules/TickerGardenCurve.sol) → [CurveCredit](../../contracts/src/v1/shared/ProtocolFeeVaultCurveCredit.sol) → FeeVault liabilities | 已实现，但不是每笔 Curve 买卖都立即入 FeeVault。归集前费用仍在 Curve；统一 Claim 不会自动调用 sweep。后台/前端须处理“已产生、未归集、可领取”的区别。 |
| L08 达到毕业条件 | 最后一笔 Curve 买入内部触发 `_finalizeLaunch` | Curve → [GraduationExecutorEntry](../../contracts/src/v1/shared/GraduationExecutorEntry.sol) → [AssetAccounting](../../contracts/src/v1/shared/GraduationExecutorAssetAccounting.sol) / [PoolExecution](../../contracts/src/v1/shared/GraduationExecutorPoolExecution.sol) → v4 PoolManager / PositionManager → Locker / Hook / Registry | 已实现。整笔原子成功或回滚；不存在持久化“毕业处理中”状态或独立重试毕业入口。前端应按回执和 `launchPhase` 从 Growing 翻转 Bloomed。 |
| L09 LP 永久锁定 | GraduationExecutor 创建并绑定 Locker | [LaunchLocker](../../contracts/src/v1/modules/LaunchLocker.sol) → [Binding](../../contracts/src/v1/shared/LaunchLockerBinding.sol) / [Custody](../../contracts/src/v1/shared/LaunchLockerCustody.sol) | 已实现永久全范围仓位及剩余资产隔离。没有 LP 提取、手续费领取或复投入口；不要设计相应按钮。 |
| L10 Bloomed 买卖及收费 | 用户经交易路由调用外部 PoolManager；PoolManager 回调 `afterSwap` | [TickerGardenMemeHook](../../contracts/src/v1/modules/TickerGardenMemeHook.sol) → [FeeExecution](../../contracts/src/v1/shared/TickerGardenMemeHookFeeExecution.sol) → [V4Credit](../../contracts/src/v1/shared/ProtocolFeeVaultV4Credit.sol) → [V4Accounting](../../contracts/src/v1/shared/ProtocolFeeVaultV4Accounting.sol) | 已实现 canonical pool 来源、精确到账、feeId/nonce 防重复记账。LP fee 必须为 0；外部 PoolManager 协议费允许另收，不进入本项目分成基数。 |

## 2. Stock 本金、仓位与退出

| 编号 / 业务 | 触发者与入口 | 主要代码关系 | 查漏检查点 / 当前边界 |
| --- | --- | --- | --- |
| S01 钱包存入 / 空闲本金提取 | 用户：`depositStock` / `withdrawFreeStock` | [UserStockVault](../../contracts/src/v1/modules/UserStockVault.sol) → Deposits / Ledger / Exits | 已实现钱包余额与 Vault 空闲余额分离。本金账本按 Asset UID、用户、市场隔离；不是 ERC20 质押凭证或 NFT。 |
| S02 新增 / 追加质押 | 用户：`stake` / `depositAndAllocate`，或使用 Vault 空闲余额 `allocate` / `increaseAllocation` | [AllocationManager](../../contracts/src/v1/modules/AllocationManager.sol) → [Deposits](../../contracts/src/v1/shared/AllocationManagerDeposits.sol) / [Increases](../../contracts/src/v1/shared/AllocationManagerIncreases.sol) → Vault 锁本金 → Gauge 记 pending 仓位 | 已实现，**仅 PoolCreated/Bloomed 且开启 staking 的市场允许新增**。校验 Stock ACTIVE、身份和最低仓位。Growing 页面展示区不等于可以提前质押。 |
| S03 激活、占比、锁定 | 交易/仓位操作检查点；任意人 `checkpointActivations` | [MemeStockGauge](../../contracts/src/v1/modules/MemeStockGauge.sol) → Activation / Accumulators / LockedPositions；Vault 保存有效权重边界 | 30 秒后激活；全仓锁 24 小时，追加重设全仓解锁时间。分成使用有效 active 权重，不直接用含 pending 的总本金；页面应区分本金占比与有效奖励占比。 |
| S04 正常全额退出 | 用户：`unstakeAndWithdraw` 或 `closeAllocation`，后者再 `withdrawFreeStock` | [AllocationManagerExits](../../contracts/src/v1/shared/AllocationManagerExits.sol) → Gauge 结算并移除仓位 → Vault 释放本金 | 已实现到期全额退出。第一条返回钱包，第二条变为 Vault 空闲本金；退出本金与领取收益是不同动作。目前没有指定数量的部分减仓入口。 |
| S05 提前退出、放弃收益 | 用户：Manager `rageQuit` 或 Vault `rageQuit`；任意人补做 `settleRageQuitRewards` / `flushDeferredForfeiture` | [Vault](../../contracts/src/v1/modules/UserStockVault.sol) → 本金先退和收益截止标记；[ManagerExits](../../contracts/src/v1/shared/AllocationManagerExits.sol) / [Gauge](../../contracts/src/v1/modules/MemeStockGauge.sol) → FeeVault 罚没储备 | 已实现本金退出与奖励清理解耦，罚没不分给其他质押者。不能把它当作普通 Withdraw。第三方 Stock 自身拒绝转账时仍无法保证本金转出。 |

## 3. 手续费分配与领取

| 编号 / 业务 | 触发者与入口 | 主要代码关系 | 查漏检查点 / 当前边界 |
| --- | --- | --- | --- |
| R01 本项目手续费拆分 | Curve 归集 / Hook 交易入账 | [MarketFeeAccounting](../../contracts/src/v1/libraries/MarketFeeAccounting.sol) → [FeeVaultLiabilities](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol) → Creator / Staker / Holder / Platform 账本 | 按每种实际收费资产分别记账。Growing 基础份额 Creator 70%、Platform 30%；Bloomed 有有效 Staker 时 40% / 30% / 30%，无有效 Staker 时 Creator 70%、Platform 30%。有整数舍入。 |
| R02 Creator tax 与 Holder 开关 | 创建时固定配置；新费用入账时应用 | FeeVault `_creditTradingFeeLiabilities` | 开启 Holder 分成时，仅将 Creator **基础手续费份额的一半**转给 Holder；Creator tax 仍归 Creator。不得把 Creator tax 或 PoolManager 外部协议费再次按基础份额拆分。 |
| R03 Creator 收益归属及转让 | 当前收益人提出转让，新收益人 `acceptCreatorRevenueBeneficiary` | [CreatorRevenueRegistry](../../contracts/src/v1/modules/CreatorRevenueRegistry.sol) → Growing 先 sweep → 新 beneficiary epoch；FeeVault 按 epoch 隔离收益 | 已实现双步骤交接。旧 epoch 收益仍属于旧收益人；Creator 页仅按 token.creator 搜索不能完整表示受让人的当前收益权。 |
| R04 Staker 收益累积 | FeeVault 入账调用 Gauge `creditStakerFee` | [MemeStockGauge](../../contracts/src/v1/modules/MemeStockGauge.sol) → Accumulators / Settlements → 用户 Quote、Meme 权益 | 已实现按有效权重双资产累计。领取仍检查质押锁和退出清算状态；不能承诺“原币立即领取”取消质押锁。 |
| R05 Holder 费用注入 | 任意人调用 FeeVault `fundHolderRewards(id,1)` / `fundHolderMemeRewards(id)` | [FeeVaultLiabilities](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol)、[UserClaims](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) → [HolderRewardsDistributorV1](../../contracts/src/v1/modules/HolderRewardsDistributorV1.sol) | FeeVault 外层入口 permissionless，但接收合约只接受已绑定 FeeVault；不存在任意人向 Distributor 开新释放流的公共注资入口。官方金额阈值和每 4 小时检查由 worker 执行，不是链上定时器。 |
| R06 Holder 权重、排队与释放 | 注入、token 转账前检查点、领取或 `checkpoint` | [TickerMemeTokenV1._update](../../contracts/src/v1/modules/TickerMemeTokenV1.sol) → Holder `checkpointTransfer`；Holder `_restartIdle` / `_checkpoint` / `claimableAssets` | Quote/Meme 独立按有效持币权重释放 24 小时；批次间隔默认 4 小时，治理可改 1–24 小时。间隔内合并排队，已有收益不重启。容量按最短 1 小时间隔预留 **24 槽**，不是仍固定最多 6 批。排除地址可查询。 |
| R07 三类用户统一领取 | 用户：`claimUserRewards(id,role,epoch,convert,rawFallback,deadline)` | [ProtocolFeeVaultUserClaims](../../contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol) → Creator epoch 账本 / Gauge / Holder → 用户钱包 | role 0 Creator、1 Staker、2 Holder；仅 Creator 使用非零 beneficiary epoch，其余传 0。用户只能消费自己归属的权益；Quote 直接领取，Meme 自选原币或兑换。没有旧 7 天原币申请等待。 |
| R08 领取时兑换、失败或部分成交 | FeeVault 内部受保护的外部自调用 `convertUserClaim` | UserClaims → [UserConversion](../../contracts/src/v1/shared/ProtocolFeeVaultUserConversion.sol) → [TickerGardenRewardConversion](../../contracts/src/v1/shared/TickerGardenRewardConversion.sol) → 本市场 v4 池 | 仅使用该用户本次 Meme 权益。未设价格参考窗口或预设最低到账；保留 deadline（提交时不超过当前时间后 5 分钟）、权限、精确余额验证。成功须有实际正数输出；不是保证某个成交价格。 |
| R09 兑换失败 / 剩余 Meme | 同一笔 Claim 捕获兑换子调用异常 | UserClaims `_restoreUserMeme` → 原用户 Creator / Gauge / Holder 账本 | 已有 Quote 和实际兑换所得正常发放；剩余 Meme 有 fallback 授权则发原币，否则保留同一用户待领。**其他环节**如接收方拒收 ETH、资产转账失败仍可导致整笔 Claim 回滚；不能表述为任何失败都可部分领取。 |
| R10 平台手续费和罚没 | 任意人触发 `claimPlatform`，款项固定给平台地址 | [FeeVaultLiabilities](../../contracts/src/v1/shared/ProtocolFeeVaultLiabilities.sol) → `platformTreasury` | 这是当前平台接收地址，不是已删除的 Treasury/Merkle 分发合约。罚没储备转平台负债属于会计重分类，不是 Meme→Quote 兑换。 |

## 4. 非合约职责及验收边界

| 业务 | 链上事实来源 | 链下职责及验收标准 |
| --- | --- | --- |
| 市场列表、Creator 列表、Stock 图标和搜索 | Factory / MarketRegistry 创建记录、Token metadataURI、Stock 注册 | 数据库按当前 release 与 marketId 建索引；新市场及时可查询；收益权受让人还须关联 CreatorRevenueRegistry。图标、搜索、分页不需要新增合约。 |
| 价格、市值、24H volume、Recent buys、图表 | Curve 储备/报价，v4 池状态与成交，Token supply、外部 Quote/USD 价格 | 后端缓存和汇总；市值须标明采用的 circulating supply 口径。合约没有“列出所有持有人/过去 24 小时成交”查询，需事件索引；不能把无统计接口当作缺失交易业务。 |
| 质押钱包数、累计收益、手续费统计 | Vault / Gauge 当前状态与事件，FeeVault 分配/领取事件、Holder 资产事件 | 钱包数去重并明确市场/全站范围；本金、可领、已领、累计收入分开；双资产不可直接相加，统一 Quote/USD 仅是展示估值。 |
| 交易完成、余额更新、成功页 | 钱包广播、交易 receipt、相关账户和市场读数 | 状态刷新目标 ≤30 秒；只更新受影响字段。统计允许 10–20 分钟延迟；全量历史索引不得阻塞创建、买卖或领取。 |
| Holder 自动注入 | FeeVault 待注入权益、Distributor 下次批次时间 | [worker.mjs](../../tools/holder-rewards/worker.mjs) 已有阈值检查、sweep 和注入路径，但仍含旧 release 分支。本轮未验证运行实例/计划任务/阈值配置。无调用者时合约不会自行发起交易。 |
| 治理运维 | AccessManager、各准入 Registry、Holder `setFundingInterval` | 配置变更按权限和延迟执行；准入暂停不是既有市场交易暂停。部署配置、权限移交和 test/master 参数须按新 release 验证。 |

## 5. 测试关系索引

以下是现有测试文件覆盖的方向，不把“测试文件存在”记为本次重新通过。运行证据及尚未执行项以清理复审为准。

| 关联编号 | 代表测试 | 已覆盖方向 / 待验证边界 |
| --- | --- | --- |
| L01–L02 | [Stock Registry](../../contracts/test/v1/product/OfficialStockRegistryV1.t.sol)、[Quote Registry](../../contracts/test/v1/product/ApprovedQuoteRegistry.t.sol)、[Resolver](../../contracts/test/v1/product/LaunchConfigResolver.t.sol)、[权限](../../contracts/test/v1/shared/AccessManagerConfiguration.t.sol) | 身份、配置、调用权限；实际部署治理权限另验。 |
| L04–L05 | [Factory](../../contracts/test/v1/product/TickerGardenFactoryV1.t.sol)、[Token](../../contracts/test/v1/product/TickerMemeTokenV1.t.sol) | 原子首买、Native/ERC20、退款、回滚、身份及固定供应量。 |
| L06–L07 | [Curve](../../contracts/test/v1/product/TickerGardenCurve.t.sol) | Curve 买卖、费用及边界；真实前端的先归集后 Claim 路径另验。 |
| L08–L09 | [GraduationExecutor](../../contracts/test/v1/product/GraduationExecutor.t.sol)、[LaunchLocker](../../contracts/test/v1/product/LaunchLocker.t.sol)、[MarketRegistry](../../contracts/test/v1/product/MarketRegistryV1.t.sol) | 原子毕业、永久锁仓和状态边界。 |
| L10、R01–R02 | [HolderPoolFlow](../../contracts/test/v1/shared/HolderPoolFlow.t.sol)、[FeeAccounting](../../contracts/test/v1/shared/MarketFeeAccounting.t.sol) | 本地真实池实现的买卖、额外协议费、Creator tax、Holder 分成；不是测试网交易证据。 |
| S01–S05 | [AllocationManager](../../contracts/test/v1/product/AllocationManager.t.sol)、[Exits](../../contracts/test/v1/shared/AllocationManagerExits.t.sol)、[Vault](../../contracts/test/v1/product/UserStockVault.t.sol) | 锁定、正常退出、本金先退、延迟奖励清算；另有 Vault/Gauge 不变量覆盖。 |
| R03 | [CreatorRevenueRegistry](../../contracts/test/v1/product/CreatorRevenueRegistry.t.sol) | 交接与收益归属。 |
| R05–R06 | [HolderFundingInterval](../../contracts/test/v1/treasury/product/HolderFundingInterval.t.sol)、[HolderBatchedInvariant](../../contracts/test/v1/treasury/product/HolderBatchedInvariant.t.sol)、[HolderPoolFlow](../../contracts/test/v1/shared/HolderPoolFlow.t.sol) | 间隔治理、保留原释放、小时级批次循环、双资产实际池奖励链路。测试路径的 treasury 是目录命名，不代表旧 Treasury 合约仍存在。 |
| R07–R09 | [UserRewardClaims](../../contracts/test/v1/shared/UserRewardClaims.t.sol)、[RewardConversionPool](../../contracts/test/v1/shared/RewardConversionPool.t.sol) | 原币、失败兜底、不兜底留存、部分成交、用户隔离、Staker 锁、deadline、异常余额验证、拒绝旧 selector。 |
| 跨链路 | [V1ProductForkE2E](../../contracts/test/v1/fork/V1ProductForkE2E.t.sol) | 当前 Fork 入口存在且已编译；最新复审未执行真实 Fork，不作为新部署联调通过证据。 |

## 6. 查缺补漏待办

| 优先级 | 待核对项 | 完成标准 |
| --- | --- | --- |
| P1 发布边界 | 当前源码与测试链旧部署是不同版本 | 新 release 的合约地址、ABI、权限、Factory 实现哈希及前后端配置一致；完成真实 Fork 和规定发布门禁。未完成前不标记“新版本已联调”。 |
| P1 产品规则 | Growing 页面保留质押操作区，而当前合约禁止 Growing 新增质押 | 页面明确毕业后开放并禁用 Add；若要允许提前质押，须另行改变合约规则，不能仅改按钮。 |
| P1 收益可达性 | Growing sweep → FeeVault Claim；Holder 入账 → 注入 → 释放 → Claim | 验证无交易时任务能归集已到阈值收益；小额未达阈值的用户入口有清晰状态/主动处理路径；不把未归集或未释放金额显示为立即可领。 |
| P1 联调验收 | 三种角色 × 原币/兑换 × 失败/部分成交 | 使用当前 release 完整走通创建、毕业、质押、产生手续费、Claim、退出；逐资产核对钱包变化、用户剩余权益与合约负债，不能仅检查交易成功。 |
| P2 收益权搜索 | Creator 页按发行钱包搜索可能漏掉收益权受让人及旧 epoch 未领收益 | 原发行、当前受益、历史 epoch 权利均可找到；不同钱包不能显示他人可领额度。源码具有该权利模型，页面是否全覆盖本轮未审。 |
| P2 自动任务 | Holder worker 保留旧 selector / 旧模式分支 | 新版实例只走统一 Claim 模式下的归集/注入，不执行旧操作员兑换；配置、频率、阈值和失败重试有可查运行证据。旧分支是工具层遗留，不是当前合约入口。 |
| P2 展示与统计 | 占比口径、双资产费用、24 槽容量、全仓重锁 | 文案与本文一致；把本金占比和有效奖励权重区分；禁止双资产数量直接相加；“默认 4 小时”不写成不可修改常量。 |

有意不存在的功能：旧 Treasury/Merkle、原币领取 7 天等待、操作员代用户兑换、历史参考价格窗口、奖励兑换预设最低到账、管理员暂停既有市场、独立毕业重试、LP 提取/复投、部分减仓、可转让质押 NFT。这些不能作为待补接口自动加回；若业务需要改变，应单独形成新需求。
