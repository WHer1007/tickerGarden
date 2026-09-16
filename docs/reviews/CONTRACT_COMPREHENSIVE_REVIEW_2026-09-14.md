# TickerGarden 合约全面复核

> 后续处理：R-01、R-02 与 O-01 已在当前源码完成优化与验证，见 [实施报告](./CONTRACT_OPTIMIZATIONS_IMPLEMENTED_2026-09-14.md)。下文保留优化前的审查结论与复现证据。

日期：2026-09-14。对象：当前工作区 `contracts/src/v1` 的 70 个 Solidity 文件及相关测试、规范、部署检查。工作区含既有未提交改动；本报告审查当前文件，不将 HEAD 或历史部署当作当前源码。源码 SHA-256 见 [source-start.json](evidence/contract-comprehensive-review-2026-09-14/source-start.json)，结束时 70 个文件均未变化，见 [source-comparison.json](evidence/contract-comprehensive-review-2026-09-14/source-comparison.json)。

## 结论

核心资金与业务路径有较完整的实现和验证：创建、Curve 买卖、原子毕业、V4 收费、双资产分账、正常/紧急退出、Creator 交接、Holder 快照领取、LP 托管与手续费复投均有对应入口。本轮没有确认新的无权限盗取本金、重复领取或任意增发漏洞；这不是无漏洞保证。

**新增确认一个交易 Gas 边界问题：实际活跃质押为零、存在较多未激活桶时，空仓探测可能耗尽预算，使交易仍需很高的 Gas 上限。** 另外，规范中有会影响实现与验收的过时规则，默认部署检查仍指向被当前规则拒绝的历史计划。现有 Holder 发布权限、外部资产升级与本金缺口政策具有实质资金影响，不能被测试通过掩盖。

本轮只新增审查报告、证据和三个专项测试；未修改生产合约、经济规则或历史部署计划，未提交或部署。没有获得全发布门禁通过，不能从本轮结果推导 `PRODUCTION_READY` 或广播许可。

## 发现与优先级

| 编号 | 性质 / 优先级 | 当前结论 |
| --- | --- | --- |
| R-01 | 新复现，P2 可用性/优化 | 零活跃但 30 个未来桶时，100k 权重探测 OOG，低 Gas 上限交易回滚 |
| R-02 | 当前文档缺陷，P2 | 同一执行规范仍混有不可升级 Quote、旧兑换、固定零 LP fee 等过时要求 |
| R-03 | 发布验证阻断 | 默认 deployment track 使用已明确保留为 legacy 的计划，被 schema 拒绝；不是 Solidity 漏洞 |
| R-04 | 既有条件性资金风险 | Stock 本金受损时按账面全额先到先得，缺口集中到后退出者 |
| R-05 | 既有高信任权限 | Holder publisher 能发布不公平根，已发布根没有取消/纠错窗口 |
| R-06 | 既有条件性准入风险 | 通用 Quote 的外壳 codehash/decimals 不保证代理实现或经济行为不变 |
| O-01 | 工程优化 | Factory/FeeVault 项目体积预算余量较小；Factory view 阶段重复身份校验值得测量 |

### R-01：没有活跃质押，也可能要求超过四百万的结算 Gas 余量

代码：[ProtocolFeeVaultV4Accounting.sol:159](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/ProtocolFeeVaultV4Accounting.sol:159)、[UserStockVaultRewardAccounting.sol:135](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/UserStockVaultRewardAccounting.sol:135)。

当前优化先以 `staticcall(100000, gauge, ...)` 探测有效权重。只有成功且严格返回一个零值才走空仓分支；失败回退到固定 4,000,000 Gas 的 self-call，入口另需 EIP-150 余量及 300,000 reserve，检查点约需 **4,363,492 Gas**。

真实读取链为 Gauge → AllocationManager → Registry/Stock Registry → UserStockVault。Vault 有 pending 时遍历 32 个 generation 槽；即使每个桶都在未来，冷读取和层层调用也会耗尽 100k 预算。用单次 SLOAD 返回零的模拟权重源无法发现此边界。

本轮新增 [Review20260914RewardGas.t.sol](/Users/dear/Documents/code/TickerGarden/contracts/test/v1/audit/Review20260914RewardGas.t.sol)，使用真实 PoolManager、Hook、FeeVault、Gauge、AllocationManager、UserStockVault；Registry 配置与 Stock token 为测试替身：

