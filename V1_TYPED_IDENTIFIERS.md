# TickerGarden V1 Typed ID、Hash 与发现接口

> **当前边界（2026-09-04）：** 新架构不为市场级 pause/retire/emergency/Recovery 管理状态生成身份或 hash；`launchPhase` 是一次性事实。资产/配置状态身份仍保留，用户 rageQuit 不依赖市场管理状态。文中旧 Emergency hash 域待随机器规范删除。

> 规格任务：`V1-P-008`
> 状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> 更新时间：2026-09-03

所有 ID/hash 使用 `keccak256(abi.encode(...))`，第一个字段是固定 `bytes32 domain`，第二个字段是 `uint256 schemaVersion = 1`。字符串先转为 `keccak256(bytes(value))`。禁止 `abi.encodePacked`、JSON 序列化、symbol/name 作为身份主键或省略 chain/contract domain。

## 1. LaunchTemplateRegistry

Launch template 追加式登记，历史项不可修改：

```solidity
struct LaunchTemplate {
  address memeTokenImplementation;
  bytes32 memeTokenCodeHash;
  address curveImplementation;
  bytes32 curveCodeHash;
  address gaugeImplementation;
  bytes32 gaugeCodeHash;
  address graduatedHook;
  bytes32 hookCodeHash;
  address graduationExecutor;
  address launchLockerImplementation;
  bytes32 launchLockerCodeHash;
  bytes32 feePolicyId;
  bytes32 executionSpecId;
  uint8 status;
}
```

`addLaunchTemplate` 由48h Protocol Admin 追加；pause 立即阻止新市场，unpause 24h，retire 48h且不可恢复。状态不进入 templateHash/expectedEconomics；市场冻结 templateId 与其不可变内容哈希。

```text
launchTemplateHash = keccak256(abi.encode(
  keccak256(bytes("TICKERGARDEN_V1_LAUNCH_TEMPLATE")), 1,
  memeTokenImplementation, memeTokenCodeHash,
  curveImplementation, curveCodeHash,
  gaugeImplementation, gaugeCodeHash,
  graduatedHook, hookCodeHash,
  graduationExecutor,
  launchLockerImplementation, launchLockerCodeHash,
  feePolicyId, executionSpecId
))
```

`status` 不进入 hash；所有 implementation/address 必须非零且 codehash 必须等于最终 artifact/runtime 证据。Launcher 只能部署 template 中的实现，不能由 creator 替换。

## 2. Quote economics hash

每个追加式 `QuoteAssetConfig` 使用内容寻址；V1 首发仅允许原生 Quote，首发配置的 `quoteAssetConfigId` 必须等于其 `quoteEconomicsHash`。首发不批准可升级 USDG。未来如增加 ERC20 Quote，仅允许经过审查的 direct immutable、非代理 token：

```text
quoteEconomicsHash = keccak256(abi.encode(
  keccak256(bytes("TICKERGARDEN_V1_QUOTE_ECONOMICS")), 1,
  chainId,
  ponsBaselineId,
  quoteAsset,
  quoteDecimals,
  phantomQuote,
  graduationThreshold
))

quoteAssetConfigId = quoteEconomicsHash
```

`status`、symbol/name、implementation 和观测区块不进入 economics hash：前者是可变准入状态，后三者属于部署证据。Registry 必须校验 ID 与重算结果一致，不能接受调用者提供的任意别名；更新任一 economics 字段都必须新增 config。精确首发值见 [`spec/v1_initial_quote_configs.json`](./spec/v1_initial_quote_configs.json)，schema 与固定向量见 [`spec/v1_hash_schemas.json`](./spec/v1_hash_schemas.json)。历史观测到的 USDG 配置仅作为外部事实保留，不构成 V1 首发批准。

## 3. expectedEconomics

`ponsBaselineHash` 对 baseline 的全部不可变内容进行版本化内容寻址，`status` 不参与：

```text
ponsBaselineHash = keccak256(abi.encode(
  keccak256(bytes("TICKERGARDEN_V1_PONS_BASELINE")), 1,
  referenceChainId, referenceFactory, referenceFactoryCodeHash,
  launchConfigId, supply, curveFeeBps, poolFee, tickSpacing,
  behaviorVectorRoot
))
```

```text
expectedEconomics = keccak256(abi.encode(
  EXPECTED_ECONOMICS_DOMAIN, 2,
  chainId, factory,
  assetUid, stockToken, stockDecimals,
  ponsBaselineId, ponsBaselineHash,
  quoteAssetConfigId, quoteEconomicsHash,
  launchTemplateId, launchTemplateHash,
  launchConfigId,
  feePolicyId, feePolicyHash,
  executionSpecId
))
```

它不包含自身、可变 status、creator、beneficiary、salt、名称或 metadata。Asset UID、canonical Stock Token 和 decimals 永久固定市场的唯一质押 Base；动态 `minimumAllocation` 由 OfficialStockRegistry 按 Asset UID 管理，不进入市场不可变 hash。协议安全下限为414 raw units。STOCK 价格和 backing target 不进入 hash。

## 4. marketId

