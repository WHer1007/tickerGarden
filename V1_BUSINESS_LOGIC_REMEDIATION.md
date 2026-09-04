# TickerGarden V1 业务逻辑审计整改

> 基线：`V1-EXEC-9`，2026-09-04。DR-01 已通过原子毕业架构关闭；DR-02 的首发风险通过 native-only 与不可升级 Quote 准入加固，未来 ERC-20 仍需逐资产审查。本文不构成部署就绪声明。

## 已实现：BL-01 RageQuit 后的幽灵手续费权重

原问题发生在本金优先逃生与异步 Gauge 清理之间：Vault 已清除退出者 allocation，但 Gauge 的 active/pending 总量可能暂时仍包含该用户；FeeVault 若读取 Gauge 本地总量，会错误进入 Active 分支并稀释剩余 staker。

整改后，`MultiAsset.v6` Vault 维护独立的有效奖励权重镜像，FeeVault/Gauge 均以该值作为正常手续费分配的权威分母。Vault 在本金退出交易内先移除退出者权重，并记录最新 Quote/Meme accumulator cutoff；Gauge 后续只能按该 cutoff 计算被放弃收益。结果是：

- 退出后新手续费不会归属逃生用户；
- 仍 Active 用户不会被尚未清理的 Gauge 仓位稀释；
- Gauge 故障仍不阻塞 Stock 本金返还；
- 无论是否存在其他 Active staker、异步清理前权重或 cohort 是否变化，cutoff 前被放弃收益均不重新分配，统一进入 ProtocolFeeVault 的 platform forfeiture reserve；后加入者不能捕获或稀释旧 forfeiture。

如果退出时仓位仍在 pending，且 Gauge 在 cutoff 之后才处理对应 bucket，则清理流程直接撤销该 stale pending 并减少 Gauge 本地聚合，不允许按较新的 accumulator 向旧 cutoff 反向结算，也不会给逃生用户补发退出后的手续费。

这是本金优先与异常手续费归属之间的 fail-closed 边界：正常手续费仍按有效 Active staker 权重分配，但 rageQuit 产生的任何异常/放弃奖励不进入该分配路径，统一转入平台 reserve。Gauge 故障、低 gas 或直接 Vault 入口造成延期时，FeeVault 记录失败也不改变归属；只留下 deferred forfeiture，等待 permissionless flush。

Factory 同时要求资产绑定的 Vault 必须是 Registry 中 `MultiAsset.v6` 的 canonical reverse binding，并复核 Vault 自报的 OfficialStockRegistry、MarketRegistry、AllocationManager 与 schema。旧 v5 或伪造依赖的 Vault 会在 marketId 预留和部署前失败，避免创建后才在新奖励 ABI 上失效。

## 已实现：BL-03 不可毕业的参数组合

原问题是 Quote/Pons Registry 只做局部形状校验，某些各自合法的 supply、phantomQuote、graduationThreshold 与 tickSpacing 组合，会在 `GraduationPoolMath` 的 signed amount、sqrt price 或 max-liquidity 域失败。市场可能已经创建并交易，直到毕业才永久失败。

整改分三层：Registry 先拒绝超过 `int128.max` 的单项经济数值；Factory preview/create 再在 marketId 预留和 CREATE2 部署前，对实际 baseline + quote 组合计算 Pons 理论终点资产，并按两种 token 地址排序执行与毕业一致的 pool math。任一组合不可表示时，市场创建直接失败。最后，Curve 针对任意多笔买卖造成的整数舍入路径，在最终 fee sweep 后、转移毕业资产前，使用真实 Quote/Meme 和 canonical PoolKey 再运行同一 `GraduationPoolMath`；失败会让最终买入整体回滚并保持 `NotGraduated`，不会形成不可毕业的持久托管状态。Q192 精确边界改走 Q128 分支，避免临界 `mulDiv` 商等于 `2^256` 时溢出。目标链 fork 上的真实 Uniswap v4 执行和 gas 仍属于部署前验证门槛。

## 已关闭：DR-01 七日后 permissionless terminal rescue

旧设计的风险属于 Curve 毕业托管资产的灾难恢复，不是 Stock Vault 的用户 RageQuit：`Swept` 七日后任何地址都可抢先触发不可逆 `Rescued`，并与仍可能成功的 graduation 形成排序竞争。即使 recipient 在部署时冻结，也无法自动证明其具备公平退款语义。

