# 最新合约业务完整性复核

日期：2026-09-13。对象为当前工作区 `contracts/src/v1` 的 70 个 Solidity 源文件，包含可选 LP 费率和上一轮 Gas 优化，**不是现有链上旧部署**。本轮只增加复现测试、报告和证据，没有修改生产合约、提交或部署。

## 结论

创建、Curve 买卖、原子毕业、V4 交易、分账、Creator 交接、Stake 正常/紧急退出、Holder 快照领取及 Locker 收费/复投的合约入口基本齐全。本轮没有确认新的普通用户越权转走资金或重复领取漏洞；这不是无漏洞保证或部署许可。

最明确的业务闭环缺口是 **Locker 后台执行链路尚未实现，合约具备复投能力不等于产品已自动复投**。另有一个已复现的 Gas 上限优化机会。Holder 发布者和通用可升级 Quote 的信任边界仍需保留在发布准入要求中，不能被前端或后台校验掩盖。

## 应处理的事项

### 1. LP 复投缺少运行闭环：业务集成优先项

`LaunchLockerCompounding.sol:66` 已实现 Keeper 专属复投，内部先收手续费，再验证手续费覆盖、最大投入、流动性增量和截止时间；`collectLockedFees` 可独立调用。全局 Keeper 为零时复投停用。

但仓库后台尚无 Locker 复投执行器、参数规划与模拟、签名发送、交易回执对账和重试去重链路；前端虽有 ABI，没有对应操作面板。`docs/v1/LOCKER_FEE_COMPOUNDING.md:82-89` 明确记录该运行层尚未启用。本次没有检查外部独立运维系统或链上 Keeper 配置，不能据此断言所有环境都无人执行。

影响：若未部署独立执行器或人工调用，手续费只会继续积累，不会自行变为 LP。建议先完成可手动预演/执行的后台工具，再接收运行授权后配置 Keeper 和调度。应展示待复投金额、成功回执、最后执行时间及失败原因。`compoundLockedFees` 内含 collect，正常执行无需先单独收集一次。

复投只使用已收手续费，不自动换币。单边或比例失衡的费用可能剩余，这不是丢失；若要支持换币再投入，需要另行确定交易路径、价格保护和 Keeper 权限，不能作为简单 Gas 优化直接添加。

### 2. 空 Staking 市场仍要求高 Gas 上限：已复现的优化机会

`ProtocolFeeVaultV4Accounting.sol:35-36,154-161` 对 Staker 结算预留固定 4,000,000 Gas，入口还要求 EIP-150 余量和 300,000 Gas 保留量，即在该位置至少约 4,363,492 Gas。检查发生在读取实际活跃权重之前。

新增 `LatestBusinessCompleteness.t.sol` 使用真实 PoolManager、Hook、FeeVault 和 Gauge，Registry/权重来源为测试替身：

- 未开启 Staking：外层调用提供 1,000,000 Gas，交易成功。
- 开启 Staking、活跃权重为零：同样上限失败，负债不变，交易完整回滚。
- 提供 8,000,000 Gas：交易成功，没有产生错误罚没。

这是钱包/路由必须给出的上限约束，**不是每笔实际扣除四百万 Gas**；未消耗部分不计入执行消耗。建议研究将可靠的权重读取与非零权重奖励写入拆成分别有界的阶段，并为零权重走轻量路径。必须保留“调用者不能故意低配 Gas 将健康 Staker 奖励改记平台”的保护，不能直接删掉检查或凭平均 Gas 降低上限。现有 30 桶测试使用模拟权重源，也不能当成完整生产调用图的最坏上界。

### 3. Holder 根发布后不可纠错：既有信任边界，不是遗漏快照代码

`HolderRewardsDistributorV1.sol:236-271` 验证轮次、区块、预算和偿付，但不在链上验证所有钱包余额或整棵树的公平分配；领取只证明叶子属于发布的根。已有复现 `testAudit_trustedPublisherCanAllocateToWalletWithNoMeme` 再次通过。

错误根可能使预算无法正常领取；恶意发布者可将奖励分配给其控制的钱包。现有 Guardian 撤销入口能阻止后续发布，但不会取消已发布根，旧根仍可领取。不能用 AccessManager 的 target closure 代替专用撤销入口。

后台 `previewSnapshotPublication` 已有持久化数据、历史钱包余额、双 RPC、预算/轮次重验及精确 calldata 模拟；前端也已有 proof 和部分资产领取。这些是实质保护，不能再列为缺失，但持有 publisher 权限的人仍能绕过后台直接调用。

建议维持明确的 publisher 信任说明，签名端绑定审查过的 dataHash/calldata，并保护发布凭据。若产品需要链上纠错，可另行设计待生效阶段和生效前取消；这会改变领取时机和治理权限，不能直接加入可随意改写已生效根的入口。周期发布仍按用户要求不启用，不计为缺陷。

### 4. 通用 Quote 的代理升级无法由外壳 codehash 捕获：条件性准入风险

