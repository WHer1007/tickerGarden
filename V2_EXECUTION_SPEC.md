# TickerGarden V2 可验证执行规范

> 文档状态：`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`  
> 版本：`V2-EXEC-3`  
> 更新时间：2026-09-03
> 产品规则：[V2_PROTOCOL_PARAMETERS.md](./V2_PROTOCOL_PARAMETERS.md)  
> 技术架构：[V2_TECHNICAL_ARCHITECTURE.md](./V2_TECHNICAL_ARCHITECTURE.md)  
> Pons 行为基线：[V2_PONS_BEHAVIOR_BASELINE.md](./V2_PONS_BEHAVIOR_BASELINE.md)  
> 机器可读清单：[spec/v2_execution_manifest.json](./spec/v2_execution_manifest.json)、[spec/v2_permissions_matrix.json](./spec/v2_permissions_matrix.json)、[spec/v2_abi_surface.json](./spec/v2_abi_surface.json)  
> 官方 STOCK 准入：[V2_OFFICIAL_STOCK_ADMISSION.md](./V2_OFFICIAL_STOCK_ADMISSION.md)
> Stock Vault 架构决策：[V2_MULTI_ASSET_STOCK_VAULT.md](./V2_MULTI_ASSET_STOCK_VAULT.md)

本文冻结 TickerGarden V2 在 Uniswap v4、STOCK Vault、30 秒激活和异常状态下的唯一执行方式。本文不是新的经济方案；它把已经确认的产品规则落实为可实现、可测试、可审计的状态、公式、权限和 ABI。

若本文与两份 V2 主文档在以下四个范围内冲突，以本文为准：

1. `PoolKey`、Hook、毕业池 1% 手续费及 LP 20% 的执行；
2. Vault 市场级 allocation、本金释放和 Gauge 故障逃生；
3. 30 秒激活时间轮、双资产累加器和数学不变量；
4. 状态机、权限矩阵、ABI、事件和异常回滚。

本文不覆盖 V1。Pons runtime 差分、首发 native/USDG Quote economics、通用数值域，以及 Robinhood 官方目录当前观测194项 STOCK 全量可选为质押 Base 的规则已经取证并冻结。STOCK 价格、USD 名义目标和 backing target 不属于协议输入。本文授权按 `V2-EXEC-3` 开始实现，但不授权在最终 artifact、目标链取证、Fork/E2E、许可、法律和审计门禁关闭前部署。

## 1. 参考版本与信任边界

### 1.1 固定依赖

生产构建和审计必须以部署清单中固定的代码哈希为准。当前本地基线为：

| 依赖 | 固定版本 |
|---|---|
| Uniswap v4-core | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`（v1.0.2） |
| Uniswap v4-periphery | `dce236d4e2057422d0791d9a973a58765eb46f65` |
| OpenZeppelin Contracts | `cab19933c33c2ad1d4c7a84864a3601dddfd16f3`（v5.7.0） |
| Solidity | `0.8.26` |
| EVM | `cancun` |

主要规范来源：

- [Pons V2 官方文档](https://docs.ponsfamily.com/v2)：`PoolKey.fee = 0`、`beforeInitialize` 注册校验、`afterSwap` 在 unspecified currency 收费、两阶段毕业和 permissionless retry；
- [Uniswap v4 PoolKey](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/types/PoolKey.sol)、[PoolManager](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/PoolManager.sol)、[Hooks](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/libraries/Hooks.sol)、[Pool](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/libraries/Pool.sol)、[官方 FeeTakingHook 测试参考](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/test/FeeTakingHook.sol)；
- [Uniswap v4 Custom Accounting](https://developers.uniswap.org/docs/protocols/v4/guides/custom-accounting) 与 [Unlock Callback & Deltas](https://developers.uniswap.org/docs/protocols/v4/guides/unlock-callback-and-deltas)；
- [OpenZeppelin AccessManager](https://docs.openzeppelin.com/contracts/5.x/access-control) 与 [Access API](https://docs.openzeppelin.com/contracts/5.x/api/access)。

### 1.2 项目内与项目外异常

TickerGarden 只对项目内状态作确定性处理：Market、Hook、Vault、Gauge、FeeVault 和 Registry 的门禁、暂停、退出与恢复。获批 Quote 或官方 STOCK 的链外发行人、底层托管、冻结、脱锚或合规处置不由本协议补偿，也不允许协议用另一资产填补。

只接受 Registry 已批准且行为受约束的资产：固定 decimals、无 fee-on-transfer、无 rebasing、无任意 transfer callback。资产本身停止转账时，链上合约无法强制转移；协议能保证的是不会把该资产的故障扩散成另一资产的会计缺口。

## 2. 冻结常量

```text
POST_GRADUATION_FEE_PIPS = 10_000       // 1%；分母 1_000_000
PIPS_DENOMINATOR         = 1_000_000
LP_SHARE_BPS             = 2_000        // 总手续费的20%；分母10_000
BPS_DENOMINATOR          = 10_000
STAKE_SATURATION_WHOLE_TOKENS = 10     // 每市场10个完整 Base STOCK
FEE_ASSET_MODE           = UNSPECIFIED_CORE_SWAP_DELTA = 1
STAKER_RELEASE_MODE      = LINEAR_CAPPED = 1
INDEX_PRECISION          = 1e27
ACTIVATION_DELAY         = 30 seconds
ACTIVATION_QUANTUM       = 1 second
ACTIVATION_WHEEL_SIZE    = 32
MIN_POSITION             = strictly greater than 0.5 STOCK
MIN_LOCK                 = 24 hours
EMERGENCY_DELAY          = 24 hours after PAUSED/RETIRED, post-Curve phase only
UNPAUSE_DELAY            = 24 hours
PROTOCOL_ADMIN_DELAY     = 48 hours
LAUNCH_FEE               = 500000000000000 native wei
SNIPE_TAX_DURATION       = 3 seconds
SNIPE_TAX_RAW_BPS        = [9900, 618, 19] at elapsed [0, 1, 2]
SNIPE_MIN_NET_BPS        = 100
```

以上常量不由市场创建者选择，不允许治理原地修改既有市场。若未来版本改变常量，必须部署新 Factory/Hook/Gauge 实现和新 `executionSpecId`；旧市场继续按原版本运行。

`LAUNCH_FEE` 对当前 Factory 和 `executionSpecId` 是 immutable，不存在 setter、治理调价事件或“只影响未来交易”的原地更新路径。需要改费时必须部署新 Factory/Router、登记新 LaunchTemplate，并使用新的 `executionSpecId`。

## 3. Canonical PoolKey 与 Hook

### 3.1 PoolKey

每个毕业市场的 canonical `PoolKey` 只有一个：

```solidity
struct PoolKey {
    Currency currency0;   // min(address(quoteAsset), address(memeToken))
    Currency currency1;   // max(address(quoteAsset), address(memeToken))
    uint24 fee;           // exactly 0; static pool, not dynamic flag
    int24 tickSpacing;    // frozen in ponsBaselineId
    IHooks hooks;         // immutable TickerGardenMemeHook version
}

poolId = keccak256(abi.encode(poolKey));
```

必须同时满足：

```text
currency0 < currency1
fee == 0
1 <= tickSpacing <= 32767
poolId == PoolIdLibrary.toId(poolKey)
PoolKey 的五个字段与 market.canonicalPoolKey 完全一致
```

原生 Quote 使用 `Currency.wrap(address(0))`，因此必然是 `currency0`。WETH 若获批，仍是独立 ERC-20，不能与 native 混用。

市场保存：

```solidity
struct CanonicalPoolConfig {
    PoolKey key;
    bytes32 poolId;
    bytes32 marketId;
    uint160 initialSqrtPriceX96;
    bytes32 feePolicyHash;
    uint32 sourceVersion;
}
```

`PoolManager` 不替项目保存完整 `PoolKey`，所以每次调用都必须由项目合约重新校验全部五字段，不能只信 `poolId`、Token symbol 或 `hookData`。

### 3.2 Hook 权限位

Hook 只启用：

```text
BEFORE_INITIALIZE_FLAG          = 1 << 13
AFTER_SWAP_FLAG                = 1 << 6
AFTER_SWAP_RETURNS_DELTA_FLAG  = 1 << 2
HOOK_PERMISSION_MASK           = 0x2044
```

部署后必须验证：

```text
uint160(address(HOOK)) & ((1 << 14) - 1) == 0x2044
```

地址使用 CREATE2 salt mining 生成。`beforeSwap`、动态 LP fee、流动性回调和 donate 回调均不启用。未启用的外部 callback 实现必须直接 revert，不能藏有旁路逻辑。

Hook、PoolManager、FeeVault、MarketRegistry 和 GraduationExecutor 地址均为 immutable。Hook 不使用可升级代理；新版本服务新市场，旧市场不原地换 Hook。

### 3.3 beforeInitialize 注册握手

`beforeInitialize` 只能由 immutable `PoolManager` 调用，并按完整 `PoolKey` 推导 `poolId`。它必须验证：

```text
expectedPool[poolId].status == EXPECTED
expectedPool[poolId].marketId != 0
expectedPool[poolId].keyHash == keccak256(abi.encode(key))
market.launchPhase == Swept
market.marketStatus == ACTIVE
key.hooks == address(this)
key.fee == 0
key.tickSpacing == market.frozenTickSpacing
key currencies exactly equal market.quoteAsset and market.memeToken after sorting
```

`expectedPool` 只能由 GraduationExecutor 在同一毕业子调用中登记。登记、`PoolManager.initialize`、永久锁定初始仓位、Hook 激活和 `PoolCreated` 必须同一交易原子完成；不存在可被第三方抢先初始化的跨交易等待窗口。

`beforeInitialize` 将状态从 `EXPECTED` 改为 `INITIALIZE_SEEN`。若后续初始化、加池或激活失败，整个子调用回滚，状态恢复为不存在。Hook 不从 `hookData`、Token 自报字段或调用者提供的 marketId 建立绑定。

### 3.4 市场和收费源绑定

```solidity
mapping(bytes32 poolId => bytes32 marketId) marketOfPool;
mapping(bytes32 poolId => PoolBinding) poolBinding;