| 场景 | 结果 |
| --- | --- |
| 无 active、无 pending | 外层给 1,000,000 Gas，交易成功 |
| 连续 30 秒形成 30 个未来桶，active=0 | 外层给 1,000,000 Gas，交易回滚；资金与负债均不变 |
| 同一未来桶场景 | 外层给 8,000,000 Gas，交易成功；调用区间实耗约 **703,793 Gas**，Staker 份额和罚没均为零 |
| 30 个已成熟桶、双资产 accumulator 非零 | 成功处理所有桶，实耗约 **2,920,292 Gas**；31 个单位的有效仓位正常计奖，无错误罚没 |

完整 trace 明确记录 `UserStockVault.marketRewardEligible` 的 `OutOfGas`，随后出现 `InsufficientStakerSettlementGas`。证据：[reward-gas-confirmed.log](evidence/contract-comprehensive-review-2026-09-14/validation/reward-gas-confirmed.log)。早期测试按“未来桶应走轻量路径”断言而失败，保存在 `reward-gas-final.log`；最终测试是对当前限制、回滚和成功 fallback 的复现，**通过不表示生产代码已修复**。

影响是钱包或路由按轻量场景给出的 Gas 上限可能失效，以及非空场景先做一次注定失败的探测。该状态可由正常质押形成；它不是永远无法交易，给足预算能执行，桶到期后也会改变场景。上述数字是本地调用区间，不是 RH 交易 receipt、L1 数据费或所有生产组合的最坏上界。

建议先对完整只读调用图确定有余量的探测预算，或拆分有界权重读取与非零权重写入预算；增加真实 Registry、不同冷/热槽、0–30 桶和同交易多市场的验证。**失败不可当作零，不能删除防低配 Gas 保护，也不能直接降低健康 Staker 的结算预算**，否则可能将应归 Staker 的费用改记平台。此次没有实施该优化。

### R-02：当前规范仍含互相冲突的业务规则

这会让后续实现、报价和审计按不同“真相”工作，属于应优先修正的维护问题。

- [V1_EXECUTION_SPEC.md:34](/Users/dear/Documents/code/TickerGarden/docs/v1/V1_EXECUTION_SPEC.md:34) 仍要求普通 Quote 为非代理，但 [ApprovedQuoteRegistry.sol:15](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/modules/ApprovedQuoteRegistry.sol:15) 明确允许管理员评审的可升级 ERC20；当前参数文档也允许这种准入。现有测试专门验证了代理升级后外壳检查仍通过。
- [V1_EXECUTION_SPEC.md:12](/Users/dear/Documents/code/TickerGarden/docs/v1/V1_EXECUTION_SPEC.md:12) 和 [CREATOR_SELECTED_LP_FEE.md:39](/Users/dear/Documents/code/TickerGarden/docs/v1/CREATOR_SELECTED_LP_FEE.md:39) 仍描述内部奖励兑换及 98% 参考输出校验。当前 [ProtocolFeeVaultUserClaims.sol:52](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/ProtocolFeeVaultUserClaims.sol:52) 是原资产领取，没有这条兑换路径。
- [V1_PROTOCOL_PARAMETERS.md:151](/Users/dear/Documents/code/TickerGarden/docs/v1/V1_PROTOCOL_PARAMETERS.md:151)、同文件 440 行仍写 `PoolKey.fee=0` / `lpFee==0`；同文件 612、702 行和当前代码已支持创建时冻结的 0/1000/2000/3000 pips。协议 LP 分成是零，**原生池 LP fee 可以非零**，两者必须分别表述。
- [V1_PROTOCOL_PARAMETERS.md:427](/Users/dear/Documents/code/TickerGarden/docs/v1/V1_PROTOCOL_PARAMETERS.md:427) 仍写 Creator 附加税固定为零，而当前创建参数和 `CreatorTax.validate` 允许 0–500 bps。

建议围绕当前实际语义重写这些段落，历史规则明确标记版本；同步语义测试，不能只检查某个关键词“曾在文件出现”。不建议把合约改回旧文档中的规则。

### R-03：全发布检查不能通过，但原因是默认历史计划被正确拒绝

本轮 `npm run check:deployment-track` 内部 build 和 **68 项部署测试全部通过**，随后 `check:testnet-plan-live` 在 schema 阶段失败：`/configurationInputs must NOT have more than 21 items`。

[robinhood-testnet-46630.v1.plan.json](/Users/dear/Documents/code/TickerGarden/deployments/manifests/robinhood-testnet-46630.v1.plan.json) 与对应 Arbitrum 计划各有 27 项；当前 [testnet-plan.ts:63](/Users/dear/Documents/code/TickerGarden/deployments/src/v1/testnet-plan.ts:63) 定义 16 项规范输入。旧计划包含已移除兑换/Treasury 窗口字段，并缺少 `V1_DEPLOYMENT_HOLDER_MODE`。当前测试明确要求拒绝 saved legacy plan，因此不能把这个现象解释为 schema 应该放宽。