V1-EXEC-9 不再尝试为这一中间态设计更复杂的救援，而是删除中间态本身：最终 Curve 买入同步调用 exact registered Executor，最后 fee sweep、精确资产移交、Locker 部署、Pool 初始化、LP mint、双资产 dust 锁定、Hook 激活和 Registry `PoolCreated` 提交必须全成或全败。任何错误向上冒泡并回滚最终买入，资产不会留在 Executor 的 per-market escrow；因此也没有 retry、七日计时、终态 rescue、指定 recipient 或可被任意调用者抢先执行的路径。

关闭状态：`IMPLEMENTED / NEGATIVE_SURFACE_TESTED`。这不等于 Pool 出现后 Owner 可以干预；PoolCreated 后仍坚持永久自治，canonical LP 与 dust 均留在无提款/任意调用入口的 LaunchLocker。用户本金风险继续由独立的 `rageQuit` 处理。

## 已加固首发边界：DR-02 可升级 Quote 的既有市场依赖漂移

当前 Quote Registry 登记时只在链上检查 code 与 decimals；部署 preflight 虽要求记录 USDG implementation/codehash，但既有自主市场不会持续读取该指纹。Registry pause 只阻止新市场，无法保护已经引用同一代理地址的 Curve、Pool、Hook 和 FeeVault。

当前首发只允许 native Quote，USDG 等可升级代理不在 initial release。`ApprovedQuoteRegistry` 对未来 ERC-20 仅接受 direct immutable、非代理身份，保存 runtime/implementation 指纹并提供 `quoteIdentityCurrent(configId)`；Factory 与 MarketRegistry 在创建前同时 fail closed，部署 schema/preflight 要求 token 与 implementation 同址、固定 runtime hash、禁止委托 opcode且三个 EIP-1967 槽为零。Quote 到账与领取继续使用 exact balance delta 和 nonReentrant 防线。

状态：`INITIAL_RELEASE_MITIGATED / FUTURE_ERC20_REVIEW_REQUIRED`。当前架构刻意不为已创建的永久自治市场增加管理员 circuit breaker；未来若要支持新的 ERC-20 Quote，仍需逐资产源码/行为审计、目标链证据和独立产品决定。可升级 Quote 不能通过别名或配置更新进入首发。

## 本地验证与剩余边界

- BL-01 专项覆盖 `MemeStockGauge`、`UserStockVault`、Gauge accumulators、`ProtocolFeeVaultV4Accounting` 与 Factory/Vault schema；精确用例数量以当次 CI 输出为准。
- BL-03/原子毕业专项覆盖 Quote/Pons 单项上界、Factory 联合 max-liquidity 拒绝、真实终点回滚、Q192 临界值、exact Curve 调用、原生/ERC-20 精确资产消费、Locker/Pool/Hook/Registry 全原子提交与已删除 retry/rescue 负向表面。
- 全部 Foundry 测试与三套状态化测试纳入根目录 `npm test`；MultiAsset、Treasury 与 Vault/Gauge 均固定为 256 runs / 128,000 calls / 0 handler revert。
- 执行规范当前为 60 项；链下、正式 Web、boundary、fixture、compiled interface、product artifact 和 CI 三轨均由同一根门禁验证。当前十九模块 product manifest hash 为 `0xeb7b0a02f99afa8b27026abca7096f57d0491dd728318169a2eb8094bfd428cf`。

BL-01 的当前规则是有意的简单且确定：任何 rageQuit 产生的 forfeited Quote/Meme 奖励均进入 platform forfeiture reserve，不依赖 Active staker 数量、cohort 变化或清理时序。这样不会因异步清理或小额 allocation mutation 触发不同的受益人，也不需要引入历史 epoch/per-user 权重账本。ABI 中 legacy `redistributed` 字段保留以兼容旧消费者，但实现恒为 `false`。

BL-03 对极端、长期碎片化买卖采用资产转移前校验和最终买入全原子回滚，而不是声称创建前证明可以覆盖任意交易历史。目标链 Uniswap v4 实现与 gas 仍必须用固定区块 fork 和真实部署 E2E 关闭，不能由本地 pure-math 测试替代。

上述结果只证明当前本地代码与生成物一致，不等同于生产部署、目标链验证或独立第三方审计完成。