struct PoolBinding {
    bytes32 marketId;
    bytes32 keyHash;
    uint32 sourceVersion;
    uint64 feeNonce;
    PoolBindingStatus status; // NONE, EXPECTED, INITIALIZE_SEEN, ACTIVE, DISABLED
}
```

`afterSwap` 只从完整 `PoolKey → poolId → marketId` 映射识别市场。`hookData` 不影响市场、费率、受益人、sourceVersion 或 feeAsset；Router 即使伪造 `hookData` 也不能改变归属。

## 4. 毕业后 1% 手续费参考实现

### 4.1 “1%”的唯一含义

TickerGarden 沿用 Pons/Uniswap 官方 afterSwap unspecified-currency 模式，并冻结：

```text
exact input  → unspecified = output asset；用户少收到手续费
exact output → unspecified = input asset；用户多支付手续费
```

令 `u` 为 Uniswap 核心 Swap 完成、尚未应用 TickerGarden Hook delta 时，`BalanceDelta` 中 unspecified currency 的绝对原始单位数：

```text
base = abs(int256(unspecifiedDelta))
T = floor(base × 10_000 / 1_000_000)
L = floor(T × 2_000 / 10_000)
D = T - L
```

其中：

- `T` 是该笔 TickerGarden 总手续费；
- `L` 是进入同池 LP feeGrowth 的份额；
- `D` 是实际进入 FeeVault 的 non-LP 份额；
- `T == 0` 时不 donate、不 take、不 credit，返回零 Hook delta；
- 所有乘除使用 `mulDiv`，禁止浮点；
- `T` 必须可安全转换为正 `int128`，否则整笔交易 revert；
- 取绝对值必须先扩展到 `int256`，避免 `int128.min` 取负溢出。

这一定义不再支持“成熟市场 2–3 档降费”。所有毕业池固定为 1%，避免 Pool 核心费与 Hook 费叠加后不等于名义费率。

### 4.2 afterSwap 固定顺序

规范性伪代码：

```solidity
function afterSwap(
    address,
    PoolKey calldata key,
    SwapParams calldata params,
    BalanceDelta coreDelta,
    bytes calldata
) external onlyPoolManager returns (bytes4, int128 hookFeeDelta) {
    bytes32 poolId = PoolIdLibrary.toId(key);
    PoolBinding storage binding = poolBinding[poolId];

    require(binding.status == ACTIVE);
    require(keccak256(abi.encode(key)) == binding.keyHash);
    require(marketOfPool[poolId] == binding.marketId);
    require(market.launchPhase == PoolCreated);
    require(market.marketStatus == ACTIVE);
    require(activeFeeSource(marketId) == address(this));
    require(currentSourceVersion(marketId) == binding.sourceVersion);

    (, , uint24 protocolFee, uint24 lpFee) = StateLibrary.getSlot0(POOL_MANAGER, poolId);
    require(protocolFee == 0 && lpFee == 0);

    (Currency feeAsset, int128 signedBase) = unspecifiedCurrencyAndDelta(key, params, coreDelta);
    uint256 base = absViaInt256(signedBase);
    uint256 T = mulDiv(base, 10_000, 1_000_000);
    if (T == 0) return (IHooks.afterSwap.selector, 0);

    require(T <= uint256(uint128(type(int128).max)));
    uint256 L = mulDiv(T, 2_000, 10_000);
    uint256 D = T - L;
    uint64 nonce = ++binding.feeNonce;
    bytes32 feeId = canonicalFeeId(...);

    FEE_VAULT.beginV4Credit(marketId, address(feeAsset), D, binding.sourceVersion, feeId);
    if (L != 0) POOL_MANAGER.donate(key, amount0For(feeAsset, L), amount1For(feeAsset, L), "");
    POOL_MANAGER.take(feeAsset, address(FEE_VAULT), D);
    FEE_VAULT.finalizeV4Credit(marketId, address(feeAsset), base, T, L, D, nonce, feeId);

    return (IHooks.afterSwap.selector, int128(uint128(T)));
}
```

`beginV4Credit` 记录 FeeVault 在 `feeAsset` 上的实际余额。`finalizeV4Credit` 必须验证余额精确增加 `D`，然后才消费 `feeId`、处理成熟激活、计算 Creator/Staker/Platform、增加负债和累加器。不得只传一个数值就增加负债，也不得先 credit 后等待未来补款。

`beginV4Credit` 同时建立 non-reentrant pending-credit lock；同一 Hook 调用帧只能有一笔未完成 credit。`finalizeV4Credit` 校验 market、sourceVersion、feeAsset、D 和 feeId 与准备记录完全相同后清锁。FeeVault 的 native `receive` 只在 pending asset 为 native 且发送者为 PoolManager 时接受；ERC-20 只以 `balanceOf` 差值验收。任何重入、第二次 begin、缺少 finalize 或不精确余额增量均使整个 Swap 回滚。

### 4.3 v4 瞬时余额证明

同一 `feeAsset` 上 Hook 的瞬时 delta 为：

```text
afterSwap return delta  = +T
donate                  = -L
take to FeeVault        = -D
T - L - D               = 0
```

因此 Hook 在 unlock 结束时不欠 PoolManager，也没有多余正余额。Router 根据 Hook 调整后的最终 Swap delta 结算；任何 Currency delta 未归零时，PoolManager 以 `CurrencyNotSettled` 回滚整个 unlock。

核心 `lpFee` 必须始终为零，PoolManager 的 packed `protocolFee` 也必须为零。后者可能由外部 v4 ProtocolFeeController 改变，TickerGarden 无法阻止其写入，因此 Hook 每笔交易都读取并 fail closed。若任一方向启用了 v4 protocol fee，该 Swap 整笔回滚，Guardian 应立即暂停市场；否则用户总成本会超过本文定义的 1%。

### 4.4 LP 20% 的真实语义

`PoolManager.donate` 把 `L` 增加到 Swap 后 `slot0.tick` 所在的当前 in-range liquidity 的 `feeGrowthGlobal`。因此规范性的承诺是：

```text
每笔整数手续费 T 中，L = floor(T × 20%) 进入该池当前 in-range LP feeGrowth。
```

它不承诺每个外部 LP 地址都取得 20%，也不承诺 locked position 与外部仓位的具体比例。JIT LP 可以按 Uniswap v4 原生语义参与该次 donate；这是已接受的 LP 分配语义，不增加地址级反 JIT 规则。

毕业时必须存在永久锁定的 canonical 全范围仓位，所以正常市场在任何有效 tick 都有 in-range liquidity。若该不变量被破坏、`donate` 无接收流动性、`take` 无法转出实际资产，或 FeeVault/Gauge credit 失败，afterSwap revert，核心 Swap、Donate 事件、余额转移、feeNonce 和全部会计一起回滚，不允许把 LP 20% 改给平台或稍后补发。

每个市场有一个不可变 LaunchLocker。它对 locked position 的手续费只允许 permissionless compound 回同一 full-range position；不能提款。无法配对使用的单边余额按 Locker 内的 `currency` 隔离，后续 compound 重试。外部 LP 自行管理其仓位与 feeGrowth。

### 4.5 feeId

```text
feeId = keccak256(abi.encode(
    keccak256(bytes("TICKERGARDEN_V2_V4_FEE")),
    uint256(1),
    block.chainid,
    address(FEE_VAULT),
    address(POOL_MANAGER),
    poolId,
    marketId,
    sourceVersion,
    feeNonce,
    feeAsset,
    base,
    T,
    feePolicyHash
))
```

`feeNonce` 按 pool 单调加一，只在成功交易中保留；失败交易回滚 nonce。FeeVault 保存 `consumedFeeId`，重复 finalize 必须 revert。不得用 `tx.origin`、`block.timestamp` 或前端生成的 tradeId 作为唯一性来源。

`feeNonce` 与 curve `sweepNonce` 使用 Solidity checked increment，达到类型上限时 fail closed，绝不回绕或重置。新 Hook/Curve 版本也不能复用旧 `sourceVersion + nonce` 空间。

### 4.6 不支持的收费旁路

V2-EXEC-3 禁止：

- dynamic fee flag、`beforeSwap` fee override 或额外 v4 LP swap fee；
- 先收 Hook 0.8% 再收核心 0.2% 的近似组合；
- 使用 ERC-6909 claim 延后交付 FeeVault；
- Token→Quote 转换、Router、预言机或异步 sweep；
- 第三种 feeAsset；
- FeeVault 通用提款或管理员重定向 recipient。

`manager.take`、`donate` 或实际到账验证失败时选择确定性回滚，而不是切换到另一条结算模式。

## 5. 曲线收费与两阶段毕业

曲线阶段继续使用冻结的 Pons baseline 费率和反狙击费用，只在 Market Quote 中记账；此时无 LP、无 STOCK 质押，曲线实际 non-LP 手续费固定 Creator/Platform 50/50。

反狙击不是一条可由实现者拟合的连续曲线。对非豁免买入 recipient，按 `elapsed = block.timestamp - launchTimestamp` 读取精确整数表：

```text
rawSnipeBps(0)   = 9900
rawSnipeBps(1)   = 618
rawSnipeBps(2)   = 19
rawSnipeBps(>=3) = 0

