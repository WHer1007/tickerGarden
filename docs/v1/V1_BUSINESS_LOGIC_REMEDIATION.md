# TickerGarden V1 业务逻辑审计整改

> 2026-09-05 业务修复后的验证状态：Treasury 新分支改变了 product artifact。历史部署证据未覆盖当前字节码，部署证据哈希校验仍失败；当前环境缺少历史状态 RPC，Fork 三轨门禁未通过。下文历史 DEPLOYMENT_ELIGIBLE 记录不能作为当前修复版本的部署批准。详见 `outputs/reviews/2026-09-05-business-remediation-status.md`。


> 基线：`V1-EXEC-11`，2026-09-05。DR-01 已通过原子毕业架构关闭；DR-02 通过管理员逐项准入的 Quote 白名单、普通 ERC-20 不可升级身份门禁与官方 Stock Quote 的 BeaconProxy 专用准入加固。原生 ETH 只是 bootstrap 示例，不是唯一 Quote。本文不构成部署就绪声明。

## 开发期默认 staking 业务逻辑

面向市场的默认入口是 `AllocationManager.stake(marketId, amount)` 与 `unstakeAndWithdraw(marketId)`。`stake` 使用钱包对 canonical Stock Vault 的 allowance 完成资金划转和分配；AllocationManager 只协调 Vault 与 Gauge，任何时点都不持有用户 Stock。`unstakeAndWithdraw` 只允许调用者一次性退出完整且已解锁的本金仓位，并在同一交易内由 Vault 释放 allocation 后把本金转回调用者。

奖励与本金退出解耦：退出不会自动领取已产生奖励，用户仍通过独立的奖励领取路径领取其应得余额。Vault 内部的 `releaseAllocationAndWithdraw(assetUid, user, marketId)` 仅允许 AllocationManager 调用，不接受任意 recipient；Stock 转账失败时整笔操作回滚，避免 allocation 已释放而本金未返还。

共享 MultiAsset Vault 是统一托管账本，不提供按市场隔离的 custody 风险边界；`assetUid` 与 `marketId` 只用于账务归属。既有低层 `depositStock`、`allocate`、`increaseAllocation`、`closeAllocation` 等接口继续保留以支持协议与兼容测试，但不是 V1 UI 的默认入口。开发期规则仍为 30 秒 activation delay、整仓增加时 24 小时 lock reset、资产 minimum allocation，以及 emergency/rageQuit 时的奖励 forfeiture；预发布阶段不要求兼容历史余额或历史 allocation。

Vault 注册时的危险操作码扫描同时修正了编译器常量尾段误报：只有 opcode 对齐的 INVALID 后、且剩余字节没有任何 JUMPDEST 时才忽略尾段，PUSH 数据中的 INVALID 不作为边界，可跳入的尾段仍完整扫描；完整 runtime codehash 仍固定。

这些是开发期业务约束与本地实现口径，不能据此声称已经部署、通过目标链验证或完成独立审计。

## 已实现：BL-01 RageQuit 后的幽灵手续费权重

原问题发生在本金优先逃生与异步 Gauge 清理之间：Vault 已清除退出者 allocation，但 Gauge 的 active/pending 总量可能暂时仍包含该用户；FeeVault 若读取 Gauge 本地总量，会错误进入 Active 分支并稀释剩余 staker。

整改后，`MultiAsset.v6` Vault 维护独立的有效奖励权重镜像，FeeVault/Gauge 均以该值作为正常手续费分配的权威分母。Vault 在本金退出交易内先移除退出者权重，并记录最新 Quote/Meme accumulator cutoff；Gauge 后续只能按该 cutoff 计算被放弃收益。结果是：

- 退出后新手续费不会归属逃生用户；
- 仍 Active 用户不会被尚未清理的 Gauge 仓位稀释；
- Gauge 故障仍不阻塞 Stock 本金返还；
- 无论是否存在其他 Active staker、异步清理前权重或 cohort 是否变化，cutoff 前被放弃收益均不重新分配，统一进入 ProtocolFeeVault 的 platform forfeiture reserve；后加入者不能捕获或稀释旧 forfeiture。

如果退出时仓位仍在 pending，且 Gauge 在 cutoff 之后才处理对应 bucket，则清理流程直接撤销该 stale pending 并减少 Gauge 本地聚合，不允许按较新的 accumulator 向旧 cutoff 反向结算，也不会给逃生用户补发退出后的手续费。

这是本金优先与异常手续费归属之间的 fail-closed 边界：正常手续费仍按有效 Active staker 权重分配，但 rageQuit 产生的任何异常/放弃奖励不进入该分配路径，统一转入平台 reserve。Gauge 故障、低 gas 或直接 Vault 入口造成延期时，FeeVault 记录失败也不改变归属；只留下 deferred forfeiture，等待 permissionless flush。

