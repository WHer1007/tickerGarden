# TickerGarden V1 可验证执行规范

更新：2026-09-14。版本：`V1-EXEC-11`。本文描述当前源码；`NOT_PRODUCTION_READY / NOT_BROADCAST`，历史部署与测试结果不自动赋予新源码发布资格。

当前 UserClaims 支持选择 Quote、Meme 或同时领取两种原资产，没有内部兑换、minimumQuote、deadline 或兑换额外等待期。Staker 的24小时锁与退出结算条件继续有效；`burnMemeFees` 市场按冻结配置销毁 Meme 收益。旧兑换版本说明见 [历史领取版本](./V1_REWARD_CONVERSION.md)。

TickerGarden 毕业后基础费按核心 Swap 实际 unspecified delta 收取1%；Creator tax 使用相同基数独立向下取整，创建时在0–500 bps内选择并冻结。基础费在有 Active staker 时按 Creator40% / Staker30% / Platform30% 分配，无 Active staker 时按 Creator70% / Staker0% / Platform30% 分配；Staker、Platform 向下取整，整数余数归 Creator。全部 Creator tax 另归 Creator，不参与上述比例，也不参与 Holder 对 Creator 基础费份额的分成。

PoolKey.fee 使用创建时冻结的 lpFeePips（0/1000/2000/3000）；协议 LP 分成为0，canonical fee-policy 的 poolKeyFee=0 仅为策略占位，不覆盖实际 PoolKey。原生 LP fee 与 Core protocol fee 均由 PoolManager 独立计费，不进入 FeeVault；Core protocol fee 可按方向存在，单方向最高1000 pips。不同计费基数的费率不得相加冒称实际总费。Hook 不调用 `PoolManager.donate`；LaunchLocker 支持公开 `collectLockedFees` 和仅指定 Keeper 可调用的有界 `compoundLockedFees`，canonical LP 继续永久锁定。

## 1. 市场永久自治

市场部署后没有平台市场级暂停、退休、紧急接管或 Recovery 管理状态。市场 Registry 只保存一次性 `launchPhase` 事实及其唯一单向变更：`NotGraduated -> PoolCreated`。不存在 `Swept`、`Rescued`、`MarketStatus`、`statusSince`、`restrictedSince`、`recoveryEpoch` 或 Controller 写入入口。

资产、Quote、Pons baseline 和 launch template 仍由各自 Registry 执行对象级 `ACTIVE <-> PAUSED -> RETIRED`。这些状态限制新增准入或新增敞口，不改变已部署市场的生命周期，也不阻止既有用户退出和领取已归属负债。

## 2. 用户即时 RageQuit

用户可在任意 `launchPhase`、任意时间调用 `rageQuit`，立即取回本人完整本金。该入口不依赖市场管理状态、时间锁、MarketController、Gauge 可用性或 Recovery root，不改变市场、Curve、Pool、Hook 或其他用户状态。

退出顺序固定为 Vault 读取权威 allocation、从 Vault 权威 reward-eligibility 总量中移除本人权重、快照 Gauge 最新 Quote/Meme accumulator cutoff、写入退出 tombstone、清除本人本金聚合、精确返还本人 STOCK；未领取 Quote/Meme 奖励异步放弃。后续 permissionless 结算无论是否存在其他 Active staker、cohort 或权重是否变化，均将放弃收益记入 ProtocolFeeVault 的 platform forfeiture reserve，不向任何 staker 重分配，后加入者不能分享。异步奖励失败不得回滚已完成本金退出。

Gauge 清理延迟期间，FeeVault 只读取 Vault 的有效 Active 总量；退出用户的预览与最终 forfeiture 均固定在本金退出交易记录的 accumulator cutoff。因此退出后的新手续费不会再分给该用户，也不会稀释仍 Active 用户，且 RageQuit 不能绕过24小时锁领取收益。

ABI 中 `redistributed` legacy 返回值/事件字段暂时保留以兼容旧消费者，但当前 rageQuit 路径恒返回 `false`；任何放弃收益均以平台 forfeiture reserve 为唯一归属。

## 3. 交易与生命周期

`launchPhase` 是唯一市场生命周期维度。Curve 交易只允许 `NotGraduated`，毕业池交易只允许 `PoolCreated` 且绑定事实完整。最终买入、最后一次曲线手续费入账、真实资产移交、Locker 部署、Pool 注册与初始化、LP mint、剩余双资产永久锁定、Hook 激活和 Registry 提交必须属于同一笔交易；任一环节失败，全部状态和资产转移回滚，市场仍为 `NotGraduated`。所有资金写入口必须读取链上 Registry、Factory 和组件绑定，不得从 API、Indexer 或本地缓存推断额外市场状态。

`ApprovedQuoteRegistry` 是新市场唯一的 Quote 准入来源。管理员可经延迟权限追加 native 或经风险审查的 ERC-20 config；通用 Quote 可为管理员评审的可升级 ERC-20；创建者可选择任意已登记、身份仍有效且处于 `ACTIVE` 的配置。ETH 只是 bootstrap 示例，不是协议硬编码的唯一 Quote；暂停或退休某个配置只阻止后续市场使用，不迁移或终止既有市场。每个 config 冻结 Quote 地址、decimals、Pons baseline、raw `phantomQuote` 与 `graduationThreshold`，Factory 在预览和创建时复核内容 hash、代码身份与联合毕业经济域。通用路径复核已登记的 runtime codehash 与 decimals，交易继续执行精确余额变化校验；代理外壳检查不等于实现不可升级。需要实现指纹承诺的资产应使用相应 Stock Quote 准入路径。