effectiveSnipeBps = min(
    rawSnipeBps,
    10000 - feeBps - creatorTaxBps - SNIPE_MIN_NET_BPS
)
```

`creatorTaxBps` 在 TickerGarden V2 固定为0；当前 `feeBps=100` 时 effective 表为 `[9800, 618, 19, 0]`。基础费与反狙击费分别对 gross Quote 向下取整，之后才以净 Quote 定价；反狙击只作用于 buy 的 Quote leg。真实 creator、创建时冻结的 creator beneficiary 和 atomic first-buy recipient 自动返回0；不存在任意豁免数组。Pons 文档的5秒、固定仓库源码默认15秒与活跃 runtime 3秒互不一致，因此以 [`spec/v2_pons_runtime_evidence.json`](./spec/v2_pons_runtime_evidence.json) 的固定输出表为唯一依据，不插值、不反推未验证公式。

定价、尾单和毕业供应分区必须使用 [V2_PONS_BEHAVIOR_BASELINE.md](./V2_PONS_BEHAVIOR_BASELINE.md) 的独立整数模型及 `spec/v2_pons_behavior_vectors.json`。特别冻结：

```text
reservedTokens = floor(supply * phantomQuote / (phantomQuote + graduationThreshold))
sellableTokens = supply - reservedTokens
readyToGraduate = !graduated && sellableTokens == 0
```

毕业第一阶段收到的 `sweptTokens` 正常等于 `reservedTokens`，但真正注入 V4 的数量必须再次计算：

```text
poolMemeAmount = floor(
    sweptTokens * sweptQuote / (sweptQuote + phantomQuote)
)
lockedExcessMeme = sweptTokens - poolMemeAmount
```

全部 `sweptQuote` 和 `poolMemeAmount` 用于 full-range position，`lockedExcessMeme` 永久锁定。实现和事件必须分别命名这三个数量，禁止把全部 `reservedTokens` 直接当作入池 Meme。

毕业池参数按以下唯一顺序计算并预检：

```text
currency0/currency1 = 按地址升序排序；native sentinel address(0) 最小
amount0/amount1     = 将 sweptQuote 与 poolMemeAmount 映射到对应 currency

优先 Q192：sqrtPriceX96 = floor(sqrt(FullMath.mulDiv(amount1, 2^192, amount0)))
若 Q192 中间域不适配则使用 Q128：
    sqrtPriceX96 = floor(sqrt(FullMath.mulDiv(amount1, 2^128, amount0))) << 32

tickLower = truncTowardZero(MIN_TICK / tickSpacing) * tickSpacing
tickUpper = truncTowardZero(MAX_TICK / tickSpacing) * tickSpacing
liquidity = LiquidityAmounts.getLiquidityForAmounts(
    sqrtPriceX96, getSqrtPriceAtTick(tickLower), getSqrtPriceAtTick(tickUpper),
    amount0, amount1
)
```

零 amount、Q192/Q128 均不可表示、`sqrtPriceX96` 不严格位于 v4 min/max 之间、amount 超 `int128.max`、liquidity 为0或超过 `tickSpacingToMaxLiquidityPerTick` 均 fail closed，且不得进入 `Swept` 前置提交。mint 使用 exact amount：原生 leg 通过 v4 unlock/settle 并携带精确 `msg.value`，ERC-20 leg 只按实际余额差值、Permit2 allowance 和 exact settle 验收；mint 后 Quote dust 进入协议固定 recipient，Meme dust/excess 进入该市场永久 Locker，不因 dust sweep 失败撤销已成功仓位。native 与 ERC-20 的真实 sweep/pool receipt、sqrtPrice、tick、liquidity 和 permissionless caller 分离见 [`spec/v2_pons_runtime_evidence.json`](./spec/v2_pons_runtime_evidence.json)。

曲线使用独立 `sweepNonce`：

```text
curveFeeId = keccak256(abi.encode(
    keccak256(bytes("TICKERGARDEN_V2_CURVE_SWEEP")),
    uint256(1),
    block.chainid,
    address(FEE_VAULT),
    curve,
    marketId,
    sourceVersion,
    sweepNonce,
    quoteAsset,
    sweptAmount
))
```

每次 permissionless `sweepCurveFees()` 只能在该合约仍是 MarketRegistry 登记的 exact Curve、且 `launchPhase == NotGraduated` 时执行；零累计值是返回0且不创建 feeId 的 no-op。非零时先把累计值置零，再转移实际 Quote 并调用 FeeVault；FeeVault 再核对 caller、sourceVersion、Quote、余额增量和 feeId，任一步失败整笔回滚。最终买入必须在提交 `Swept` 前完成最后一次 sweep，且满足：

Creator beneficiary 变更同样是强制 sweep 边界：`CreatorRevenueRegistry` 必须先在旧 epoch 下原子调用 exact Curve sweep 并确认 `accruedCurveFees == 0`，之后才能 checked 增加 epoch。完整规则见 [V2_CREATOR_REVENUE_EPOCH.md](./V2_CREATOR_REVENUE_EPOCH.md)。

```text
curveAccruedFee == 0
curve fee source == CLOSED
launchPhase == Swept
active fee source == NONE
```

毕业采用可捕获失败的两阶段交易：

```text
outer final buy:
    settle partial fill and refund
    accrue and sweep final curve fee exactly once
    close curve trading/source
    commit launchPhase = Swept
    emit Curve.LaunchSwept(...)
    try GraduationExecutor.graduateFromCurve(marketId) { ... }
    catch { emit AutoGraduationFailed(marketId, reasonHash); }

GraduationExecutor subcall (caller must be the exact registered Curve):
    derive and deploy the market-specific LaunchLocker with CREATE2
    register EXPECTED canonical PoolKey
    PoolManager.initialize -> Hook.beforeInitialize
    mint full-range position directly to LaunchLocker
    verify position and reserves
    activate Hook binding and sourceVersion
    commit launchPhase = PoolCreated
```

Curve 在外层最终结算交易中、清零 tracked reserve 前冻结实际转入 Executor 的 `sweptQuote/sweptTokens`，并通过只读记录供后续校验；该记录与 exact transfer、`markSwept` 同交易原子完成，不属于新增 mutation，也不得由 Executor 聚合余额反推。子调用失败只回滚子调用，外层保留 `Swept`、已关闭曲线、已转入 GraduationExecutor 的资产、冻结记录和已经完成的费用归属。只有 Curve 发出 `LaunchSwept/AutoGraduationFailed`；只有 GraduationExecutor 发出 `PoolGraduated/LaunchRescued`，Router 不发重复摘要事件。

任何人可调用 `retryGraduation(marketId)` 执行同一个内部毕业算法，但只允许 `Swept + ACTIVE + 未 Rescued`。成功时 per-market Locker 的 CREATE2 部署、注册、初始化、锁仓、Hook 激活、`sourceVersion` 增加与 `PoolCreated` 原子完成。七日救援从 `Swept` 的 write-once `sweptAt` 起算，首个允许点为 `>= sweptAt + 604800`，不要求市场仍为 ACTIVE；它只把该市场冻结记录中的双资产精确发送到 GraduationExecutor 部署时冻结的单一 rescue distributor，不接受 caller/creator/admin 提供 recipient。转账与 `Swept -> Rescued` 必须原子完成；Rescued 后永久不能建池或开放 STOCK 分配。

## 6. Vault 市场级 allocation

### 6.1 唯一本金账本

STOCK 本金只存在于 Registry 为 `Asset UID` 解析出的 canonical `UserStockVault`。当前每个 schema 版本只有一个共享 MultiAsset Vault；Gauge 和 AllocationManager 永不持有、approve 或转移 STOCK。

```solidity
mapping(bytes32 assetUid => mapping(address user => uint256)) deposited;
mapping(bytes32 assetUid => mapping(address user => uint256)) allocated;
mapping(bytes32 assetUid => mapping(address user => mapping(bytes32 marketId => uint256))) allocation;
mapping(bytes32 assetUid => mapping(bytes32 marketId => uint256)) marketAllocated;
mapping(bytes32 assetUid => uint256) totalDeposited;
mapping(bytes32 assetUid => uint256) totalAllocated;
```

必须始终满足：

```text
allocated[assetUid][user] <= deposited[assetUid][user]
allocated[assetUid][user] = Σ allocation[assetUid][user][marketId]
marketAllocated[assetUid][marketId] = Σ allocation[assetUid][user][marketId]
totalAllocated[assetUid] = Σ allocated[assetUid][user] = Σ marketAllocated[assetUid][marketId]
totalAllocated[assetUid] <= totalDeposited[assetUid]
Vault balance of canonicalToken(assetUid) >= totalDeposited[assetUid]
allocation[assetUid][user][market] = Gauge effective active + Gauge unprocessed/processed pending
```

等式中的求和是数学不变量，不要求链上遍历；实现通过每次增减同时维护聚合值。事件和 view 可独立重放验证。

### 6.2 原子写入

只有 immutable AllocationManager 可调用 Vault 的 `lockAllocation`、`releaseAllocation` 和 `moveAllocation`。固定顺序：

```text
allocate/increase:
    validate PoolCreated + Market ACTIVE + Asset ACTIVE
    process Gauge matured slots and settle user
    validate resulting position == 0 or > 0.5 STOCK
    Vault.lockAllocation(assetUid, user, market, amount)
    Gauge.addPending(user, amount, now + 30s, now + 24h)

