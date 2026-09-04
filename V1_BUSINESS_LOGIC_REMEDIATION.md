# TickerGarden V1 业务逻辑审计整改

> 基线：`V1-EXEC-8`，2026-09-04。本文件区分“已实现修复”和“待产品确认建议”。DR-01/DR-02 尚未实施、未批准，也不构成当前部署就绪声明。

## 已实现：BL-01 RageQuit 后的幽灵手续费权重

原问题发生在本金优先逃生与异步 Gauge 清理之间：Vault 已清除退出者 allocation，但 Gauge 的 active/pending 总量可能暂时仍包含该用户；FeeVault 若读取 Gauge 本地总量，会错误进入 Active 分支并稀释剩余 staker。

整改后，`MultiAsset.v6` Vault 维护独立的有效奖励权重镜像，FeeVault/Gauge 均以该值作为手续费分母。Vault 在本金退出交易内先移除退出者权重，并快照最新 Quote/Meme accumulator、退出后的有效权重和 cohort mutation nonce；Gauge 后续只能按该 cutoff 计算被放弃收益。结果是：

- 退出后新手续费不会归属逃生用户；
- 仍 Active 用户不会被尚未清理的 Gauge 仓位稀释；
- Gauge 故障仍不阻塞 Stock 本金返还；
- 退出时存在剩余 Active staker、且异步清理前 cohort 与有效权重均未改变时，cutoff 前被放弃收益才重新分配；退出时无人或 cohort 已变化时，保守进入 forfeiture reserve，后加入者不能捕获或稀释旧 forfeiture。

如果退出时仓位仍在 pending，且 Gauge 在 cutoff 之后才处理对应 bucket，则清理流程直接撤销该 stale pending 并减少 Gauge 本地聚合，不允许按较新的 accumulator 向旧 cutoff 反向结算，也不会给逃生用户补发退出后的手续费。

这是本金优先与精确历史 cohort 之间的 fail-closed 边界：正常 `AllocationManager.rageQuit` 在同一交易内完成清理时，严格按退出后的剩余 Active staker 重分配；只有 Gauge 故障、低 gas 或直接 Vault 入口造成延期，且延期期间 cohort 发生变化时才转 reserve。若产品要求延期后仍无条件精确支付“退出瞬间”的历史 cohort，则必须新增按 epoch/per-user checkpoint 的历史权重账本，不能只靠聚合权重安全实现。

Factory 同时要求资产绑定的 Vault 必须是 Registry 中 `MultiAsset.v6` 的 canonical reverse binding，并复核 Vault 自报的 OfficialStockRegistry、MarketRegistry、AllocationManager 与 schema。旧 v5 或伪造依赖的 Vault 会在 marketId 预留和部署前失败，避免创建后才在新奖励 ABI 上失效。

## 已实现：BL-03 不可毕业的参数组合

原问题是 Quote/Pons Registry 只做局部形状校验，某些各自合法的 supply、phantomQuote、graduationThreshold 与 tickSpacing 组合，会在 `GraduationPoolMath` 的 signed amount、sqrt price 或 max-liquidity 域失败。市场可能已经创建并交易，直到毕业才永久失败。

整改分三层：Registry 先拒绝超过 `int128.max` 的单项经济数值；Factory preview/create 再在 marketId 预留和 CREATE2 部署前，对实际 baseline + quote 组合计算 Pons 理论终点资产，并按两种 token 地址排序执行与毕业一致的 pool math。任一组合不可表示时，市场创建直接失败。最后，Curve 针对任意多笔买卖造成的整数舍入路径，在最终 fee sweep 后、写入 escrow 或 `markSwept` 前，使用真实 swept Quote/Meme 和 canonical PoolKey 再运行同一 `GraduationPoolMath`；失败会让最终买入整体回滚并保持 `NotGraduated`，不会把资产送入不可毕业的 `Swept` 状态。目标链 fork 上的真实 Uniswap v4 执行和 gas 仍属于部署前验证门槛。

## 建议：DR-01 七日后 permissionless terminal rescue

当前风险属于 Curve 毕业托管资产的灾难恢复，不是 Stock Vault 的用户 RageQuit。现状是 `Swept` 七日后任何地址都可抢先触发不可逆 `Rescued`，资产虽只能发送到部署时固定 recipient，但该地址没有被链上证明为按市场隔离、可审计的退款合约；同时 terminal rescue 与仍可能成功的 graduation 存在排序竞争。

建议下一执行版本采用：