2026-09-05 补充：Vault 按 `(assetUid, marketId)` 维护 `marketRewardCohortEpoch`，移除最后一份有效 Active 权重时递增（包含正常完整退出）。AllocationManager 通过 `rewardCohortEpoch` 只读转发。Gauge 在 activation/credit/settlement checkpoint 前比较已观察 epoch，先将旧全局 index remainder 转入平台 forfeiture 精度账本及 deferred reserve，再处理新批次；不改变既有用户已记入的 claimable/user remainder。即使已有 pending 跨越最后退出并在清理前成熟，或跨越多次未处理的零活动边界，旧余数也不会归新批次。该计数只依赖 Vault 本地账本，不增加本金逃生路径的外部 Gauge 调用。

Factory 同时要求资产绑定的 Vault 必须是 Registry 中 `MultiAsset.v6` 的 canonical reverse binding，并复核 Vault 自报的 OfficialStockRegistry、MarketRegistry、AllocationManager 与 schema。旧 v5 或伪造依赖的 Vault 会在 marketId 预留和部署前失败，避免创建后才在新奖励 ABI 上失效。

## 已实现：BL-03 不可毕业的参数组合

原问题是 Quote/Pons Registry 只做局部形状校验，某些各自合法的 supply、phantomQuote、graduationThreshold 与 tickSpacing 组合，会在 `GraduationPoolMath` 的 signed amount、sqrt price 或 max-liquidity 域失败。市场可能已经创建并交易，直到毕业才永久失败。

整改分三层：Registry 先拒绝超过 `int128.max` 的单项经济数值；Factory preview/create 再在 marketId 预留和 CREATE2 部署前，对实际 baseline + quote 组合计算配置决定的 canonical pool Quote/Meme，并按两种 token 地址排序执行与毕业一致的 pool math。任一组合不可表示时，市场创建直接失败。最后，Curve 针对任意多笔买卖造成的整数舍入路径，在最终 fee sweep 后、转移毕业资产前，要求 Meme 恰好等于 reserved 数量、真实 Quote 不低于 canonical pool Quote，并再次验证 canonical PoolKey；多出的历史舍入 Quote 与 Meme dust 一起永久锁入 Locker。失败会让最终买入整体回滚并保持 `NotGraduated`，不会形成不可毕业的持久托管状态。Q192 精确边界改走 Q128 分支，避免临界 `mulDiv` 商等于 `2^256` 时溢出。固定区块 Fork 已验证真实 Uniswap v4 原子毕业；实际测试网部署 gas 与浏览器链路仍须在 rehearsal 中记录。

## 已关闭：DR-01 七日后 permissionless terminal rescue

旧设计的风险属于 Curve 毕业托管资产的灾难恢复，不是 Stock Vault 的用户 RageQuit：`Swept` 七日后任何地址都可抢先触发不可逆 `Rescued`，并与仍可能成功的 graduation 形成排序竞争。即使 recipient 在部署时冻结，也无法自动证明其具备公平退款语义。

V1-EXEC-11 不再尝试为这一中间态设计更复杂的救援，而是删除中间态本身：最终 Curve 买入同步调用 exact registered Executor，最后 fee sweep、精确资产移交、Locker 部署、Pool 初始化、LP mint、双资产 dust 锁定、Hook 激活和 Registry `PoolCreated` 提交必须全成或全败。任何错误向上冒泡并回滚最终买入，资产不会留在 Executor 的 per-market escrow；因此也没有 retry、七日计时、终态 rescue、指定 recipient 或可被任意调用者抢先执行的路径。

关闭状态：`IMPLEMENTED / NEGATIVE_SURFACE_TESTED`。这不等于 Pool 出现后 Owner 可以干预；PoolCreated 后仍坚持永久自治，canonical LP 与 dust 均留在无提款/任意调用入口的 LaunchLocker。用户本金风险继续由独立的 `rageQuit` 处理。

## 已加固 Quote 白名单边界：DR-02 可升级 Quote 的既有市场依赖漂移

当前 Quote Registry 登记时只在链上检查 code 与 decimals；部署 preflight 虽要求记录 USDG implementation/codehash，但既有自主市场不会持续读取该指纹。Registry pause 只阻止新市场，无法保护已经引用同一代理地址的 Curve、Pool、Hook 和 FeeVault。

Quote 不再被限制为 native。管理员可以通过延迟权限向 `ApprovedQuoteRegistry` 追加任意经评估的 native 或普通 ERC-20 config，市场创建者可以从所有 `ACTIVE` config 中选择；市场创建后 Quote 地址与 economics 永久冻结。对普通 ERC-20，Registry 只接受 direct immutable、非代理身份，保存 runtime 指纹并提供 `quoteIdentityCurrent(configId)`；Factory 与 MarketRegistry 在创建前同时 fail closed，部署 schema/preflight 要求 token 与 implementation 同址、固定 runtime hash、禁止委托 opcode且三个 EIP-1967 槽为零。Quote 到账与领取继续使用 exact balance delta 和 nonReentrant 防线。USDG 等可升级代理仍不符合这一通用路径。