decrease/close:
    require now >= unlockAt
    Gauge.process/materialize/settle/remove first
    Vault.releaseAllocation(assetUid, user, market, same amount)

migrate A -> B:
    prevalidate B completely
    Gauge A process/materialize/settle/remove
    Vault.moveAllocation(assetUid, user, A, B, amount)
    Gauge B process/materialize/settle/addPending
```

任一步失败时 EVM 回滚全部状态。第三方不能替用户增仓或重置其锁定；Router 只能代表 `msg.sender`，底层 ABI 不接受任意 owner/recipient。

### 6.3 普通退出

普通暂停、Asset/Quote 状态变化和市场退休不能扣押本金。只要 `now >= unlockAt`，用户可以减少或清零旧 allocation；释放后 STOCK 先成为该 `assetUid` 的 Vault free balance，随后由用户本人调用 `withdrawFreeStock(assetUid, amount)`。普通退出不把 Token 直接发送到调用者提供的 recipient。

## 7. Gauge 故障与本金逃生

### 7.1 进入 EMERGENCY_EXIT

`EMERGENCY_EXIT` 是终态，不是临时暂停。前提：Market 已离开 `NotGraduated`，且连续处于 `PAUSED` 或 `RETIRED` 至少 24 小时，并由 `RECOVERY_ROLE` 的24小时 AccessManager 延迟操作执行。`NotGraduated` Curve 即使已暂停且满24小时也必须拒绝 Emergency，并保留 delayed unpause 后继续交易或最终结算的路径。唯一外部入口和返回值是：

```solidity
activateEmergencyExit(bytes32 marketId)
    returns (uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash)
```

外部调用者不提供 epoch、snapshot、cap 或 stateHash；Controller 固定使用激活块减1并按规范字段计算 hash。激活交易顺序唯一为：

```text
1. 读取 Registry 的旧 runtime/config，并在任何 Vault/Gauge/Hook 调用前拒绝 `launchPhase == NotGraduated`
2. 读取 Gauge totals 和 FeeVault 当前 Quote/Meme STAKER liabilities
3. checked 计算 recoveryEpoch = oldRecoveryEpoch + 1；snapshotBlock = block.number - 1
4. 用固定字段顺序计算 stateHash
5. FeeVault.freezeRecoveryCaps(...) 重读并冻结两种 exact liability；返回 cap 必须等于第2步读取值
6. Gauge.disableForEmergency(...) 永久禁用旧 Gauge
7. 若存在 ACTIVE Hook binding，Hook.disablePool(...) 将其永久置为 DISABLED
8. Registry.commitEmergencyExit(...) 重新校验 phase，最后提交终态并 checked 增加 sourceVersion/recoveryEpoch
9. Controller 发出 EmergencyExitActivated 并返回 epoch/snapshot/hash
```

任一步失败时整笔交易回滚，因此 Hook/Gauge 的 precondition 明确允许在 Registry 最终 commit 之前、且仅由不可变 Controller 的该原子调用路径执行。`stateHash` 和 `snapshotBlock` 存在 FeeVault 的 recovery snapshot 中；Registry 保存终态、epoch、sourceVersion 并发出 commit 事件。

同一 `marketId` 不允许原地安装 successor Gauge 或恢复旧 Gauge。未来若重新提供服务，必须新建 market/version；这避免 Vault 已释放本金后旧权重再次收取费用。

### 7.2 forceReleaseAllocation

在 `EMERGENCY_EXIT` 中，用户本人可以调用 Vault：

```solidity
forceReleaseAllocation(bytes32 assetUid, bytes32 marketId)
```

固定效果：

```text
amount = allocation[assetUid][msg.sender][marketId]
require(amount > 0)
allocation[assetUid][msg.sender][marketId] = 0        // effects first
allocated[assetUid][msg.sender] -= amount
marketAllocated[assetUid][marketId] -= amount
totalAllocated[assetUid] -= amount
emit AllocationForceReleased(...)
```

它先验证 `market.assetUid == assetUid`，不调用故障 Gauge、不接受 user/recipient 参数、不领取手续费，也不直接转 STOCK。用户之后调用 `withdrawFreeStock(assetUid, amount)`。只有该终态可绕过24小时锁定；`PAUSED` 和 `RETIRED` 本身不能绕过。

进入 Emergency 后，旧 Gauge 的 total/position 仅是冻结历史，不再要求与 Vault allocation 相等，也不得用于新分配或新手续费。非 Emergency 状态下仍必须满足完整等式。

### 7.3 奖励恢复

本金释放不依赖奖励恢复。进入 Emergency 时，FeeVault 对 Quote/Meme 两种资产分别冻结：

```text
recoveryCap[epoch][feeAsset] = market STAKER_REWARD 未支付负债
```

旧 Gauge 的普通 staker claim 永久关闭，Creator/Platform 已确定的历史负债仍可向固定受益人领取。`RECOVERY_ROLE` 可在延迟后 propose 按历史事件和固定 `snapshotBlock` 生成的 Merkle root；proposal 经过48小时挑战期后由任何人 finalize，期间 Guardian 可取消。只有 ACTIVE root 可领取，激活后 root、总额、叶子编码、资产和 epoch 不可修改：

```text
inner = keccak256(abi.encode(
    keccak256(bytes("TICKERGARDEN_V2_RECOVERY_LEAF_V1")),
    uint256(1),
    block.chainid,
    feeVault,
    executionSpecId,
    marketId,
    recoveryEpoch,
    feeAsset,
    user,
    amount
))
leaf = keccak256(bytes.concat(inner))
node = commutativeKeccak256(left, right)
```

每资产 root 的 `declaredTotal <= recoveryCap`；`claimed[user]` 防重复，累计领取不超过 declaredTotal/cap。剩余未声明或未领取金额继续是该市场 staker liability，不能转给平台或另一市场。

Merkle proof 只能证明某领取属于已经 finalize 的 root；root 对历史权重计算是否正确仍需独立重放和审计。这是 Gauge 完全失效时不可消除的治理信任，文档和前端不得把它描述为全自动链上推导。完整生命周期、stateHash 和 Merkle 约定见 [V2_EMERGENCY_RECOVERY_LIFECYCLE.md](./V2_EMERGENCY_RECOVERY_LIFECYCLE.md)。

## 8. 30 秒激活时间轮

### 8.1 固定数据结构

`block.timestamp` 是整数秒，`generation` 直接等于绝对 `activationAt`：

```solidity
uint8 constant WHEEL_SIZE = 32;
uint64 constant ACTIVATION_DELAY = 30;

struct ActivationSlot {
    uint64 generation;       // absolute due timestamp; 0 means empty
    uint256 amount;          // all unprocessed pending due that second
    uint256 refs;            // user pending positions, not STOCK amount
}

struct ActivationSnapshot {
    uint256 quoteAccumulator;
    uint256 memeAccumulator;
    uint256 refs;
    bool processed;
}

struct Position {
    uint256 activeAmount;
    uint256 pendingAmount;
    uint64 pendingGeneration;
    uint64 unlockAt;
    UserReward[2] rewards;
}

ActivationSlot[32] wheel;
mapping(uint64 generation => ActivationSnapshot) snapshots;
```

旧 snapshot 以绝对 generation 为 key，绝不能存在环形槽中或被 `generation % 32` 覆盖。

### 8.2 每次写操作的第一步

每次 fee credit、allocate/increase/decrease/migrate、claim 或 permissionless checkpoint 的第一步都是扫描恰好32槽：

```text
for i = 0 .. 31:
    slot = wheel[i]
    if slot.generation == 0 or slot.generation > block.timestamp: continue

    generation = slot.generation
    amount = slot.amount
    refs = slot.refs
    clear wheel[i]

    totalPendingStock -= amount
    totalActiveStock += amount
    snapshots[generation] = {
        quoteAccumulator: rewardState[QUOTE].accFeePerShare,
        memeAccumulator: rewardState[MEME].accFeePerShare,
        refs: refs,
        processed: true
    }
    emit ActivationBucketProcessed(...)