建议保存历史文件和拒绝测试，在需要发布验证时生成新的当前候选计划并显式选择它，使默认命令或运行说明明确区分历史证据与当前候选。此次没有生成待广播计划。`check:tracks` 也未全通过，其本次调用先在未加载 RPC 的 fork-track 处停止；独立 candidate mainnet Fork 已由主代理随后完成，不能因此把整个旧 aggregate 命令标成通过。

### R-04：外部 Stock 本金损失时，退出顺序决定损失承担者

代码：[UserStockVaultDeposits.sol:32](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/UserStockVaultDeposits.sol:32)、[UserStockVaultExits.sol:35](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/shared/UserStockVaultExits.sol:35)。

存款前已有旧缺口检查，能阻止新资金被用于填补旧亏损；提款仍按用户账面本金精确支付，不按比例分摊缺口。现有 `testAudit_deficitDoesNotBlockRemainingFreePrincipalOrRageQuit` 本轮通过：两用户存 200/100，外部余额由 300 降至 250，先退出者可拿回 200，后者账面 100 对应仅剩 50。

触发前提是发行方扣减、负向 rebase 等外部余额损失，不是普通用户凭空制造缺口的漏洞。本轮沿用现有“剩余本金尽量可退出”政策，不将它偷换成冻结提款规则。建议明确披露先到先得的损失分配，并逐资产监测/制定补足处置。若希望公平分摊，需要单独批准经济与会计设计；简单加入全额偿付前置条件会冻结剩余本金。

### R-05：Holder 根的正确分配依赖发布者，错误根不能撤回

代码：[HolderRewardsDistributorV1.sol:120](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/modules/HolderRewardsDistributorV1.sol:120)、同文件 232–269、295–315 行。

链上验证轮次、预算、近期区块 hash、Merkle inclusion 和付款守恒，不验证全部历史余额与公平分配。当前 `testAudit_trustedPublisherCanAllocateToWalletWithNoMeme` 本轮通过：发布者能将已入金奖励分给没有 Meme 的钱包。Guardian 的撤销入口阻止后续根发布，但已发布根继续有效。

这是明确的可信权限，而非任何人均可伪造 proof。后台余额重建、双 RPC、精确 calldata 预演能降低误操作，不能约束绕过后台直接调用的持权账户。建议发布签名端绑定审查过的数据 hash/预算/calldata，保留完整可追溯记录。如果产品需要纠错窗口，应另行设计生效前延迟与取消；不得给管理员任意改写已生效权益的能力。此轮未启用周期发布。

### R-06：通用 Quote 身份检查不等于实现或经济行为不可变

代码：[ApprovedQuoteRegistry.sol:195](/Users/dear/Documents/code/TickerGarden/contracts/src/v1/modules/ApprovedQuoteRegistry.sol:195)。通用路径检查地址 runtime hash 与 decimals；代理升级保留这两项即可继续通过。现有 `testAudit_genericProxyUpgradeStillPassesIdentityCheck` 本轮通过。

这要求治理先准入可升级资产、外部权限随后改变实现，属于条件性风险。专门的 Stock fingerprint 路径有实现检查，但它是可选准入路径，不能把它的保证扩展到所有通用 Quote。即便实现未变，暂停、冻结或可变外部依赖也可能改变转账能力。

建议逐资产记录代理类别、升级/冻结主体和处置策略；需要实现锁定保证的资产必须使用相应身份承诺。已创建市场采用冻结配置且不会被 Quote pause 自动停掉，这是当前自治设计，不能把暂停准入描述成可停止所有旧市场。

## 其他业务取舍与优化

以下行为与当前实现一致，本轮不将其列成新漏洞：

| 行为 | 用户影响 / 建议 |
| --- | --- |
| 最后一笔 Curve 买入原子毕业 | 需承担完整毕业 Gas；下游失败回滚买入。保留已接受的原子设计，报价应模拟整笔交易 |
| 追加质押重锁整仓及未领取奖励 | 小额追加也重置 24 小时；旧 pending 与新增量重排 30 秒。签名前需明确呈现整个仓位的新解锁时间 |
| 正常退出只支持整仓；rageQuit 放弃奖励 | 两种入口职责不同，不能为简化 UI/代码而合并权益规则 |
| Creator/创建时 beneficiary 反狙击豁免 | 取决于收币地址，不限于一次首买；前 5 秒费率差异属于需要披露的政策 |
| 永久未配对资产 | 当 phantomQuote=0.4×threshold 时，忽略舍入约 8.1633% 初始总供应成为未配对锁定 Meme，不能称可回收小额 dust |
| 领取固定支付调用者 | 不接收原生资产的合约钱包会回滚；历史 Creator epoch 不随受益人交接转让，属已接受边界 |
| LP 手续费复投 | 手动 worker 已实现；无需再报“执行器缺失”。自动调度/线上 Keeper 配置未在此次核验；单边费用不会自动换币 |