Robinhood 官方链下 `/rhj/prices/{symbol}` 可供受约束的配置生成器和创建页面读取 Stock Quote 的 USD 参考价，但不改变上述信任边界。REST 返回底层股票价格，须乘一次 `/rhj/assets` 的 `currentMultiplier`；RH Chain Chainlink Feed 已包含 multiplier，不得重复相乘。Stock Token 可经管理员风险审查走通用 `addQuoteConfig`，也可选择 `addStockQuoteConfig` 提交 Asset UID、canonical Token、Beacon/implementation 指纹承诺；后者在身份漂移时拒绝准入。两种路径的信任保证不同，Base 资格不会自动赋予 Quote 资格。配置激活状态必须以目标链当前 Registry 和发布证据为准。完整规格见 [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)。

## 4. 毕业经济域准入

`TickerGardenBaselineRegistry` 与 `ApprovedQuoteRegistry` 分别拒绝超过 `int128.max` 的 supply、phantomQuote 和 graduationThreshold。Factory 的 preview/create 在预留 marketId 或部署任何组件之前，再对实际 baseline + quote 组合执行联合校验。canonical pool Quote 固定为 `ceil(sellableTokens × phantomQuote / reservedTokens)`；canonical pool Meme 固定按该 Quote 与 reservedTokens 推导。这样初始池价格不受任意交易历史的整数舍入影响。Curve 在最终 fee sweep 后、转移资产前要求实际 Meme 恰好等于 reservedTokens、实际 Quote 不低于 canonical pool Quote；多出的 Quote 和未进池 Meme 永久锁入 LaunchLocker。两种 token 地址排序都运行同一 `GraduationPoolMath`，覆盖 v4 signed amount、sqrt price、tick 与 max-liquidity 域；任一步不可表示或建池失败，最终买入整笔回滚并保持 `NotGraduated`。Factory 还要求 Stock Vault 是 Registry 中 canonical `MultiAsset.v6` reverse binding，runtime codehash 与初次登记一致，且 Vault 自报的 Registry、MarketRegistry、AllocationManager 与 schema 全部匹配。无法形成可表示 canonical pool 或身份漂移的 Vault 组合不得创建市场。

## 5. 迁移不兼容清单

本版删除旧版的 MarketStatus 枚举、市场 pause/unpause/retire 函数、MarketController、Emergency activation、Recovery cap/snapshot/stateHash、Merkle root/claim 管理，以及 `markSwept`、`markRescued`、`retryGraduation`、`rescueSweptLaunch`、`LaunchSwept`、`AutoGraduationFailed`、`LaunchRescued` 和 `sweptAt`。这些旧权限、事件、ABI、Indexer 投影、API 字段和前端状态均不得继续作为当前产品语义。

## 6. 验收边界

手续费域、reward cutoff、联合经济域准入、原子毕业与所有直接消费者必须共同通过规范、完整非 Fork 合约测试、固定区块 Fork、构建、runtime 体积、接口和生成产物检查。规范正文必须与当前源码行为一致：通用 Quote 准入范围、原资产领取、创建时冻结 LP 档位、Creator tax 的独立计算和归属，不能仅以文件中出现关键词作为验收。

模块、函数、事件和权限以当前 `spec/v1_abi_surface.json`、`spec/v1_permissions_matrix.json`、`spec/v1_execution_manifest.json` 及编译生成的产物为准；不得复用旧 Treasury 的 root reviewer、mutation 数量或七日等待规则描述当前 Holder 快照发布。preflight 必须核验当前 AccessManager、各 Registry 和 runtime 组件绑定，覆盖延迟权限、Guardian 边界与 bootstrap 管理权处置。

源码、编译产物和验证记录必须对应同一候选版本。历史 legacy plan 被当前 schema 拒绝时，保留历史证据并生成或显式选择当前候选计划，不能放宽校验或把部分通过视为全发布门禁通过。Fork 证据须记录 chain ID、固定区块号及 hash。目标账户/参数确认、receipt-bound manifest、目标链源码验证、独立审计、产品 E2E 和上线批准仍须分别完成；本规范和本地测试均不授权广播。

生产初始化可以使用既有 `AccessManager.multicall` 封装多个 `execute(target,data)`；内部仍逐项调用原 Registry 方法，并保留原调用者的权限检查。`PER_ASSET_TIMELOCKED_REGISTRY_CALLS_NO_BATCH_ABI` 表示不新增 Registry 批量业务 ABI，后续治理登记仍逐项受延迟权限约束；它不要求 bootstrap 阶段每项必须单独发送交易。本次 4663 候选每批最多 32 项 Stock 或 Quote，这是按目标链 Gas 演练选定的发布批次大小，不是协议资产数量上限。模板、Holder 发布者、Keeper 和权限交接在最后一批原子完成，Keeper 初始化先于 selector 绑定和部署者退权。

Stock 身份验证可以复用由当前 runtime codehash 唯一确定的字节码扫描结论；UID、decimals、当前 implementation、实际 codehash、预期 fingerprint 和 Vault 绑定仍逐资产验证。不得按 token 地址缓存不再复核的身份，或以共用实现为由跳过升级后的代码检查。