```

必须在本笔新 fee 更新 accumulator 之前记录 snapshot。因此 `block.timestamp == activationAt` 时，新份额参加本笔费用；`activationAt - 1` 时不参加。

禁止从 `lastProcessedTimestamp` 逐秒循环到当前时间。市场空闲一年后的第一笔交易仍只扫描32槽。

### 8.3 登记和重置 pending

所有成熟槽先处理。新增 pending 固定：

```text
due = uint64(block.timestamp + 30)
slotIndex = uint8(due % 32)
```

若用户没有 pending，向对应 slot 增加 `amount` 和一个 `refs`。若有未成熟 pending，先从旧 slot 减去旧 amount 和一个 ref；把旧 pending 与新增数量合并，登记到新的 due，并重置 `unlockAt = now + 24h`。旧 slot 归零时清空。

若旧 pending 对应 snapshot 已 processed，必须先按旧 snapshot 懒物化，再为新增 delta 创建新 pending。

目标 slot 规则：

```text
slot.generation == 0        → initialize with due
slot.generation == due      → aggregate
otherwise                   → revert ActivationSlotCollision
```

不得覆盖或自动合并不同 generation。

### 8.4 环形无冲突证明

每次成功写操作先处理所有 `generation <= now` 的槽。处理后，旧未成熟 generation 只可能位于 `(now, now + 29]`；本次新 generation 为 `now + 30`。因此同时存活的绝对 generation 跨度小于32秒。

若两个不同 generation 的 `% 32` 相同，它们至少相差32秒，与上述范围矛盾。所以在正确实现中不会冲突；显式 generation 检查用于异常 fail closed，而不是依赖未经验证的覆盖。

### 8.5 用户懒物化

bucket 到期时只移动全局总量，不遍历用户。用户下次操作时，若 snapshot 已 processed：

1. 用用户旧 paid index 结算旧 `activeAmount`；
2. 用 snapshot index 结算 `pendingAmount` 从 activation 边界到当前的收益；
3. 把 pending 合并为 active；
4. snapshot.refs 减一，归零时删除；
5. 两资产 paid index 设为当前值。

对每种 feeAsset 独立执行，且可用同一个用户 remainder 顺序合并两项：

```text
settleTerm(activeAmount, currentAcc - userPaidAcc)
settleTerm(pendingAmount, currentAcc - snapshotAcc)
```

因此必须区分：

```text
stored user active       = position.activeAmount
effective user active    = activeAmount + (snapshot.processed ? pendingAmount : 0)
stored totalActiveStock  = 已处理 bucket 后的全局有效量
projected active now     = totalActiveStock + Σ wheel 中 generation <= now 的 amount
```

写操作先 checkpoint，所以写操作使用的 stored total 与经济有效总量一致。View 可以扫描32槽返回 projected 值，不能把尚未 checkpoint 的全局存储值误标为“当前有效量”。

snapshot 可能因用户永久不再操作而长期存在；其数量受仍引用 snapshot 的未物化仓位约束，不按交易历史扫描，也不增加单笔 Gas。若要让链上状态总量也严格有界，只能牺牲精确收益、无限期懒操作或引入强制物化，本版本不做这种改变。

## 9. 双资产累加器

Quote 和 Meme Token 各自独立维护：

```text
accFeePerShare
indexRemainder
user.accumulatorPaid
user.pendingFee
user.userRemainder
```

`P = 1e27`。某资产收到质押者份额 `R`，处理成熟槽后有效总量为 `S`：

```text
if R == 0: no-op
if S == 0: invalid staker credit; the linear formula must have produced R == 0

carry = floor(indexRemainder / S)
normalized = indexRemainder % S
whole = mulDiv(R, P, S)
fraction = mulmod(R, P, S)
merged = normalized + fraction

accFeePerShare += carry + whole + floor(merged / S)
indexRemainder = merged % S
```

每次更新满足：

```text
R × P + oldIndexRemainder
= accumulatorDelta × S + newIndexRemainder
```

用户 `settleTerm(amount, deltaAcc)`：

```text
whole = mulDiv(amount, deltaAcc, P)
fraction = mulmod(amount, deltaAcc, P)
merged = userRemainder + fraction
pendingFee += whole + floor(merged / P)
userRemainder = merged % P
```

修改 active 份额前必须分别结算两资产。池级 remainder 允许在 S 改变后先通过 `div/mod` 归一化；用户 remainder 在 claim、减仓、暂时清零后继续归属于同一 user/market/asset。不同资产、市场或用户的 remainder 永不合并。

## 10. 10 STOCK饱和的线性手续费分桶

FeeVault 在实际收到 `D` 且先完成 activation checkpoint 后读取：

```text
S = Gauge.totalActiveStock
B = MarketConfig.stakeSaturationAmount
  = 10 × 10^stockDecimals
E = min(S, B)
```

`B` 在市场创建时由 Factory 根据 Registry 冻结的 `stockDecimals` 派生并写入不可变 MarketConfig；创建者不能传入或覆盖。`B` 同时进入 `expectedEconomics` 和创建事件。固定整数公式：

```text
stakerAmount = floor(D × E / (2 × B))
remaining = D - stakerAmount
creatorAmount = floor(remaining / 2)
platformAmount = remaining - creatorAmount
```

与 LP 一起：

```text
L + D == T
creatorAmount + stakerAmount + platformAmount == D
```

`S = 0` 得到总手续费近似 `Creator 40 / Staker 0 / Platform 40 / LP 20`；`0 < S < B` 时 Staker 从0线性释放至40%，Creator 与 Platform 对称下降；`S >= B` 得到 `20 / 40 / 20 / 20`。`S` 超过 `B` 仍全部参与 Staker Bucket 内部按 `userActiveStock / S` 的分配，只是不再扩大 Staker 总 Bucket。整数余数按公式固定归 Platform。Quote 和 Meme Token 分别执行，不转换；STOCK 价格不参与计算。

在最低合法仓位严格大于0.5 STOCK时，`E/B` 略高于5%，所以 Staker 总份额略高于总手续费2%，不会从0跳到40%。改变 `10` 或 `LINEAR_CAPPED` 算法必须升级 FeePolicy、Factory 与 `executionSpecId`，不得影响既有市场。

## 11. 完整状态机

市场不可变快照、`LaunchPhase`、`MarketStatus`、`poolId`、`sourceVersion`、`sweptAt/statusSince` 与 `recoveryEpoch` 的唯一权威是 `MarketRegistryV2`。其他模块不得保存可独立决定这些值的副本，只能调用 Registry 的语义化迁移入口。规范性 schema、唯一 caller 与原子写入顺序见 [V2_MARKET_REGISTRY_STATE_MODEL.md](./V2_MARKET_REGISTRY_STATE_MODEL.md)；机器约束见 `spec/v2_execution_manifest.json.stateAuthority`。

### 11.1 枚举与迁移

```text
AssetStatus: UNSET -> ACTIVE <-> PAUSED -> RETIRED
QuoteStatus: UNSET -> ACTIVE <-> PAUSED -> RETIRED
BaselineStatus: UNSET -> ACTIVE <-> PAUSED -> RETIRED

LaunchPhase:
    NotGraduated -> Swept -> PoolCreated
                           -> Rescued

MarketStatus:
    ACTIVE -> PAUSED -> ACTIVE
       |        |  \-> RETIRED -> EMERGENCY_EXIT
       |        \----> EMERGENCY_EXIT
       \------------> RETIRED
