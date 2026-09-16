# 首买仅使用 Quote：实现与外部依赖检查

日期：2026-09-13。范围：移除首买的外部兑换责任，同步客户端、ABI、权限清单与新部署构造；检查其他业务中是否存在同类耦合。状态：本地实现完成；生产发布门槛仍须单独验收，NOT_BROADCAST。

## 已实现的业务边界

`LaunchAndBuyRouter` 只接收调用者拥有的所选 Quote 和首买数量，不决定这些资产如何获得。核心交易仍原子执行创建与首买。

| Quote | 调用支付 | 失败与退款 |
|---|---|---|
| ETH | `msg.value = launchFee + firstBuyAmount` | 创建/购买失败全回滚，剩余ETH退调用者 |
| ERC20（Stock/USDG等） | `msg.value = launchFee`，从调用者钱包拉取授权的 `firstBuyAmount` | 不足、授权不足、非精确到账均拒绝；额外ETH拒绝；尾单剩余Quote退调用者 |

`firstBuyAmount` 始终按所选资产decimals换算为raw units；金额来源不属于本协议，但合约必须验证真实到账。保留最低Meme到账、受益地址、余额守恒、授权清理、重入和创建身份检查。Router历史残余余额不能补贴交易。

已删除 `LaunchAndBuyRouterV4Fallback.sol`，Router构造从5项缩为Factory/ApprovedQuoteRegistry两项，移除PoolManager、fee、tickSpacing、兑换callback和对应权限。`launchAndBuy` 的调用签名及返回结构保持不变；ERC20第四个返回值统一为未使用Quote数量。当前Router仅有3个公开函数：launchAndBuy、factory、approvedQuoteRegistry。权限矩阵由87减至86，移除的是首买unlockCallback；治理角色和延迟不变。

客户端不再查询首买Quoter或检查首买PoolManager，不再把Quote余额不足转为ETH支付。余额不足明确提示先取得所选资产；无首买时跳过不需要的ERC20余额读取，未读取的余额显示为未知，不伪装0。钱包交易相关余额/模拟仍可按需RPC读取。真实提交前重新验证资金与授权，ETH只支付创建费和Gas（ETH Quote另加首买额）。

需要换币的用户应先在外部完成兑换，再创建首买。两笔交易之间不存在跨交易原子性：兑换成功而创建失败时，Quote仍在用户钱包。没有把任意DEX target/calldata、自动授权或第三方执行器引入核心入口。

## 其他业务检查结果

### E1：MarketRegistry 固定外部 SwapRouter/Quoter，存在同类耦合

证据：`contracts/src/v1/modules/MarketRegistryV1.sol` 的constructor验证外部swapRouter/quoter已部署并保存为immutable；`canonicalRoute()`把它们放进返回对象。当前生产业务Solidity没有调用这两个地址进行结算，它们主要作为客户端发现信息。

影响：外部路由器升级、更换报价服务或支持新执行方式时，这些返回值无法更新，容易使本项目客户端沿用旧入口。它不阻止第三方直接交易真实池，也不意味着PoolKey应由后端随意改变。

建议：后续从核心Registry移除这两个外部服务字段及构造约束；链上保留可验证的真实PoolKey/poolId、Hook、Quote/Meme、Curve/Gauge、Locker及生命周期。报价器和交易执行入口由后端版本化配置、前端选择；签名前核对链ID、目标池、资产、执行器可信范围及交易限制。涉及CanonicalRoute ABI、Read API、交易客户端和部署证据，作为独立跨层改造处理。本次检查已确认问题，尚未实施该第二项架构改造。

### E2：可选奖励兑换把领取与成交组合在一起，可进一步分离

证据：`ProtocolFeeVaultUserClaims.sol` 的 `claimUserRewards` / selected-assets入口接收 `convert`、`rawFallback`；`TickerGardenRewardConversion.sol` 通过本市场固定Hook和PoolManager兑换归属于该用户的奖励。`convert=false`可直接领取原始资产，不必报价或兑换。正常本金退出/本金优先rageQuit另有独立路径。

影响：兑换与领取共用交易，带来Gas、流动性、价格/MEV以及失败恢复复杂度；既有兑换无minOut保护的经济风险依然存在。它不依赖任意第三方SwapRouter地址，是使用协议自身池的可选便利功能，因此与首买自动跨资产购买的强制假设不同。

建议：核心奖励负债只按原始资产结算；需要兑换时由外部流程在领取后处理。若未来执行该拆分，应同步修改领取模式、前端、fallback语义和既有奖励策略，保证Creator/Staker/Holder权益、锁定与退出不变。本次保持当前已批准收益政策，报告该可优化边界。

### 应保留的协议依赖

| 模块 | 外部调用用途 | 判断 |
|---|---|---|
| GraduationExecutorPoolExecution | 在协议定义的v4池初始化、注入资产、通过PositionManager/Permit2铸造LP | 毕业本身的业务结算，保留真实PoolManager、资产与Hook绑定 |
| MemeHookFeeExecution / FeeVault | 从真实Swap delta收取费用、登记和偿付各方负债 | 核心收费业务，不能依赖前端报送费用数值 |
| LaunchLocker | 核验LP NFT所有权、绑定并永久锁定 | 协议LP锁定承诺，保留 |
| OfficialStockRegistry / Vault | 读取资产身份、代码/实现依赖、真实余额和转账结果 | 本金与资产安全边界，不能因“外部性”移除 |
| AccessManager / Treasury Safe | 校验协议角色、延迟变更、接收平台款项 | 协议权限和收款职责，保留 |

Curve定价使用本地储备数学。当前生产Solidity中未发现HTTP、Chainlink或其他外部USD报价作为交易结算依据。链下参考价格用于配置/展示，不应进入合约实时付款的信任边界。

## 验证与发布影响

- 全本地合约1005项通过；之后增加callback/PoolManager禁用入口断言，Factory68项再次通过。原有真实到账、恶意资产、尾单退款、授权与重入测试保留。
- 前端364项通过、build通过；部署66项、build通过；execution spec63项通过；后端ABI/OpenAPI/F72绑定检查通过。前端测试是在现有工作区执行；另对独立导出的暂存树执行typecheck通过，确认本次提交不依赖其他未提交的页面修改。
- 当前首买Router运行时代码为6136 bytes，旧实现15297 bytes，减少9161 bytes；Factory仍为23880 bytes。
- 规范、接口、Web ABI和产品artifact重新生成。资产毕业阈值、40%虚拟储备、0.5最低总仓位未修改。
- 原固定块61326136在本轮复核时返回缺失61326139 metadata的RPC错误，失败日志已保留。新快照同步更新Safe、依赖、区块号/hash/L1 block后重跑；新固定块61345999的业务Fork两项通过；新分阶段模拟通过，finish内部执行Gas为16,262,946（不等于最终交易gasLimit），记录见本目录证据与准备清单。
- 代码构造与ABI改变使旧预测地址/代码哈希/部署签名失效；先前已提交的模拟报告保持历史记录。本次重新生成的运行时计划仍不是可签名交易包，不解除逐笔交易Gas、资产激活、角色交接、独立审计等发布门槛。

[机器准备清单](../../deployments/manifests/robinhood-mainnet-4663.preparation.json)，[证据目录](evidence/quote-only-launch-2026-09-13/)。本次没有广播、签名或读取私钥。