Robinhood 官方 Stock Token 的 BeaconProxy 结构不满足普通 ERC-20 路径。`V1-EXEC-11` 已新增独立的专用入口：只接受 `OfficialStockRegistryV1` 中 ACTIVE 的 Asset UID 与 canonical Token，绑定 token/Beacon/implementation 完整指纹、价格证据 hash 与 generator policy，并在任一身份漂移后阻止新市场；不能通过放宽通用代理门禁实现。部署 preflight 还会复核 immutable Beacon runtime、EIP-1967 Beacon 槽和当前 implementation。真实 fixed-block Fork 已验证代理转账、专用准入与原子毕业；暂停/黑名单/`adminBurn`、Beacon 升级、确定性价格生成器和首批 allowlist 仍是激活前门禁。其链下价格参考规则见 [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)。

状态：`ADMIN_CURATED_MULTI_QUOTE_IMPLEMENTED / PER_ASSET_REVIEW_REQUIRED`。新增 direct ERC-20 Quote 不需要更换 Factory，但必须逐资产完成管理员风险评估、源码/行为审查和目标链证据，再以新的内容寻址 config 追加。当前架构刻意不为已创建的永久自治市场增加管理员 circuit breaker；暂停或下架 Quote 只影响后续市场，不改变历史市场。可升级 Quote 不能通过别名或配置更新绕过准入门禁。

## 已执行：部署图与代码身份防御性加固

Factory 构造期现在逐一读取 Official Stock、Quote、Pons Baseline、Launch Template 四个 Registry 的 `authority()`，要求四者都绑定同一个有代码的 canonical AccessManager；不能再用“其中一个 Registry 绑定正确”替代其余三个的独立证明。Factory 同时验证 MarketRegistry、GraduationExecutor、Hook、ProtocolFeeVault、AllocationManager、Launch Router、Creator Registry 与 Treasury 的双向不可变绑定，避免把分别合法但来自不同部署图的组件拼成一个可创建市场的系统。

Launch Template schema 升级为 v2，固定 Hook 与 GraduationExecutor 的 runtime codehash、相互绑定和 Locker creation-code hash，并拒绝包含 `DELEGATECALL`、`CALLCODE` 或 `SELFDESTRUCT` 的直接模板 runtime。Official Stock Registry 另外固定共享 Stock Vault 的 runtime codehash及其首次自报依赖；Factory 每次创建市场前复核该 Vault 身份仍然有效。这样做的原因不是赋予 Owner 新的市场控制权，而是在市场不可干预之前，确保被永久冻结的是同一套已审核代码和依赖图。

对应生成 ABI、部署 preflight、Backend、Website 与 Indexer 已同步；Indexer 按包含 canonical pool amounts 和双资产锁定余量的十参数 `PoolGraduated` 事件观察与投影，避免原子毕业成功后链下状态遗漏。

## 本地验证与剩余边界

- BL-01 专项覆盖 `MemeStockGauge`、`UserStockVault`、Gauge accumulators、`ProtocolFeeVaultV4Accounting` 与 Factory/Vault schema；精确用例数量以当次 CI 输出为准。
- BL-03/原子毕业专项覆盖 Quote/Pons 单项上界、Factory 联合 max-liquidity 拒绝、真实终点回滚、Q192 临界值、exact Curve 调用、原生/ERC-20 精确资产消费、Locker/Pool/Hook/Registry 全原子提交与已删除 retry/rescue 负向表面。
- 全部 Foundry 测试与三套状态化测试纳入根目录 `npm test`；MultiAsset、Treasury 与 Vault/Gauge 均固定为 256 runs / 128,000 calls / 0 handler revert。
- 执行规范当前为 61 项；链下、正式 Web、boundary、fixture、compiled interface、product artifact 和 CI 三轨均由同一根门禁验证。当前十九模块 product manifest hash 为 `0xc397f82a06fb40cf507f2c328384165867f37b3e6be63e36b87d09272ffcbcc4`。

BL-01 的当前规则是有意的简单且确定：任何 rageQuit 产生的 forfeited Quote/Meme 奖励均进入 platform forfeiture reserve，不依赖 Active staker 数量、cohort 变化或清理时序。这样不会因异步清理或小额 allocation mutation 触发不同的受益人，也不需要引入历史 epoch/per-user 权重账本。ABI 中 legacy `redistributed` 字段保留以兼容旧消费者，但实现恒为 `false`。

BL-03 对极端、长期碎片化买卖采用资产转移前校验和最终买入全原子回滚，而不是声称创建前证明可以覆盖任意交易历史。目标链 Uniswap v4 的固定区块 Fork 已通过；真实测试网部署后的 gas、receipt 与浏览器 E2E 仍必须记录，不能由 pure-math 测试替代。

上述结果只证明当前本地代码与生成物一致，不等同于生产部署、目标链验证或独立第三方审计完成。