```text
marketId = keccak256(abi.encode(
  MARKET_ID_DOMAIN, 1,
  chainId, factory,
  creator,
  creatorRevenueBeneficiaryAtCreation,
  creatorSalt,
  expectedEconomics,
  keccak256(bytes(name)),
  keccak256(bytes(symbol)),
  keccak256(bytes(metadataURI))
))
```

launch-and-buy 中 creator 来自 Router 外层 `msg.sender`。marketId 不依赖部署顺序或 Router 地址。

## 5. 组件 CREATE2 salt 与地址预测

TickerGarden 不复制 Pons 未公开完整的 deployed CREATE2 实现。Token、Curve、Gauge 与 per-market LaunchLocker 使用项目自己的固定 domain：

```text
componentSalt = keccak256(abi.encode(
  keccak256(bytes("TICKERGARDEN_V1_COMPONENT_SALT")), 1,
  chainId, factory, marketId,
  keccak256(bytes(componentKind)) // TOKEN / CURVE / GAUGE / LOCKER
))

predicted = last20bytes(keccak256(
  0xff || launchDeployer || componentSalt || initCodeHash
))
```

`marketId` 已经包含 creator、creator salt、beneficiary、economics 和元数据哈希，因此组件 salt 不再接受可被 Router 替换的 caller 字段。Curve 必须先预测；Token 的 init code 绑定该 predicted Curve；Gauge 与 Locker 使用各自冻结 implementation 对应的 init code hash。Token/Curve/Gauge 的 CREATE2 deployer 是 Factory 固定的 launch deployer；Locker 的 deployer 是冻结的 GraduationExecutor。Factory 暴露：

```solidity
predictMarketAddresses(address creator, CreateMarketParams params)
    -> (bytes32 marketId, address memeToken, address curve, address gauge, address launchLocker)
```

预测与实际部署必须调用同一内部库，并逐地址断言相等。Token/Curve/Gauge 在创建交易部署；Locker 只在毕业子调用中由 GraduationExecutor 部署，但地址在创建前即可预测。地址已有代码、init code hash 不匹配或初始化失败时整笔回滚，不允许自动更换 nonce。Hook 是 template 级共享地址，单独执行 Uniswap v4 权限位 salt mining。公式、部署顺序和固定向量见 [V1_PONS_BEHAVIOR_BASELINE.md](./V1_PONS_BEHAVIOR_BASELINE.md) 与 `spec/v1_pons_behavior_vectors.json`。

`V1Identifiers` 与 `V1Create2` 已在 `contracts/src/v1/shared/` 实现上述 marketId、component salt、EIP-1014 预测及零值 CREATE2 部署路径。当前通过的是冻结算法向量与本地真实部署一致性；各产品组件的最终 constructor args、initCodeHash、部署者地址和 production manifest 仍须由 `V1-C-105-B/C`、Graduation 与 deployment evidence 闭合。

## 6. 费用与恢复 hash

- `feePolicyHash`：domain/schema version 4 + executionSpecId + feePips + LP share + pool fee + Hook mask + feeAssetMode + `stakerNonLpShareBps=3000` + `platformNonLpShareBps=3000`。当前编码为 `lpShareBps=0`、`feeAssetMode=1 (UNSPECIFIED_CORE_SWAP_DELTA)`；改变编码或语义必须升级 schema 与 execution spec。
- `v4FeeId`：domain/version + chainId + FeeVault + PoolManager + poolId + marketId + sourceVersion + feeNonce + feeAsset + base + totalFee + feePolicyHash。
- `curveFeeId`：domain/version + chainId + FeeVault + curve + marketId + sourceVersion + sweepNonce + quoteAsset + sweptAmount。
- `emergencyStateHash` 与 recovery leaf 使用 [V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md](./V1_MARKET_AUTONOMY_AND_RAGE_QUIT.md) 的字段；均加入 schemaVersion，leaf 继续执行外层第二次 Keccak。

具体字段顺序与测试向量以 `spec/v1_hash_schemas.json` 为机器权威。改变 domain、类型、顺序或字段必须升级 schemaVersion 与 executionSpecId，旧 hash 永不复用。

## 7. Canonical discovery

`MarketRegistryV1` 必须直接提供：

```solidity
market(marketId) -> MarketView
marketIdByToken(memeToken) -> marketId
canonicalPoolKey(marketId) -> PoolKey
canonicalPoolId(marketId) -> bytes32
activeFeeSource(marketId) -> (source, sourceVersion)
```

`canonicalPoolKey` 在市场创建后即可由冻结 quote/meme/hook/tickSpacing 得出；PoolCreated 前 `canonicalPoolId` 返回计算出的 expected poolId，但 runtime `poolId` 仍为0。毕业 commit 必须验证二者相等。Router/Quoter/Indexer 只消费 Registry 的 `canonicalRoute`，不拼装 PoolKey、不自行推断交易生命周期，也不依赖后端提供安全关键字段；共享 v4 Router/Quoter 地址由 Registry 构造时 immutable 冻结，目标链地址与 codehash 另由 deployment manifest/preflight 核验。
