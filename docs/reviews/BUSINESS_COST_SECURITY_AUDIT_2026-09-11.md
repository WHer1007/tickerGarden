# 当前合约业务开销与安全复审 — 2026-09-11

结论：当前版本仍有优化空间，优先处理领取的故障隔离和兑换失败后的 Gas 储备，然后优化无待激活质押时的固定扫描。此次源码检查与本地测试未确认新的高危盗取资金、越权领取或重复入账漏洞；这不是正式第三方审计、形式化证明或上线资格证明。

范围为当前工作树 `contracts/src/v1` 的业务调用链，并核对本地 Uniswap v4 实现与相关测试。工作树有大量此前未提交修改，因此不能用 HEAD 代表受审版本。源码 SHA-256 清单保存在 `outputs/reviews/business-security-audit-2026-09-11/source-sha256.json`。本轮只新增测试和报告，未修改生产合约，未调用 RPC、运行真实链 Fork、部署或广播交易。

## 一、确认的可用性问题

### S01：两种领取资产的故障仍然耦合（中风险，条件触发）

位置：`ProtocolFeeVaultUserClaims.sol:62–64,84–88,114–130`；`ProtocolFeeVaultLiabilities.sol:330–363`。

统一 Claim 始终处理 Quote、Meme 两种资产，并检查两种资产的偿付能力。付款按 Quote、Meme 顺序执行。任一资产的余额查询、转账或到账证明失败，整笔 Claim 回滚。因此用户即使选择原币领取，也不能单独取走仍正常的另一种资产。例如 Quote 发行方暂停转账时，Meme 奖励也无法领取。

新增 `test_auditQuoteTransferFailureAlsoBlocksHealthyRawMeme`：模拟 Quote 的 `transfer(ALICE,30)` 回滚，验证 ALICE 的 100 Meme 未到账、Quote/Meme 应付权益均保留；解除故障后相同原币领取成功。这里确认的是故障传播，不是资金丢失。

建议：增加按资产选择领取的能力，未选择的权益不消费，也不让未参与付款的资产查询阻塞该次领取；Holder 分支需同步支持，而非仅在最外层跳过付款。若某一种资产确实资不抵债，仍应冻结该资产，不能挪用其他用户余额。默认 UI 可继续领取全部，异常时提供单资产路径。

相关边界：当前收款人固定为 `msg.sender`，无法接收原生 ETH 的智能合约钱包会在 native Quote 付款处回滚。可评估由权益所有人指定非零收款地址，领取授权仍属于原权益人；不能允许第三方指定地址取走他人收益。该钱包场景此次为源码确认，未新增专项复现。

### S02：捕获兑换异常不等于保证兜底完成（中风险，条件性可用性）

位置：`ProtocolFeeVaultUserClaims.sol:68–87`；`ProtocolFeeVaultUserConversion.sol:51–65`。

兑换 self-call 没有显式保留后处理 Gas。子调用耗尽转发 Gas 后，即使进入 catch，余量也可能不足以恢复权益、支付 Quote/原币和完成状态清理，最终整笔回滚。

新增 `test_auditGasExhaustionCanPreventAuthorizedFallback`：使用消耗所获 Gas 的故障 Hook，外层调用指定 500,000 Gas，授权原币兜底仍回滚；相同额度、不兑换的原币领取成功。两种资产的原有应付权益均未丢失。测试中的故障 Hook 通过测试 Registry 配置，生产用户不能替换规范 Hook。此测试证明兜底的 Gas 边界，不证明真实池存在可被攻击者稳定触发的耗尽路径。

建议：按 Creator/Staker/Holder、保留 Meme/原币兜底、原生/ERC20 Quote 的最坏后处理成本建立预算，给兑换子调用动态分配剩余 Gas，并保留恢复与支付预算。不要随意写死很小的兑换上限。可参考当前 `AllocationManagerExits.sol:198` 已采用的后处理预算思路，但不能直接照抄其数值。转账资产本身异常仍属于 S01，Gas 储备不能解决所有外部资产故障。

## 二、业务开销优化候选

以下均为源码确认的优化机会，尚未修改或完成独立 A/B Gas 测量，不承诺节省比例。

