> 2026-09-08 后续更新：新增原子首买已完成新 release 部署和 10 项公开链验证，见[部署与验收报告](../../deployments/releases/0x985650b4d3758a5345be196182d2945b9c2df3f828fdb4dbd1a94e4b6def2b64/ATOMIC_BUY_REPORT.md)。下文旧 release 地址与候选阶段描述保留为历史快照；RH 测试网 Gas 预算已由 3M 更新为 16M 下限加签名前估算。

# Robinhood 测试网开发与联调参考

整理日期：2026-09-08。本文归档本项目此前查阅结果、本地部署证据与当前源码行为，供离线阅读；本次整理没有重新联网查询或广播交易。

**使用边界：地址表是指定 release 的历史快照；新增 ETH 自动兑换首买是本地候选实现，不能据此认定旧链上 Router 已支持。** 阅读和开发先查本文与链接的本地 JSON，交易前再读取动态链上状态。RH 主网是最终生产目标，测试网通过不等于生产就绪。

## 1. 网络与接入

| 项目 | 值 |
| --- | --- |
| 网络 | Robinhood Chain Testnet |
| Chain ID | `46630` |
| 原生 Gas 资产 | ETH |
| Alchemy RPC 模板 | `https://robinhood-testnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>` |
| 本地 RPC 变量 | `ROBINHOOD_TESTNET_RPC_URL`（按所用脚本的配置要求设置） |
| 浏览器 | https://explorer.testnet.chain.robinhood.com |
| 官方测试 Stock faucet 合约 | `0x8762f93772c663c6a88ba50900bd5381df2717be` |
| 最终生产网络 | Robinhood Chain Mainnet，Chain ID `4663` |
| 其他兼容测试网络 | Arbitrum Sepolia，Chain ID `421614`，地址及资产不能混用 |

连接钱包时按 46630 校验网络；缺少网络则提示添加。RPC 密钥只从本地环境读取，本文不保存完整带密钥的 URL、私钥或助记词。公开钱包地址不能用于找回私钥。部署签名与凭证管理遵循[测试网部署手册](./V1_TESTNET_DEPLOYMENT_RUNBOOK.md)。

## 2. Uniswap v4 测试依赖

以下抄录自本地部署手册的依赖快照；codehash 也一并保留，避免只保存网页链接。每次新 release 广播前仍需验证代码、链 ID 和绑定关系。

| Dependency | Address | Runtime codehash |
| --- | --- | --- |
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | `0xf3a0edb689229fa4bf135a728f2ec2eb4a2fbee2e41e3e74ffadb7b4c56e8a6d` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `0x0117e0ed818bc3f2a8729ffc336c837e63e965f04b473047b39b35ad86aac259` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | `0xfdd90802f39ce5fc8bac4c2f1b3ac7bac530fd17ff46b0630f1bd00f1e14082f` |
| V4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | `0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6` |
| StateView（部署后验证） | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | `0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6` |


PoolManager 管理 v4 池状态，StateView 用于读取状态，Quoter 用于模拟报价，PositionManager 管理流动性头寸，Permit2 处理其支持路径的代币授权，Universal Router 用于组合交易。它们不是同一个合约，不能互换地址。

本项目 PoolManager 通过部署配置注入，不需要把 RH 地址写死在 Solidity 源码。新 ETH 首买候选还通过构造参数绑定池费率和 tickSpacing，部署环境字段为 `V1_NATIVE_QUOTE_POOL_FEE=10000`、`V1_NATIVE_QUOTE_TICK_SPACING=200`。部署后不能通过修改前端配置改变这些 immutable 绑定。

**两类池的区别：** ETH / Stock 池用于取得 Quote；项目发行的 Meme / Quote 池属于毕业后交易池，使用本项目 Hook。前者的无 Hook PoolKey 不能拿来推导后者。曲线阶段的首买仍由项目 Curve 完成。

## 3. 官方资产与白名单