最值得做的性能工作是 R-01；其次是保持体积预算和测量 Factory 重复 view 校验：

| 合约 | 当前 runtime | 项目预算余量 | EIP-170 余量 |
| --- | ---: | ---: | ---: |
| Factory | 23,583 bytes | 417 / 24,000 | 993 |
| FeeVault | 23,148 bytes | 352 / 23,500 | 1,428 |

本轮 runtime gate 通过。EIP-170 的代码上限是 24,576 bytes，项目预算更保守；不能混用两种余量。[EIP-170](https://eips.ethereum.org/EIPS/eip-170)

Factory 的 `resolve → assetIdentityCurrent → vaultIdentityCurrent` 后，`_validateVaultIdentity` 又执行身份查询；可以测量能否在连续 view 阶段复用验证结果，但必须保留预期 Registry/Manager/schema/codehash 绑定。此项尚无 A/B 收益数据，不建议为一次性创建 Gas 引入新的复杂架构。

Router Quote 配置传递、Holder 付款后余额复用、成熟桶按需读取已在当前源码实现。精确转账前后余额、另一资产回调后的最终偿付检查、防重放和身份检查不能作为普通重复代码删掉。Uniswap 的 LP fee、Core protocol fee 与本 Hook fee 有不同归属及计费基数，相关优化继续按官方模型核对。[Uniswap v4 Fees](https://docs.uniswap.org/contracts/v4/concepts/fees)

## 本轮验证与证据范围

| 验证 | 本轮结果 |
| --- | --- |
| 完整普通合约测试，显式排除 Fork | **96 suites / 1,046 passed / 0 failed / 0 skipped** |
| 新真实双账本 Gas 用例 | **3 passed**；包含限制复现，不意味着 R-01 已修复 |
| Robinhood mainnet candidate Fork | **3 passed / 0 failed / 0 skipped**，chain 4663，区块 61,361,538 |
| Spec | **63 passed** |
| 部署包单元/结构测试 | **68 passed**，live-plan 阶段被 legacy plan 阻断 |
| Build / runtime size / fixtures / interfaces / product artifacts / boundary | 通过；product surface 检查 3 项通过 |
| product track | 21 suites / 332 passed；是普通测试的重叠子集，不叠加成独立覆盖数 |
| 新测试格式 | 通过 |
| 全 aggregate/deployment track | **未通过**，原因见 R-03；不宣称全仓门禁通过 |

Fork 区块 hash：`0xb934dc407b452ecba77ea28f4187f223a3de508d7211f74ec62a983c26ca92ce`。使用现有已配置内部 RPC，经固定区块兼容代理验证 chain/block/hash；未禁用 TLS 验证、未改用测试网。Fork 在本地执行当前合约图，覆盖真实 Stock、四档 LP fee 的创建/毕业/交易/收费、快照领取与 Creator 交接，不代表当前在线产品已部署该版本。

主要证据：[普通测试](evidence/contract-comprehensive-review-2026-09-14/validation/test-contracts.log)、[新增 trace](evidence/contract-comprehensive-review-2026-09-14/validation/reward-gas-confirmed.log)、[主网 Fork](evidence/contract-comprehensive-review-2026-09-14/validation/mainnet-fork.log)、[部署检查](evidence/contract-comprehensive-review-2026-09-14/validation/deployment-track.log)、[runtime](evidence/contract-comprehensive-review-2026-09-14/validation/runtime-final.log)、[机器汇总](evidence/contract-comprehensive-review-2026-09-14/verification-summary.json)、[覆盖映射](evidence/contract-comprehensive-review-2026-09-14/coverage-inventory.md)。

此次没有运行前后端全仓测试、外部独立审计、长期线上负载测试、生产部署验证或签名账户检查。主要证据来自源码、已有 adversarial/invariant tests、三个新增专项用例和固定区块 Fork。建议执行顺序：先处理 R-01 与 R-02；为下一次发布选择当前候选计划；将 R-04～R-06 的资金风险和权限假设纳入明确的产品与运维责任，再评估低收益的结构优化。