| 优先级 | 位置 / 现状 | 建议 | 必须保留的边界 |
| --- | --- | --- | --- |
| 高 | `MemeStockGaugeActivationWheel.sol:24`：无待激活仓位也扫描 32 槽；奖励入账会进入该路径。`UserStockVaultRewardAccounting.sol:136,155` 同样扫描 32 槽。 | 利用已有 `_totalPendingStock`、`_rewardPending`，在确实无待激活权重时直接返回。先做零 pending 的小改动，再评估是否需要位图。 | 不跳过外围的奖励 cohort/退出校验；到期 pending 仍必须按激活时点获得正确权益。Gauge 与 Vault 双账本有本金退出隔离用途，不应简单删掉一套。 |
| 中 | `HolderRewardsDistributorV1.sol:206,379–427`：共享余额读取已经完成，但无新增指数的转账仍可能进行余额读取及账户检查点；流循环中反复求 `_ledgerKey`。 | 在指数确实未增长时避免无效账户工作；在本次函数内复用 ledger key。以编译后 Gas 判断收益，编译器可能已优化部分表达式。 | 不能用 `rate == 0` 就直接跳过：过去已释放但尚未结算的收益、排除账户进出、有效供应量、余数和 idle 重启仍需正确处理。 |
| 低至中 | `ProtocolFeeVaultLiabilities.sol:231` 与 `ProtocolFeeVaultUserClaims.sol:155`：Quote、Meme 注资是两笔独立交易，分别经过保护与市场解析。 | 可选新增双资产注资入口，降低官方定期任务固定成本；保留单资产入口处理异常和单边余额。 | 不能为了批量化把异常资产扩大为正常资产的阻塞；不能恢复后台代用户兑换。 |
| 低 / 后续架构评估 | `ProtocolFeeVaultV4Credit.sol:31–42,65–116`：每次交易写入再清除较大的 pending 入账上下文。 | 若目标链明确支持所需 EVM 指令，可单独评估瞬态存储承载仅存活于同一交易的上下文；先测收益与部署复杂度。 | 持久 nonce、费用防重放、权限、精确到账和 begin/finalize 状态机不能顺手删除。当前稳定方案可以继续使用，不建议为本次优化马上重写。 |

优先做空激活队列的快速返回：高频路径明确，已有计数器，无需增加后台服务。Holder 微优化其次。双资产批量注资只降低周期任务开销，不会使用户交易更快；瞬态存储属于更后面的工程选项。

## 三、业务成本与已接受的风险

1. **不设兑换最低到账是当前已批准规则。** `ProtocolFeeVaultUserConversion.sol:60` 只要求正数实际输出和准确资产流量，没有经济价格下限。兑换成功但价格很差时不会触发失败兜底；浅池大额兑换可能造成明显损失，且存在被抢先交易影响价格的风险。按用户要求，不建议恢复最低到账或历史价格窗口。可优化预计 Quote/impact 展示、提供直接领取原币选项，并在基础设施支持时评估私有提交。
2. **最后一笔买入同时承担毕业成本。** `TickerGardenCurve.sol:167,265` 同一交易完成清费、部署 Locker、初始化池、铸 LP、核对并提交市场状态。任何一步失败会连同最后买入回滚。这是原子性取舍，不是已证实漏洞。应按“普通买入/触发毕业”分别估 Gas、展示交易阶段；不建议为了缩短等待立即拆成异步毕业，因为会新增中间状态及恢复机制。
3. **Stock/Quote 的发行方风险无法靠内部重构消除。** 本项目暂停/退役 Stock 后仍允许正常退出，`UserStockVaultIdentity.sol:48–65` 和退出测试支持这一点；但发行方暂停、拉黑、转账税、非标准返回值或升级导致转账不再精确，仍可能阻断实际本金转出。新入金的身份检查与既有本金退出不同，不能把新入金限制误用于所有退出。应维护资产权限资料和运维监控；本轮没有读取线上资产配置，不能确认测试网当前发行方状态。
4. **质押锁与奖励归属依然生效。** `MemeStockGauge.sol:162` 在领取前检查在仓本金的解锁时间。这是保留的当前规则，不是七天原币退出遗留。如希望奖励可独立于本金锁领取，需要单独改变业务规则及退出罚没设计，不能混入 Gas 重构。

## 四、关键链路检查结果