```

约束：

- `UNSET → ACTIVE` 只在追加式 Asset/Quote/Baseline 注册时发生；同一 config/id 不覆盖；
- PAUSE 可立即执行，UNPAUSE 延迟24小时；
- RETIRED 终止新业务，不能回到 ACTIVE，但可升级为 EMERGENCY_EXIT；
- EMERGENCY_EXIT 终态；
- PoolCreated 和 Rescued 均为 LaunchPhase 终态；
- `Swept → Rescued` 必须满足冻结的 Pons 七日等待；
- `sweptAt` 在进入 Swept 时写一次，首个救援边界为 `block.timestamp >= sweptAt + 604800`，暂停/退休不重置；
- `statusSince` 表示当前状态起点，`restrictedSince` 表示连续 PAUSED/RETIRED 起点；`PAUSED → RETIRED` 保持后者，恢复 ACTIVE 才清零；
- LaunchPhase 与 MarketStatus 是独立维度但不是无约束笛卡尔积：`NotGraduated` 只允许 `ACTIVE/PAUSED`，`RETIRED/EMERGENCY_EXIT` 必须已经离开 Curve 阶段；
- LaunchPhase、MarketStatus、AssetStatus 和 QuoteStatus 是不同维度，不能用一个 bool 代替。

### 11.2 操作矩阵

| 操作 | NotGraduated + ACTIVE | Swept + ACTIVE | PoolCreated + ACTIVE | Market PAUSED | RETIRED | EMERGENCY_EXIT |
|---|---:|---:|---:|---:|---:|---:|
| 曲线交易 | 允许 | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 |
| permissionless 曲线费 sweep | 允许 | 仅清理已存在余额 | 不适用 | 允许 | 允许 | 允许 |
| retry graduation | 不适用 | 允许 | 不适用 | 禁止 | 禁止 | 禁止 |
| v4 pool swap | 禁止 | 禁止 | 允许 | 禁止 | 禁止 | 禁止 |
| STOCK deposit | 取决于 Asset ACTIVE | 取决于 Asset ACTIVE | 取决于 Asset ACTIVE | 取决于 Asset ACTIVE | 取决于 Asset ACTIVE | 取决于 Asset ACTIVE |
| allocate/increase/migrate-in | 禁止 | 禁止 | Asset ACTIVE 时允许 | 禁止 | 禁止 | 禁止 |
| checkpoint/mature pending | 无仓位 | 无仓位 | 允许 | 允许 | 允许 | 旧 Gauge 冻结 |
| claim staker via Gauge | 无 | 无 | 允许 | 允许 | 允许 | 禁止；改走 recovery |
| claim Creator/Platform 历史负债 | 允许 | 允许 | 允许 | 允许 | 允许 | 允许 |
| 正常 decrease/close/migrate-out | 无 | 无 | 满24h允许 | 满24h允许 | 满24h允许 | 禁止；改走 force release |
| withdraw free STOCK | 允许 | 允许 | 允许 | 允许 | 允许 | 允许 |
| forceReleaseAllocation | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 | 仅本人允许 |
| recovery claim | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 | root 激活后允许 |

其中 `NotGraduated + PAUSED` 仍可执行既有余额的 permissionless fee sweep，并可经 delayed unpause 返回 ACTIVE；`NotGraduated + RETIRED` 与 `NotGraduated + EMERGENCY_EXIT` 为非法组合，表中 RETIRED/Emergency 行为只适用于已经离开 Curve 阶段的市场。

Asset PAUSED/RETIRED 阻止新市场、STOCK deposit、allocate/increase/migrate-in，但不自动暂停既有 Meme 交易；Guardian 必须显式暂停受影响 market。Quote PAUSED/RETIRED 只阻止新市场，不隐式改写历史市场；历史市场若需停盘也使用 Market PAUSE。两种 Registry 状态均不阻止已到账费用领取、pending 到期、正常退出或 free STOCK 提取。

## 12. 权限模型

系统使用 OpenZeppelin v5.7.0 `AccessManager`，按 `target + selector` 授权。部署 EOA 完成配置后必须撤销自身权限；不存在单一 EOA owner。

selector 一律从最终编译接口的 canonical ABI signature 计算 `bytes4(keccak256(signature))`；结构体参数必须展开为 ABI tuple，不能对文档中的 Solidity 类型别名直接哈希。部署脚本读取编译 artifact 后，与机器权限矩阵逐项比对 target、selector、role 和 delay，任何缺项或额外 mutation selector 都阻止部署。

| 角色 | 成员 | 执行延迟 | 能做什么 | 明确不能做什么 |
|---|---|---:|---|---|
| `PROTOCOL_ADMIN_ROLE` | 治理 Safe | 48h | 新增 baseline/config、退役、管理四个既有V2角色成员 | 即时暂停、任意提款、改写既有 economics 或重配 target selector |
| `PAUSE_GUARDIAN_ROLE` | 独立 Guardian Safe | 0 | pause Asset/Quote/Market、取消延迟操作 | unpause、retire、emergency、转资产 |
| `UNPAUSE_ROLE` | 治理/安全 Safe | 24h | unpause | 修改 economics、提款 |
| `RECOVERY_ROLE` | Recovery Safe | 24h | 满足状态等待后激活 Emergency；发布受 cap 限制的 root | 任意用户 allocation、超 cap 发放 |
| `FACTORY_MODULE_ROLE` | immutable Factory | 0 | 创建/登记 market | 修改已创建 market |
| `GRADUATION_MODULE_ROLE` | immutable Executor | 0 | EXPECTED Pool、毕业子调用、Hook 激活 | 任意池绑定、费用提款 |
| `ALLOCATION_MODULE_ROLE` | immutable AllocationManager | 0 | Vault/Gauge 原子 allocation | 持有或转移 STOCK 到第三方 |
| `FEE_SOURCE_MODULE_ROLE` | Registry 验证的 Curve/Hook | 0 | 实际到账 credit | 任意 feeAsset/market/recipient |

部署期唯一 `ADMIN_ROLE` 必须先完成全部 target selector 与Guardian安装，再授予四个Safe角色，并把四个V2 role admin固定为`PROTOCOL_ADMIN_ROLE`，最后撤销自身。OpenZeppelin内建的`setTargetFunctionRole`、`setRoleAdmin`、`setRoleGuardian`、`updateAuthority`等全局管理入口不受普通target selector映射替代；撤销最后一个`ADMIN_ROLE`后这些入口永久锁定。`grantRole/revokeRole`则按被管理角色的role admin判定，因此四个既有V2角色的成员变更仍只能由治理Safe经过48小时调度执行。

热路径不用可变治理授权，使用 immutable/direct checks：

```text
Hook callbacks                  -> only PoolManager
Hook pool registration/activate -> only GraduationExecutor
Vault allocation mutators       -> only AllocationManager
Gauge position mutators         -> only AllocationManager
Gauge reward credit/consume     -> only FeeVault
FeeVault v4 begin/finalize       -> only registered ACTIVE Hook + exact sourceVersion
FeeVault curve credit            -> only registered Curve + exact sourceVersion
```

`claimFor(user, ...)`、checkpoint、retry graduation、curve sweep 和 locked-fee compound 可以 permissionless，因为 recipient、PoolKey、资产和结果都由存储固定。任何 claim、withdraw 或 forceRelease 均不接受任意 recipient。

完整 selector 级矩阵以 [spec/v2_permissions_matrix.json](./spec/v2_permissions_matrix.json) 为准。

ABI alias、caller、执行延迟与业务状态等待不得混写。规范性展开规则见 [V2_CANONICAL_ABI_POLICY.md](./V2_CANONICAL_ABI_POLICY.md)；`spec/v2_canonical_abi.json` 是由 ABI surface 与权限矩阵生成的派生清单，`spec/interfaces/IV2MutationSurfaceDraft.sol` 是 M0 期间的 Solidity mutation interface 草案。七日 rescue 是从 Registry `sweptAt` 起算的 `604800` 秒状态等待，不是 AccessManager 执行延迟。

## 13. 冻结 ABI

以下是 V2-EXEC-3 的最小完整外部边界。结构体字段和事件必须与机器可读 ABI 清单一致；实现可以增加纯 view，但不得增加改变资金、状态或 recipient 的旁路。

### 13.0 Registry、Factory 与 Curve

规范性结构体字段见机器清单；mutation 入口固定为：

```solidity
// append-only registries
registerAsset(bytes32 assetUid, address stockToken, uint8 decimals, address vault)
pauseAsset(bytes32 assetUid, bytes32 reasonHash)
unpauseAsset(bytes32 assetUid)
retireAsset(bytes32 assetUid, bytes32 reasonHash)

addQuoteConfig(bytes32 configId, QuoteAssetConfig config)
pauseQuote(bytes32 configId, bytes32 reasonHash)
unpauseQuote(bytes32 configId)
retireQuote(bytes32 configId, bytes32 reasonHash)

addBaseline(bytes32 baselineId, PonsBaseline baseline)
pauseBaseline(bytes32 baselineId, bytes32 reasonHash)
unpauseBaseline(bytes32 baselineId)
retireBaseline(bytes32 baselineId, bytes32 reasonHash)

addLaunchTemplate(bytes32 launchTemplateId, LaunchTemplate template)
pauseLaunchTemplate(bytes32 launchTemplateId, bytes32 reasonHash)
unpauseLaunchTemplate(bytes32 launchTemplateId)
retireLaunchTemplate(bytes32 launchTemplateId, bytes32 reasonHash)

// launch
createMarket(CreateMarketParams params)
createMarketFor(address creator, CreateMarketParams params) // immutable LaunchAndBuyRouter only
launchAndBuy(CreateMarketParams params, uint256 firstBuyAmount, uint256 minTokensOut, address recipient)
previewMarketEconomics(CreateMarketParams params) view returns (bytes32)
predictMarketAddresses(address creator, CreateMarketParams params)
    view returns (bytes32 marketId, address memeToken, address curve, address gauge, address launchLocker)
launchFee() view returns (uint256)

// MarketRegistryV2 module-only canonical mutations
registerMarket(bytes32 marketId, MarketConfig config)                         // Factory only
markSwept(bytes32 marketId)                                                   // exact registered Curve only
commitPoolCreated(bytes32 marketId, bytes32 poolId)                           // GraduationExecutor only
markRescued(bytes32 marketId)                                                 // GraduationExecutor only
setMarketPaused(bytes32 marketId, bytes32 reasonHash)                         // MarketController only
setMarketActive(bytes32 marketId)                                             // MarketController only
setMarketRetired(bytes32 marketId, bytes32 reasonHash)                        // MarketController only
commitEmergencyExit(bytes32 marketId, uint64 snapshotBlock, bytes32 stateHash) // MarketController only

// canonical discovery views
canonicalPoolKey(bytes32 marketId) view returns (PoolKey)
canonicalPoolId(bytes32 marketId) view returns (bytes32)
canonicalRoute(bytes32 marketId) view returns (CanonicalRoute)