来源：[Quote 清单](../../deployments/manifests/robinhood-testnet-46630.paired-assets.json)、[Stock 质押清单](../../deployments/manifests/robinhood-testnet-46630.stock-assets.json)。Quote 清单的 `observedAt` 为 `2026-09-07T20:02:48.919Z`，`status` 为 `REGISTRY_ACTIVE`；后来追加的路由参数不能视为在该时间一并完成验证。

表内七项均属于该 release 的 Quote 清单。“质押”只指 Stock registry 收录，实际市场还须开启质押并绑定对应 Stock。

| 资产 | RH 测试网地址 | decimals | Stock 质押白名单 | 毕业阈值（该行资产单位） |
| --- | --- | --- | --- | --- |
| ETH | `0x0000000000000000000000000000000000000000` | 18 | 否 | 0.42 |
| USDG | `0x7e955252e15c84f5768b83c41a71f9eba181802f` | 6 | 否 | 809 |
| TSLA | `0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e` | 18 | 是 | 2.6 |
| AMZN | `0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02` | 18 | 是 | 2.93302910921427025 |
| PLTR | `0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0` | 18 | 是 | 4.706512526340435687 |
| NFLX | `0x3b8262a63d25f0477c4dde23f83cfe22cb768c93` | 18 | 是 | 13.030304635761589439 |
| AMD | `0x71178bac73cbeb415514eb542a8995b82669778d` | 18 | 是 | 1.666550459095902251 |

ETH 的零地址表示原生币，不是 ERC-20 合约。USDG 是 6 位小数，Stock 是 18 位，金额换算必须分别处理。**0.42 ETH 只适用于 ETH Quote；Stock 和 USDG 的毕业阈值不是 0.42 个代币，也不在每次交易时随美元价格自动变化。** 原始整数、phantomQuote、quoteAssetConfigId、baselineId、templateId 均保存在 Quote JSON，计算和发布应读取 JSON 而非复制显示小数。

USDG 身份来源为此前保存的 Paxos 测试网文档结论；Stock 身份来源为官方 faucet 列表及共享 beacon 指纹。此前观察的 faucet 列表中没有 NVDA、AAPL，故未收录；这不是“所有时间测试网上都不存在”的结论，也不能用同名自建币替代。Quote 使用管理员风险审核后的白名单机制，不因 USDG 或其他 ERC-20 类型而自动禁止准入。

五种 Stock 的共享身份快照：

- Token runtime codehash：`0x2f367e6a678e7b30ab613d5963e541e6f4d3ca586de76e2f441fbfeb1a27c440`。
- Beacon：`0x1df3ca0fd30ed5eeb09eb01938f4e9c5196e6ca5`。
- Implementation：`0xBd14156E05c6AF28ad39aA53a2AB8eB9CDf657DA`。
- assetUid、beacon/implementation codehash 与 minimumAllocation：见 Stock JSON。代理实现可能升级，不能只校验 Token 外壳 codehash。

## 4. ETH / Stock 交易池

此前调研找到五种 Stock 的原生 ETH 直连池；当前候选路由采用以下 PoolKey：

```text
currency0 = 0x0000000000000000000000000000000000000000
currency1 = 对应 Stock Token 地址
fee = 10000                    # v4 单位为百万分之一，即 1%
tickSpacing = 200
hooks = 0x0000000000000000000000000000000000000000
poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
```

以下 Pool ID 在本次整理中使用本地 manifest 和 viem 离线重算；不是新链上查询结果，且 ID 可计算不代表当前池有足够流动性。

| 配对 | Pool ID |
| --- | --- |
| ETH / TSLA | `0x197d7e73cb45f6f3974316879f46fc19c80c78f3f1096ecd58effe52cd9b2152` |
| ETH / AMZN | `0x978bf7f3949ffc284ed352e28b0bc32efecc9efd0f4f0c4bc971ff742ac3b066` |
| ETH / PLTR | `0xaf250b056bbe12c268c19e837927431c661d51b92f78471c1e5f9477a048a500` |
| ETH / NFLX | `0xb445c05bebb8a2fb61cf8dc6427c65a4aeea36d6f9527edf22fff59da0fc846a` |
| ETH / AMD | `0xb8153b22310c84eb2f20f0c8ef9189cf97e706bc449384cd4f87adc556d589f8` |