`ApprovedQuoteRegistry.sol:194-215` 对通用 Quote 主要检查地址 runtime codehash 和 decimals。既有 `testAudit_genericProxyUpgradeStillPassesIdentityCheck` 再次通过：通用代理切换实现，但外壳 codehash 和 decimals 不变，身份检查仍通过。

前提是治理准入了这种可升级通用 Quote 且外部管理员升级它，不是普通用户可自行触发。它也不代表专门实现 implementation fingerprint 的 Official Stock 路径没有升级检查。

建议通用 Quote 准入明确区分不可升级资产与可升级代理；对后者采用已支持的实现身份适配、升级监测和治理处置规则。不要仅靠外壳 codehash 宣称经济行为不变。通用合约无法直接读取任意另一合约的代理 storage slot，不能假装加一次普通外部读取即可解决所有代理类型。

### 5. Factory / FeeVault 体积余量有限：后续开发约束

本轮 runtime gate 再次通过：Factory 为 23,583 bytes，距离项目 24,000 预算余 417；FeeVault 为 23,040 bytes，距离项目 23,500 预算余 460。两者也都低于 EIP-170 的 24,576 bytes 硬上限，当前不是不可部署问题。

后续加入功能前应先估算体积，并优先精简重复编码/查询或将纯计算放进现有适当模块。不要为节省少量 Gas 删除余额差、资金覆盖、来源验证或奖励防重放检查。Clone 化属于独立架构变更，应比较部署和全生命周期调用成本，不能直接算成本轮尚未完成的修复。

## 业务逐项核对

| 环节 | 复核结果 |
| --- | --- |
| 创建与 LP 费率 | 新市场支持 0/1000/2000/3000 pips，即 0/0.1%/0.2%/0.3%；配置进入 canonical PoolKey，旧部署不自动改变 |
| Curve 到毕业 | 买入触发原子毕业；费用先清算，储备移交与 Registry phase/source 更新有终态验证；维持已确认设计 |
| 池交易分账 | 原生 LP 手续费与 Hook base/Creator tax 分开；原生 LP 收益进入 LP 头寸，不重复作为 FeeVault LP 份额 |
| Creator 交接 | 提议/接受/取消入口齐全；Curve 旧费用先扫清，历史 epoch 权益不转给新受益人 |
| Stake 与退出 | 正常关闭、解锁领取和紧急退出入口齐全；本金退出可与失败奖励清理分离 |
| 延迟奖励清理 | `settleRageQuitRewards` 与前端操作已存在；tombstone 在清理前限制旧领取/同市场重新进入，不能列为缺少恢复入口 |
| Holder | 资金进入、数据生成、发布预演、根发布、双资产独立领取、publisher 撤销均存在；周期任务按用户要求暂停 |
| Locker | LP 托管、收手续费、复投、外部余额隔离和缺口恢复代码均存在；后台执行闭环见事项 1 |
| 偿付异常 | FeeVault 缺口阻止相关交易/领取，可补足后恢复；Distributor ERC20 缺口可由直接转入补足，没有专门覆盖查询/补足 UX，可作为运维增强 |
| 销毁与罚没 | Creator/Staker 领取时销毁；紧急退出罚没 Meme 可由平台领取，均为用户明确接受的政策，不作为漏洞 |

外部 Stock 亏损情况下的先到先足额退出、原子毕业、受益人自行领取、失败新 Staker 费用不向后续群体重放等既有边界没有被偷偷改为新业务规则。

## 证据与验证范围

- 重新计算 70 个生产源文件 SHA-256，与上一轮全量测试后的指纹全部一致，无新增生产文件。见 `evidence/latest-business-review-2026-09-13/source-comparison.json`。
- 本轮新 Gas 约束测试及继承用例：8 passed；其中新增独立测试为 1 项，不将继承用例算作新覆盖。
- 本轮既有业务边界定向回归：40 passed、0 failed、0 skipped，包含奖励失败隔离、30 桶结算、缺口恢复、publisher 信任边界、撤销、双资产领取和 Quote 代理升级。
- 本轮 runtime size gate 通过。日志保存在 `evidence/latest-business-review-2026-09-13/`。
- 相同源指纹的上一轮证据为 95 suites / 1,036 tests 全量通过，另有两个补充边界测试，以及 RH 固定区块 Fork 3 项通过；这些为**复用的上一轮验证证据，本轮未重跑全量或在线 Fork**。详细配置与限制见 `CONTRACT_COST_OPTIMIZATIONS_IMPLEMENTED_2026-09-13.md`。
- 本次是源码、测试与相关集成检查，没有检查当前在线部署、外部运维或签名账户。不能将本报告用于宣称现有测试站已切换最新合约，或已经具备自动复投、自动快照发布能力。

建议顺序：先补齐 Locker 可审查的执行工具和状态展示，再完成空 Staking Gas 路径的安全优化；发布前明确 publisher 与通用 Quote 的信任边界。纠错窗口、单边费用换币、Clone 架构属于另行设计事项。