// per-market Pons-compatible curve
buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
sweepCurveFees()
quoteBuy(uint256 quoteIn, address recipient) view returns (uint256 tokensOut, uint256 quoteSpent, uint256 refund)
quoteSell(uint256 tokensIn) view returns (uint256 quoteOut, uint256 fee)
getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)
realQuoteReserve() view returns (uint256)
sellableTokens() view returns (uint256)
reservedTokens() view returns (uint256)
readyToGraduate() view returns (bool)
```

`CanonicalRoute` 是客户端唯一的交易发现入口：它返回完整 `PoolKey`、预期 `poolId`、部署时冻结的标准 v4 Router/Quoter、Hook、Quote、Meme Token、Gauge、Curve、GraduationExecutor 预测的 LaunchLocker、`sourceVersion`、`launchPhase`、`marketStatus`，以及由 Registry 计算的 `curveTradingEnabled` / `poolTradingEnabled`。PoolCreated 前 `poolId` 是预期值而 runtime `poolId` 仍为零；PoolCreated 后 view 必须确认 runtime poolId、实际 Locker code、Locker marketId 与 locked position poolId 全部一致，否则 fail closed。未知市场、零 Locker 预测或身份漂移均 revert。PAUSED、RETIRED、EMERGENCY_EXIT、SWEPT 与 RESCUED 不得由客户端自行解释为可交易状态，两类 enabled 标志均由合约确定。

Registry economics/config 字段 append-only；pause/unpause/retire 只改变门禁状态。Trade recipient 可以由用户指定，因为它是用户主动交易的收款对象；“禁止任意 recipient”专指 Vault 本金、手续费 claim、force release、平台/创建者负债和 recovery 资产。

V2 首发 mutation ABI 只提供上述单市场入口，永久不提供 `batch*`、`claimAll`、`withdrawAllMarkets` 或 `migrateAll`。后续版本若增加批量能力，必须使用新 `executionSpecId`、有界数组、Gas 基准和新增 ABI/权限审计；不得在 V2-EXEC-3 实现中静默加入。

### 13.1 UserStockVault

```solidity
depositStock(bytes32 assetUid, uint256 amount)
depositStockFor(bytes32 assetUid, address user, uint256 amount) // AllocationManager only; user is outer caller
withdrawFreeStock(bytes32 assetUid, uint256 amount)
forceReleaseAllocation(bytes32 assetUid, bytes32 marketId)

lockAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount) // AllocationManager only
releaseAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount) // AllocationManager only
moveAllocation(bytes32 assetUid, address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount) // manager only

deposited(bytes32 assetUid, address user) view returns (uint256)
allocated(bytes32 assetUid, address user) view returns (uint256)
allocation(bytes32 assetUid, address user, bytes32 marketId) view returns (uint256)
freeBalanceOf(bytes32 assetUid, address user) view returns (uint256)
marketAllocated(bytes32 assetUid, bytes32 marketId) view returns (uint256)
totalDeposited(bytes32 assetUid) view returns (uint256)
totalAllocated(bytes32 assetUid) view returns (uint256)
vaultIdentity() view returns (address officialStockRegistry, address marketRegistry, address allocationManager, bytes32 schemaId)
```

`assetUid` 必须非零且在 OfficialStockRegistry 中解析到当前 Vault；调用者不能提交 Token 地址。Registry 通过 `vaultSchemaId(vault)` 与 `vaultForSchema(schemaId)` 强制每个 schema 一个 canonical Vault。所有调用保持单资产 O(1)，不得因 Registry 中资产增加而遍历目录。

### 13.2 AllocationManager

```solidity
allocate(bytes32 marketId, uint256 amount)
increaseAllocation(bytes32 marketId, uint256 amount)
decreaseAllocation(bytes32 marketId, uint256 amount)
closeAllocation(bytes32 marketId)
migrateAllocation(bytes32 fromMarketId, bytes32 toMarketId, uint256 amount)
depositAndAllocate(bytes32 marketId, uint256 depositAmount, uint256 allocationAmount)
```

全部动作只作用于 `msg.sender`，无 user/recipient 参数。

### 13.3 MemeStockGauge

```solidity
addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) // manager only
removeAllocation(address user, uint256 amount)                                // manager only
checkpointActivations()                                                        // public
settle(address user)                                                           // manager/FeeVault
creditStakerFee(address feeAsset, uint256 amount, bytes32 feeId)               // FeeVault only
consumeClaimable(address user, address feeAsset) returns (uint256)             // FeeVault only

positionOf(address user) view returns (PositionView)
rewardState(address feeAsset) view returns (RewardStateView)
storedTotalActiveStock() view returns (uint256)
effectiveTotalActiveStock() view returns (uint256) // scans fixed32 slots
totalPendingStock() view returns (uint256)
activationSlot(uint8 index) view returns (ActivationSlot)
activationSnapshot(uint64 generation) view returns (ActivationSnapshot)
```

### 13.4 TickerGardenMemeHook

```solidity
registerExpectedPool(bytes32 marketId, PoolKey key, uint32 sourceVersion) // GraduationExecutor only
activatePool(bytes32 poolId)                                              // GraduationExecutor only
disablePool(bytes32 poolId)                                               // MarketController emergency only

beforeInitialize(address sender, PoolKey key, uint160 sqrtPriceX96)
afterSwap(address sender, PoolKey key, SwapParams params, BalanceDelta delta, bytes hookData)

marketOfPool(bytes32 poolId) view returns (bytes32)
poolBinding(bytes32 poolId) view returns (PoolBinding)
hookPermissionMask() pure returns (uint160) // 0x2044
```

### 13.5 ProtocolFeeVault

```solidity
beginV4Credit(bytes32 marketId, address feeAsset, uint256 amount, uint32 sourceVersion, bytes32 feeId)
finalizeV4Credit(bytes32 marketId, address feeAsset, uint256 base, uint256 totalFee,
                 uint256 lpAmount, uint256 nonLpAmount, uint64 feeNonce, bytes32 feeId)
creditCurveSweep(bytes32 marketId, address quoteAsset, uint256 amount,
                 uint32 sourceVersion, uint64 sweepNonce, bytes32 feeId)

claimCreator(bytes32 marketId, uint32 creatorEpoch, address feeAsset)
claimPlatform(bytes32 marketId, address feeAsset)
claimStaker(bytes32 marketId, address feeAsset)
claimStakerFor(address user, bytes32 marketId, address feeAsset)

freezeRecoveryCaps(bytes32 marketId, uint32 recoveryEpoch,
                   uint64 snapshotBlock, bytes32 stateHash)
    returns (uint256 quoteCap, uint256 memeCap) // MarketController only

proposeRecoveryRoot(bytes32 marketId, uint32 epoch, address feeAsset,
                    bytes32 root, uint256 declaredTotal)
cancelRecoveryRoot(bytes32 marketId, uint32 epoch, address feeAsset, uint32 proposalNonce)
finalizeRecoveryRoot(bytes32 marketId, uint32 epoch, address feeAsset, uint32 proposalNonce)
claimRecovery(bytes32 marketId, uint32 epoch, address feeAsset,
              uint256 amount, bytes32[] proof)

liability(bytes32 marketId, address feeAsset, BucketType bucket) view returns (uint256)
creatorLiability(bytes32 marketId, uint32 creatorEpoch, address feeAsset) view returns (uint256)
recoverySnapshot(bytes32 marketId, uint32 recoveryEpoch) view returns (uint64 snapshotBlock, bytes32 stateHash)
totalLiability(address feeAsset) view returns (uint256)
consumedFeeId(bytes32 feeId) view returns (bool)
```

Creator/Platform claim 的实际收款人从不可歧义的 epoch beneficiary/treasury 存储读取；Staker/recovery 固定支付 user。当前 beneficiary 只能在旧 epoch Curve fee 原子 sweep 完成后调用 `transferCreatorRevenueBeneficiary(marketId,newBeneficiary)` 迁移未来收入；历史负债按 `marketId + creatorEpoch + feeAsset` 留给原 beneficiary，管理员无 override。

### 13.6 MarketController、Graduation、Locker

```solidity
pauseMarket(bytes32 marketId, bytes32 reasonHash)
unpauseMarket(bytes32 marketId)
retireMarket(bytes32 marketId, bytes32 reasonHash)
activateEmergencyExit(bytes32 marketId)
    returns (uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash)

graduateFromCurve(bytes32 marketId) // exact registered Curve only
retryGraduation(bytes32 marketId)
rescueSweptLaunch(bytes32 marketId)
predictLaunchLocker(bytes32 marketId) view returns (address)

// each immutable LaunchLocker is bound to exactly one market
compoundLockedFees()
marketId() view returns (bytes32)
lockedPosition() view returns (uint256 tokenId, bytes32 poolId)
unpairedLockedBalance(address currency) view returns (uint256)

marketStatus(bytes32 marketId) view returns (MarketStatus)
launchPhase(bytes32 marketId) view returns (LaunchPhase)
isStockAllocationOpen(bytes32 marketId) view returns (bool)
```

完整函数、事件和 caller 列表见 [spec/v2_abi_surface.json](./spec/v2_abi_surface.json)。

## 14. 必须事件

至少发出：

```text
MarketCreated(marketId, assetUid, memeToken, curve, gauge, quoteAsset, stakeSaturationAmount, ponsBaselineId, quoteAssetConfigId, expectedEconomics)
ExpectedPoolRegistered(marketId, poolId, keyHash, sourceVersion)
PoolBindingActivated(marketId, poolId, sourceVersion)
V4FeeAccrued(marketId, poolId, feeAsset, feeNonce, feeId, base, T, L, D)
FeeBucketsCredited(marketId, creatorEpoch, feeAsset, feeId, creatorAmount, stakerAmount, platformAmount, activeStock, stakeSaturationAmount)
CurveFeeTransferred(marketId, sweepNonce, feeId, amount)
CurveFeesSwept(marketId, creatorEpoch, quoteAsset, sweepNonce, feeId, amount, creatorAmount, platformAmount)