此前观察为非零流动性，但本文没有可引用的完整池查询区块快照，因此不把历史 liquidity 数值作为可执行深度保证。报价、价格影响和可成交量必须用实时 Quoter 检查。USDG 尚无已归档可用的 ETH 直连路由配置；不能推断所有多跳路线都不存在。当前候选仅支持上述固定形状的直连池，不是任意多跳聚合器。

## 5. 创建页自动 ETH 首买流程

这是[候选 Router](../../contracts/src/v1/shared/LaunchAndBuyRouterV4Fallback.sol)与[前端资金计算](../../apps/web/src/v1/launchFunding.ts)的行为说明，不是链上旧 release 功能保证。

1. 用户填写 Developer buy，以所选 Quote 数量计价；不需要选择付款路径。
2. Quote 为 ETH：直接使用 ETH。ERC-20 Quote 余额足够：沿用 Quote 首买及所需授权流程。
3. Stock Quote 余额为 0 或不足：使用 v4 exact-output 报价，计算买到**整笔 Developer buy 所需 Quote**的 ETH。已有部分 Stock 不扣取，不是只兑换缺口。
4. 候选合约在同一笔交易中完成 ETH → Stock Quote → 创建市场 → Curve 首买，Meme 发给指定接收人。任何一步失败整笔回滚，失败交易仍可能消耗 Gas。
5. 未使用的 ETH 退给创建者；Curve 尾部未用完的 Quote 单独退回，不自动卖回 ETH。两个退款的计量单位不同。

当前计算：

```text
预估兑换 ETH = Quoter.quoteExactOutputSingle(所需整笔 Quote)
兑换 ETH 上限 = ceil(预估兑换 ETH × 10100 / 10000)
交易 msg.value = launchFee + 兑换 ETH 上限
页面所需 ETH 预算 = msg.value + Gas 预算
```

兑换容差当前为 100 bps（1%），与池自身 1% LP 费率是不同概念；Quoter 报价已经体现该池兑换成本，不应再机械加收一遍池费率。`minTokensOut` 保护下一段 Curve 首买，不能用它替代第一段 ETH 花费上限。

前端当前 Gas 预算使用固定 `3,000,000` gas × feePerGas，**不是整笔交易真实估算，也不是保证足够的上限**；正式联调应验证整笔模拟、Gas 估算及网络费用。无路线、报价失败、余额不足时应阻止提交并说明原因，不能使用展示价格代替链上报价。

新候选上线前仍需新 release、部署绑定验证、真实 v4 Fork/测试网原子首买、退款单位检查、零余额/部分余额/额度不足/价格变化/池无流动性场景与钱包签名联调。现有本地测试不能替代这些验收。

## 6. 已部署项目地址快照

来源：[已部署 manifest](../../deployments/releases/0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0/robinhood-testnet-46630.v1.deployed.json)。快照验证时间 `2026-09-07T20:04:36.602Z`，状态 `DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY`。

```text
releaseId = 0x7b2614a529d1d3a06e8826cf38329e211f134c69200acda3b9ced5d4791b4df0
```