| 链路 | 本轮核对与当前结论 |
| --- | --- |
| 创建 / 模板 / 注册 | Factory delegatecall 目标来自固定 implementation，并有实现 codehash、模板、身份核对；未发现用户可传任意实现执行的路径。Registry/配置管理使用受控权限，市场身份与收益 epoch 不应随意合并。 |
| 首买 / 曲线买卖 | Router 与 Curve 使用重入保护、收退款来源约束和精确余额验证；普通交易与触发毕业的成本明显不同。 |
| 毕业 / LP 托管 | 规范 Curve 才能进入毕业；验证池身份、LP token 归属、实际资金消耗及最终状态。当前 Locker 是永久托管，未发现本次优化需要新增管理人提取 LP 的理由。 |
| v4 费用入账 | 规范 Hook/池/sourceVersion、feeId/严格 nonce、实际到账证据、防重入仍存在。LP fee 必须为零，但额外 PoolManager 协议费已兼容，相关本地池测试通过。 |
| 兑换 / 统一领取 | 仅 FeeVault 能发起规范 Hook 兑换，self-call 只允许内部使用；Quote/Meme 分账、部分成交恢复、用户/Creator epoch 隔离均有回归。S01/S02 是仍待处理的异常可用性边界。 |
| Hook 自身兑换 | 本地 v4 `Hooks.sol:293` 跳过由 Hook 自身发起 swap 的 afterSwap；因此没有将 Claim 中的 self-swap 误判为 FeeVault 重入漏洞。此行为依赖所用规范 v4 实现。 |
| Holder 释放 | 无全量 holder 遍历；24 小时释放、默认 4 小时准入、可配置 1–24 小时、最多 24 槽。旧“公共入口可塞满 64 流”的描述不适用于当前实现。公开触发者只能转移已记账奖励，Distributor 仅接受规范 Vault 注资。 |
| 质押 / 退出 | Vault 是本金权威账本；正常退出校验 Gauge/Vault 一致性；rageQuit 优先本金并隔离奖励清理，保留截止标记防止旧收益再领取。32 槽是固定上限，不随用户数无限增长。 |
| Creator 交接 | 提议/接受分开；旧 epoch 收益仍归旧权益人，交接前曲线清费防止历史收益错误归属。 |
| 旧业务检查 | 本轮在当前合约命名空间检索未发现 `RAW_EXIT`、`settlementOperator`、`TreasuryDistributor`、旧价格窗口及 `claimCreator` 调用。当前 Platform 收款、Creator epoch、24 小时释放不是相同含义的旧业务。关键词检索本身不构成逐行形式化的无遗留证明。 |

上轮已完成的“双资产 Claim 一次结算、Holder 共用余额、受保护调用复用 MarketView、只在兑换时检查 deadline、无用 helper 清理”，此次复核仍在当前源码中，不重复列为未修复问题。

## 五、验证与交付边界

新增 `contracts/test/v1/shared/ClaimAvailabilityAudit.t.sol`，包含两项新故障复现，并继承运行 16 项现有 Claim 测试。

本轮实际执行：

```sh
node tools/run-forge.mjs test --match-contract ClaimAvailabilityAuditTest
FOUNDRY_INVARIANT_RUNS=64 FOUNDRY_INVARIANT_DEPTH=64 node tools/run-forge.mjs test --no-match-path 'test/v1/fork/**'
```

- 定向测试：18 通过，0 失败。
- 本地非 Fork 全套：82 suites，902 通过，0 失败，0 跳过；总数包含新 harness 继承重跑的 16 项，不代表增加了 18 项全新测试。
- 完整日志：`outputs/reviews/business-security-audit-2026-09-11/claim-availability.log`、`contracts-local.log`。
- 编译与测试均退出 0。测试 mock 的 selfdestruct 弃用警告及本地签名缓存写入告警不属于生产合约新增漏洞。
- 未修改生产代码，因此没有新增 ABI/前后端接口；没有本轮 Gas 优化前后对照数据。
- 未验证已部署字节码、线上权限、实时外部发行方状态或真实链执行成本；本报告不能用于宣告测试链已更新或可直接上线。

建议实施顺序：S01 单资产故障隔离 → S02 兑换后处理 Gas 储备 → 无待激活仓位快速返回 → Holder 检查点微优化。每项均独立验证资金隔离、异常回滚与完整交易 Gas，再考虑低频任务合并。