StockDeposited(assetUid, user, amount)
StockWithdrawn(assetUid, user, amount)
StockVaultRegistered(userStockVault, schemaId, marketRegistry, allocationManager)
AllocationLocked(assetUid, user, marketId, amount, userMarketAllocation, userTotalAllocated)
AllocationReleased(assetUid, user, marketId, amount, userMarketAllocation, userTotalAllocated)
AllocationMoved(assetUid, user, fromMarketId, toMarketId, amount)
AllocationForceReleased(assetUid, user, marketId, amount, recoveryEpoch)

PendingScheduled(user, marketId, amount, generation, unlockAt)
PendingRescheduled(user, marketId, oldGeneration, newGeneration, combinedAmount, unlockAt)
ActivationBucketProcessed(marketId, generation, amount, quoteAcc, memeAcc, refs)
PendingMaterialized(user, marketId, generation, amount)
StakerFeeCredited(marketId, feeAsset, feeId, amount, accDelta, remainder)
FeeClaimed(beneficiaryType, beneficiary, marketId, beneficiaryEpoch, feeAsset, amount)

MarketStatusChanged(marketId, oldStatus, newStatus, reasonHash)
EmergencyExitActivated(marketId, recoveryEpoch, snapshotBlock, stateHash, quoteCap, memeCap)
RecoveryCapsFrozen(marketId, recoveryEpoch, snapshotBlock, stateHash,
                   quoteAsset, quoteCap, memeAsset, memeCap)
RecoveryRootProposed(marketId, recoveryEpoch, feeAsset, proposalNonce, root, declaredTotal, finalizableAt)
RecoveryRootCancelled(marketId, recoveryEpoch, feeAsset, proposalNonce)
RecoveryRootFinalized(marketId, recoveryEpoch, feeAsset, proposalNonce, root, declaredTotal)
RecoveryClaimed(marketId, recoveryEpoch, feeAsset, user, amount)
AutoGraduationFailed(marketId, reasonHash)
LaunchSwept(marketId, quoteAsset, sweptQuote, sweptTokens, sweptAt)
PoolGraduated(marketId, poolId, launchLocker, sweptQuote, sweptTokens,
              poolMemeAmount, lockedExcessMeme, sourceVersion)
```

Indexer 可以从事件重建列表，但事件不是资金权威；链上 view、余额和不变量必须可独立核对。

## 15. 异常原子性

| 异常 | 唯一结果 |
|---|---|
| 错误 PoolKey/Hook 位/未注册 pool | initialize 或 swap revert |
| v4 core lpFee/protocolFee 非零 | afterSwap revert，整个 Swap 回滚并建议暂停 |
| `T` 超 int128、数学溢出 | revert |
| donate 无流动性或失败 | Swap、feeNonce、所有 credit 回滚 |
| PoolManager `take` 失败 | 全部回滚；不切换 ERC-6909 |
| FeeVault 实际余额增量不等于 D | 全部回滚 |
| activation 槽 generation 冲突 | 全部回滚，绝不覆盖 |
| Gauge/FeeVault checkpoint 或 accumulator 失败 | Swap/用户操作全部回滚 |
| claim 某资产 transfer 失败 | 该 claim 回滚；其他资产可单独 claim |
| 自动毕业建池失败 | 外层保留 Swept；子调用全部回滚；允许 retry |
| Market PAUSED/RETIRED | 新交易/新增 allocation revert；旧 claim/到期退出继续 |
| Gauge 完全故障 | 延迟进入终态 Emergency；本金不依赖 Gauge force release；奖励走 capped root |
| Quote/STOCK Token 自身停止 transfer | 对该资产操作失败；不得用其他资产补洞 |

## 16. 形式化不变量与测试门槛

生产候选至少证明或 fuzz：

1. 每笔 v4 收费 `T = L + D`，Hook 瞬时 delta 为零；
2. `creator + staker + platform = D`，每资产 FeeVault 余额覆盖全部负债；
3. `PoolKey.fee == slot0.lpFee == slot0.protocolFee == 0` 才允许 Swap 成功；
4. 每个成功 feeId 唯一，失败交易不留下 nonce/credit；
5. 任意 Vault 操作序列满足 allocation 聚合等式；
6. 同一 STOCK 不在两个 Gauge 重叠计奖；
7. 每个非零仓位严格大于0.5 STOCK；
8. `totalPendingStock == Σ 未处理 slot.amount`；
9. `totalActiveStock == Σ user.active + Σ 已处理未物化 pending`；
10. 每用户每市场至多一个 pending generation；
11. processed snapshot 不修改，refs 精确，refs 为零才删除；
12. 边界 fee 在 activation snapshot 之后记账；
13. 32槽扫描 Gas 不随空闲时间、用户数或历史 generation 增长；
14. 两资产 accumulator/remainder 完全隔离且各自守恒；
15. Emergency 后旧 Gauge/source 永不恢复，force release 不能释放他人本金；
16. recovery 每资产累计不超过冻结 cap，且 leaf 不可跨链、跨市场、跨 epoch 或跨资产重放；
17. 状态迁移只允许本文列出的有向边；
18. 每个受限 ABI selector 的实际 caller/delay 与机器权限矩阵相同。
19. `reservedTokens + initialSellableTokens == initialSupply`，且曲线存续时 tracked token 不低于 reserved floor；
20. `poolMemeAmount + lockedExcessMeme == sweptTokens`，真正入池数量严格使用去除 phantom Quote 的二次公式；
21. buy/sell、尾单 `quoteSpent/refund` 与两条 Quote fee leg 在每个整数单位上守恒；
22. Curve/Token/Gauge/LaunchLocker 的 `predictMarketAddresses` 结果逐个等于 CREATE2 实际地址；前三者在创建时部署，Locker 在毕业子调用中部署，碰撞不允许自动换 nonce。

### 16.1 冻结数值域

[`spec/v2_numeric_bounds.json`](./spec/v2_numeric_bounds.json) 是通用 admission 与算术边界的机器权威：

```text
6 <= admitted asset decimals <= 18
canonical STOCK supply and reward/accounting amount <= int128.max
post-graduation fee base <= 17014118346046923173168730371588410572799
per market + fee asset lifetime fee credits <= 2^48 - 1
minimum nonzero position = floor(10^stockDecimals / 2) + 1
stakeSaturationAmount = 10 × 10^stockDecimals
```

所有加减、nonce、`sourceVersion/recoveryEpoch` 和 `uint64` 时间相加都先做边界检查再写状态；`activationAt` 最晚只能从 `uint64.max-30` 调度。供应分区、曲线报价、尾单 gross-up、毕业二次分区、Q192/Q128、LiquidityAmounts、手续费分桶、池级 index 与用户 settlement 必须使用已冻结的 full-precision `mulDiv/mulmod` 语义。向上取整不得用可能溢出的 `numerator + denominator - 1`；尾单滑点必须比较两个完整 512-bit 乘积。任何 production manifest 资产若超出该 admission domain 必须拒绝，不能缩窄、饱和或截断。

全量官方 STOCK 使用同一个 raw-balance 会计模型，不需要逐资产价格或目标向量。当前观测194项 ACTIVE 官方资产均可选择为 Base；生产登记前只需重新固定 Asset UID、canonical token、decimals、状态和代理实现证据。

最低测试向量包括 Pons-compatible `amountOut/amountIn`、buy/sell fee 顺序、尾单部分成交/退款、runtime `[9900,618,19,0]` 反狙击表、reserved/swept/pool/locked 四类供应数量、两条真实 native/ERC-20 graduation receipt、CREATE2 四组件地址，四种 v4 swap 组合、最小整数、uint256/int128/uint64 极值、29/30/31秒、24小时边界、32槽全满与一年空闲、generation 复用、同秒大量用户、连续 pending 重置、Quote/Meme 双 fee 顺序、`S=0`、`0<S<B`、`S=B`、`S>B`、线性取整、pause/retire/emergency、自动毕业失败重试、重复 feeId/root claim，以及 locked/external LP 并存下 donate。

## 17. 部署前清单

不得仅凭本文部署。唯一发布状态与 open gate 以 [V2_READINESS_AND_DEPLOYMENT_GATES.md](./V2_READINESS_AND_DEPLOYMENT_GATES.md) 和 `spec/v2_execution_manifest.json.readiness` 为准；当前为 `IMPLEMENTATION_ALLOWED`，允许实现但不允许部署。部署/生产签字还需要：

- 使用 finalized-state RPC 对拟登记的官方 Asset UID、token、decimals、状态及代理实现重新取证；该检查不读取 STOCK 价格，也不按 Feed 覆盖筛选资产；
- 以已批准 native/USDG 配置生成部署 manifest，并在部署前重取 USDG proxy/implementation codehash，发现漂移即拒绝；
- 从最终 TickerGarden Solidity artifact 生成并核对 ABI、代码哈希和完整 CREATE2 向量；
- Hook CREATE2 地址低14位验证；
- PoolManager、StateView、PositionManager、AccessManager 和全部模块 codehash 清单；
- selector 级权限脚本与链上读取比对；
- Solidity 单元、fuzz、invariant、Gas、主网/目标链 fork 测试；
- 独立安全审计和异常演练；
- 法律、地区准入和风险披露签字。

任何实现若偏离本文，必须升级 `executionSpecId`、列出差异、增加参考向量，并重新审计；不能以“实现细节”为由静默改变收费资产、取整、时间边界、本金逃生、权限或状态迁移。