| 合约 | 地址 |
| --- | --- |
| AccessManager | `0x41509f8309F87c4ff2fdeAA77626c70DA9EB244B` |
| OfficialStockRegistryV1 | `0x61b41F452CCb6D02aC23Ff5e8132Baa1cA007aCA` |
| ApprovedQuoteRegistry | `0x16e7D4BDb32Bd77a4c2C8200d5280a1600718972` |
| TickerGardenBaselineRegistry | `0xf81a35EA72F2b65a4803aA34a39Bd6Ae049874D1` |
| LaunchTemplateRegistry | `0xc46CBE4FB1908d121317f3aeC036E168cCD41e4d` |
| LaunchConfigResolver | `0xf322632825e5f9f2Acf8f645C77A3ecE40F1c193` |
| TickerMemeTokenV1Implementation | `0x76302EA7de81AF1b16deE0cb2E825E9332F266cE` |
| TickerGardenCurveImplementation | `0x8052B715113b3209645De1D6e7B11E227c10Fec8` |
| MemeStockGauge | `0x4Dab757054852af1C50BAe94D737335b3eF17B43` |
| LaunchAndBuyRouter | `0xD921076d94DC248A02f82600aC6F728D3454753d` |
| MarketRegistryV1 | `0xd198aa34F8da3F3Fb812c134403fa38cE2C0211A` |
| CreatorRevenueRegistry | `0xC41f86dd448a4Aa487EEBAf7211032Bd4CDd9877` |
| AllocationManager | `0x1Fe610cE51E60e08d47780149cAE8A5F6684e335` |
| UserStockVault | `0xAA47fBF67c9b7D15Ff4B12C62c607ac2A63176e8` |
| HolderRewardsDistributorV1 | `0xE772dB0f38414954Fa879D2859726d0893C25Bbe` |
| ProtocolFeeVault | `0xD2c9C89D70cF05566997E2AeDeb33c37B5B15E29` |
| V1RobinhoodTestnetDeploymentOrchestrator | `0xb49312055c35c44884FEBAf98989Cc3b0dBdD22A` |
| V1HookExecutorDeployer | `0x867Ab0f4509B0A81D21E5f7904540da4bDa4af8D` |
| TickerGardenMemeHook | `0x8e232D69A30FDF3B1E5a99B1D61affa49a9c6044` |
| GraduationExecutor | `0x0a54aEa9C3512ea5E5DD0166Aff528b212D20bd0` |
| TickerGardenFactoryV1 | `0xD65e3AF3b337911d1ab3D13aac541be8d7d5ECBF` |

平台收益接收合约：`0xD84897cD860Da0B51D39a252961B18D54fBbb266`。完整 codehash、部署交易范围及权限操作以 deployed manifest 与[管理员手册](./V1_ADMIN_OPERATIONS_MANUAL.md)为准。

该 manifest 的 `publicTestnetE2E` 为 `false`。尤其不能把这里的旧 LaunchAndBuyRouter 地址当作新增 ETH fallback 已部署地址。部署记录、当前源代码和未来 release 是三个不同对象；切换前端 ABI/地址必须与实际部署版本匹配。

## 7. 测试账号与资金记录

| 角色 | 公开地址 |
| --- | --- |
| 部署/结算测试账号 | `0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea` |
| Buyer | `0xF6694020ee3DA75229439FAFc53f39BFC1ea3256` |
| Staker | `0xadCcb4b643987dE0F1DDDf4B5a0495fE459C42C1` |

[资金划转证据](../../deployments/evidence/robinhood-testnet-frontend-wallet-funding.json)保留逐笔资产、数量、交易哈希、区块号与区块哈希。它证明历史划转，不代表今天钱包余额；后续交易会改变余额。本文不登记私钥位置或密钥内容。

## 8. 日后如何使用和更新

日常阅读无需再次搜网：网络和池结构看本文，金额与准入 ID 读资产 JSON，合约地址/codehash 读具体 release，操作步骤读部署及管理员手册。

需要上链操作时只复核会变化的项目：RPC chain ID、区块与最终性、合约 codehash 和代理实现、白名单激活状态、池初始化与流动性、实际报价、钱包余额/授权、Gas，以及前后端绑定的 release。池流动性不足不等于原子交易逻辑错误；执行超时也不等于交易回滚，须先查交易哈希与回执以避免重复提交。

后续更新保留“观察时间、chain ID、block number/hash、查询方法、返回值、releaseId”，将新证据另存文件再链接；不要覆盖历史交易事实。本文不是部署批准书。

原始外部出处仅供溯源，常规阅读以以上本地归档为主：

- [Uniswap：Robinhood Chain is live](https://blog.uniswap.org/robinhood-chain-is-live)。公告用于背景，具体测试地址以本地部署依赖与链上验证为准。
- [Robinhood：Connecting to Robinhood Chain](https://docs.robinhood.com/chain/connecting-to-robinhood-chain/)。
- [本地此前资产研究结果](../../outputs/reviews/pons-v2-create/robinhood-assets.json)。
- [协议参数与原子首买说明](./V1_PROTOCOL_PARAMETERS.md)。