1. 将固定 recipient 替换为 CREATE2 per-market `GraduationRefundEscrow`，构造时冻结 marketId、Curve、Quote、Meme 与退款规则；Executor 验证 runtime codehash 和接口，不允许 EOA 或通用金库。
2. 改为 `requestRescue -> grace period -> executeRescue` 两阶段。request 只记录 exact escrow、失败原因哈希和时间，不转资产、不改变 launchPhase。
3. grace period 内保持 permissionless graduation retry；最终执行 rescue 前原子地再尝试一次 canonical graduation，成功则 graduation 优先并取消请求，仍失败才允许 terminal rescue。
4. 退款权利必须在代码中唯一确定。优先考虑“当前流通 Meme 持有人 burn-to-redeem Quote”的全链上比例模型；若业务必须按历史净投入退款，则需独立审计的不可变快照/Merkle 规则、challenge window 与总额守恒证明。
5. 增加每市场负债、重复领取、余额 delta、超时和同块竞争 invariant；任何失败保留 `Swept` 与原 escrow，不得转入管理员可任意处分的地址。

建议状态：`PROPOSED / PRODUCT_DECISION_REQUIRED`。需要先确定退款受益人语义与 grace period，再改 ABI。

## 建议：DR-02 可升级 Quote 的既有市场依赖漂移

当前 Quote Registry 登记时只在链上检查 code 与 decimals；部署 preflight 虽要求记录 USDG implementation/codehash，但既有自主市场不会持续读取该指纹。Registry pause 只阻止新市场，无法保护已经引用同一代理地址的 Curve、Pool、Hook 和 FeeVault。

建议下一执行版本采用：

1. 仿照 Official Stock，把 `QuoteTokenFingerprint` 纳入 content-addressed Quote 配置：proxy runtime、proxy 类型、beacon/implementation 地址及 runtime codehash；提供 `quoteIdentityCurrent(configId)`。
2. Factory 对新市场继续 fail closed；既有市场增加“客观漂移而非管理员判断”的 circuit breaker。Curve 禁止新 buy，毕业 Hook 在 swap 前校验并回滚涉及漂移 Quote 的新交易；Stock principal RageQuit、Meme 侧领取和只读负债不受影响。
3. Quote 领取仍使用现有 exact balance delta 与 nonReentrant 防线；若升级后 transfer 语义不兼容则保留账面负债并回滚，不得吞掉 entitlement。
4. implementation 变更只可通过 timelock + 独立安全复核加入新 fingerprint 版本。默认只供新市场使用；是否让旧市场恢复必须有显式兼容性决策和退出窗口，不能自动继承 Registry unpause。
5. 为不可恢复的旧市场预先定义 opt-in 迁移/退款路径、事件和监控。现有不可变市场无法靠部署后增加 Registry 字段自动获得保护，必须由新 execution spec 和新组件部署承载。

建议状态：`PROPOSED / ARCHITECTURE_AND_PRODUCT_APPROVAL_REQUIRED`。如果继续首发可升级 USDG，此项应在生产 gate 前提升为必做；若首发只允许原生 Quote，则可暂缓到新增 ERC-20 Quote 之前。

## 本地验证与剩余边界

- BL-01 专项：`MemeStockGauge` 31/31、`UserStockVault` 16/16、`MemeStockGaugeAccumulators` 21/21、`ProtocolFeeVaultV4Accounting` 12/12、Factory/Vault schema 专项 2/2。
- BL-03 专项：`V1GraduationEconomicDomain` 5/5、`PonsCompatibleCurve` 20/20，Quote/Pons 单项上界、Factory 联合 max-liquidity 拒绝和真实终点 pre-Swept 回滚路径均已覆盖。
- 普通 Foundry 测试（排除三套状态化 invariant contract）：58 suites、659/659。三套状态化测试均通过；其中 MultiAsset 与 Treasury 分别为 256 runs / 128,000 calls，Vault/Gauge 为 256 runs / 64,000 calls，均为 0 revert。
- 规格 59/59、链下 70/70、正式 Web 16/16；boundary、fixture、compiled interface、product artifact 和 CI 三轨门禁均通过。当前十九模块 product manifest hash 为 `0x08dcffb30cf388b5545040166dfbd67639279a012fbe331ec55bb35f238cafca`。

BL-01 仍有一个有意的保守边界：延期清理期间只要 cohort 发生变化，旧 forfeiture 就进入 reserve，而不是尝试向历史 cohort 结算。这阻止后来者捕获奖励，但已有 staker 可被小额 allocation mutation 迫使失去该次再分配；若不能接受这种经济 grief，需要另立版本实现历史 epoch/per-user 权重账本。

BL-03 对极端、长期碎片化买卖采用 pre-Swept 原子回滚，而不是声称创建前证明可以覆盖任意交易历史。目标链 Uniswap v4 实现与 gas 仍必须用固定区块 fork 和真实部署 E2E 关闭，不能由本地 pure-math 测试替代。

上述结果只证明当前本地代码与生成物一致，不等同于生产部署、目标链验证或独立第三方审计完成。
