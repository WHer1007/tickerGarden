# TickerGarden V2 MultiAsset Stock Vault 决策

> 状态：`IMPLEMENTED_LOCAL / NOT_DEPLOYABLE`
> 日期：2026-09-03
> 适用版本：TickerGarden V2 / `V2-EXEC-4` 的部署前架构修订
> 机器规范：[`spec/v2_execution_manifest.json`](./spec/v2_execution_manifest.json)、[`spec/v2_abi_surface.json`](./spec/v2_abi_surface.json)

## 1. 决策

Stock 本金托管采用“**每个 Vault schema 版本一个共享 MultiAsset `UserStockVault`**”，当前 schema 为：

```text
keccak256("TickerGarden.UserStockVault.MultiAsset.v1")
```

当前 194 种以及后续新增的官方 Stock Token 均可绑定到这一个 Vault。这里的“单一”不是永远只有一个不可替换地址：新 schema 可以部署 successor Vault，但 `OfficialStockRegistryV2` 强制每个 schema 只能解析到一个 canonical Vault；每个已登记 Asset UID 的 Vault 绑定仍然 write-once。

```text
OfficialStockRegistryV2
├─ schema v1 ──> UserStockVault v1
│  ├─ Asset UID A ──> Stock Token A
│  ├─ Asset UID B ──> Stock Token B
│  └─ ...
└─ future schema v2 ──> UserStockVault v2

MarketRegistryV2: marketId ──> Asset UID
AllocationManager: marketId ──> Asset UID ──> canonical Vault
MemeStockGauge: 每市场独立状态，不托管 STOCK
```

### 1.1 V2-EXEC-4 质押手续费与仓位门槛

本节是当前部署前冻结的 `V2-EXEC-4` 规则。移除原先的 `10 STOCK` 线性释放/饱和开关；它不再参与手续费分桶，也不再作为任何存入或仓位门槛。

- 某 market 只要存在已激活的 STOCK 仓位，Staker 固定获得 non-LP 手续费的 `50%`（总手续费约 `40%`），并由该 market 的所有 active stake 按 raw-unit 质押比例分配。
- 没有 active stake 时，Staker 为 `0`；Creator 与 Platform 各承接 non-LP 手续费的一半。LP 的固定份额不变。
- 最低门槛是 OfficialStockRegistry 按 `assetUid` 配置的 raw-unit `minimumAllocation`。资产注册时指定，管理员可以延迟更新；它不是 Vault 普通 `deposit` 的最小金额。普通 deposit 仍可存入任意正数量的空闲本金。
- 新建仓位、增仓后的总仓位、迁入后的目标仓位必须 `>=` 当前门槛；部分减仓或迁出后的非零剩余必须 `>=` 当前门槛。
- 门槛更新不强平老仓。若既有仓位低于新门槛，用户可以继续持有，但只能补足到当前门槛或全额退出；正常全退与紧急逃生均不受门槛阻挡。
- 逃生路径放弃收益并只退出调用者自己的仓位，不暂停 market；正常全退遵循锁定和收益规则。

该规则是部署前变更，必须与 Registry、AllocationManager、Gauge、FeeVault、ABI、Indexer 和测试作为同一 `V2-EXEC-4` 发布单元完成；既有未部署的 `V2-EXEC-3` 规格不再作为部署依据。

不采用“一资产一 Vault + Factory”，也不在当前规模预先采用分片 Vault。若未来需要把托管故障域分片，应使用新 schema 明确建模，而不是在同一 schema 下静默部署多个地址。

## 2. 为什么选择该方案

### 2.1 部署与管理成本

一资产一 Vault 的合约数量、部署交易、源码验证、地址清单、监控目标和审计证据都会随资产数 `N` 线性增长。MultiAsset 方案中，Vault 部署数量随 schema 版本数 `V` 增长，正常情况下 `V << N`；新增资产只需登记 Asset UID、Token、decimals 和同一个 Vault 地址。

本地 Solidity 0.8.26、optimizer 200、Cancun artifact 的可复算数据为：

| 项目 | 旧一资产一 Vault | 当前 MultiAsset Vault |
|---|---:|---:|
| creation code | 8,650 bytes | 8,355 bytes |
| runtime code | 7,780 bytes/资产 | 7,821 bytes/schema |
| 194 资产的 runtime code-deposit Gas | 301,864,000 | 1,564,200 |
| 仅 runtime code-deposit 节省 | — | 300,299,800，约 99.48% |

上表只按 EVM 每个 runtime byte 200 Gas 计算，不含 constructor、Registry 登记、calldata、交易基础费或目标链定价，因此不能当作最终部署报价。它说明的是数量级：资产增加到数百种后，重复部署相同 runtime 是主要浪费。

Registry 在首次使用 Vault 时回读 `vaultIdentity()`，校验依赖和非零 schema，写入 `vaultSchemaId(vault)` 与 `vaultForSchema(schema)` 并发出 `StockVaultRegistered`。同一 schema 的第二个 Vault 会被拒绝。后续资产复用已登记 Vault，不再重复做 schema 注册。

### 2.2 用户 Gas

所有用户操作仍然是单资产、单市场、O(1)：没有遍历资产目录、用户或市场，也没有 `batch*`、`claimAll` 或链上资产枚举。资产从 194 增加到数百种不会让一次存款、提款或 allocation 的执行复杂度随总品种数增长。

代价是每个 Vault ABI 显式增加一个 `bytes32 assetUid`，并使用多一层 mapping key。当前 focused gas report 的参考中位数为：

| 操作 | 当前本地中位数 |
|---|---:|
| `depositStock(assetUid, amount)` | 109,233 gas |
| `withdrawFreeStock(assetUid, amount)` | 71,573 gas |
| `forceReleaseAllocation(assetUid, marketId)` | 92,342 gas |

这些数字来自测试夹具，不是旧/新严格同环境差分，也不是目标链报价。关键结论是热路径保持 O(1)，没有因支持数百资产而产生线性 Gas。

ERC-20 allowance 仍属于各个 Token 合约，因此用户首次使用每种 Stock Token 仍需分别授权；优化点是所有授权的 spender 地址相同，不再需要发现和验证数百个 Vault 地址。用户无需因为同一 STOCK 参与多个 Meme 市场而重复授权或转入本金。

### 2.3 状态增长

资产目录增长不会预分配 storage。Solidity mapping 只在真实登记、存款或 allocation 时写槽位。链上成本随实际使用的 `asset + user + market` 组合增长，而不是随 Registry 中可选股票总数自动增长。

为避免无界操作，合约不维护资产数组。资产列表由 `AssetRegistered` 与 `StockVaultRegistered` 事件在 Indexer 中重放，链上读取始终由明确的 Asset UID 定位。

## 3. ABI 与账本隔离

调用者永远传 Asset UID，不传 Token 地址。Vault 每次操作都从 `OfficialStockRegistryV2` 解析 canonical Token，并验证该 Asset UID 仍绑定当前 Vault。关键 ABI 为：

```solidity
depositStock(bytes32 assetUid, uint256 amount)
depositStockFor(bytes32 assetUid, address user, uint256 amount)
withdrawFreeStock(bytes32 assetUid, uint256 amount)
forceReleaseAllocation(bytes32 assetUid, bytes32 marketId)

lockAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount)
releaseAllocation(bytes32 assetUid, address user, bytes32 marketId, uint256 amount)
moveAllocation(bytes32 assetUid, address user, bytes32 fromMarketId, bytes32 toMarketId, uint256 amount)
```

所有本金与 allocation 状态均以 Asset UID 作为第一层 key：

```solidity
deposited[assetUid][user]
allocated[assetUid][user]
allocation[assetUid][user][marketId]
marketAllocated[assetUid][marketId]
totalDeposited[assetUid]
totalAllocated[assetUid]
```

对每个 `assetUid` 独立满足：

```text
allocated[assetUid][user] <= deposited[assetUid][user]
allocated[assetUid][user] = Σ allocation[assetUid][user][marketId]
marketAllocated[assetUid][marketId] = Σ allocation[assetUid][user][marketId]
totalAllocated[assetUid] <= totalDeposited[assetUid]
Vault.balanceOf(canonicalToken(assetUid)) >= totalDeposited[assetUid]
```

`AllocationManager` 先从 `marketId` 取得 canonical Asset UID，再把同一个 UID 传入 Vault；Vault 再验证市场属于该 UID。迁移同时要求源、目标 market 的 Asset UID 相同。所有 Vault allocation 事件都包含 indexed `assetUid`，避免共享地址下的事件归属歧义。

## 4. 安全判断

“每个 Vault 代码相同，所以一个有风险就等于全部有风险”只描述了**共同代码缺陷**，没有覆盖完整风险面：

- 一资产一 Vault 确实不能隔离共同实现 bug；同一漏洞可被逐个利用。
- 但它可以限制单个 Token 的异常行为、单实例 storage 污染、错误登记或一次操作失误的即时影响。
- 单一 MultiAsset Vault 把更多本金放在同一地址，代码错误的潜在损失集中度更高，并新增 Asset UID 键混淆和跨资产会计污染风险。

因此 MultiAsset 不是“安全性完全相同”，而是用更低的部署/运维复杂度换取更大的单地址 blast radius。当前实现针对新增风险使用以下约束：

1. 每个入口和 getter 都显式携带 `assetUid`；不从 symbol 推断，也不接受调用者提供 Token 地址。
2. Token 只从 append-only OfficialStockRegistry 解析；Token 地址不能被两个 UID 重复登记。
3. 每层账本都以 `assetUid` 开头，连全局 aggregate 也按资产拆分。
4. 每次 market allocation 都校验 `market.assetUid == assetUid`；迁移只能在同资产市场间发生。
5. 存款要求 Vault Token 余额精确增加，提款要求 Vault 精确减少且用户精确增加；异常 transfer、fee-on-transfer 等行为回滚。
6. 存款只在 Asset ACTIVE 时开放；PAUSED/RETIRED 不阻断 free withdrawal 和已存在仓位的安全退出。
7. Vault 无 owner 提款、任意 recipient、任意外部执行、delegatecall、策略投资或升级入口；Allocation mutator 只认 immutable AllocationManager。
8. `vaultIdentity()` 固化 Registry、MarketRegistry、AllocationManager 与 schema；Registry 强制一个 schema 只有一个 canonical Vault。
9. 测试覆盖同一 Vault 中两个真实 Token 的存款、allocation、总量和余额相互隔离，以及跨资产 market/迁移拒绝。

仍需接受的剩余风险是集中托管：若 MultiAsset Vault 本身存在可盗取或冻结全部 Token 的漏洞，受影响范围会大于单资产实例。部署前必须把跨资产 invariant、恶意 ERC-20 callback、异常返回值、暂停/退役退出和 Emergency release 纳入独立审计；不能用“代码相同”把集中风险从风险登记中删除。

## 5. 版本、迁移与运维

`UserStockVault` 不使用代理升级。schema 变化时部署新 Vault 地址，并在首次登记时由 Registry 建立唯一 `schema → vault` 关系。新 Asset UID 可以选择新 schema；旧 Asset UID 的 Vault 绑定不允许管理员原地改写。

若未来必须把已登记资产迁移到新 Vault，当前 ABI 不允许直接 rebind。正确流程需要新的 execution spec/Registry 迁移设计，先保留旧 Vault 的用户退出，再通过显式版本迁移处理；不得增加管理员 sweep 或静默代理升级作为捷径。

运维与监控必须按以下维度工作：

- 地址级：Vault runtime、immutable dependencies、schema、总 Token 列表和异常调用；
- 资产级：`totalDeposited[assetUid]`、`totalAllocated[assetUid]`、实际 Token 余额、Asset 状态；
- 市场级：`allocation[assetUid][user][marketId]` 与 Gauge position 对账；
- 事件级：所有 Vault allocation 事件以 `assetUid` 分区，Indexer key 使用 `assetUid + user + marketId`。

只有当单 Vault 的审计、监控或治理 blast radius 超出明确风险预算时，才考虑分片；触发条件应是量化的 TVL/Token 行为/法域边界，而不是资产数量本身。数百种 mapping key 不会导致 Solidity mapping 变慢，因此“品种达到数百”本身不是分片理由。

## 6. 发布边界

本次是尚未部署的 `V2-EXEC-4` 架构修订，旧单资产 ABI 与新 ABI 不兼容。接口、权限矩阵、compiled/product artifact、Web ABI、Indexer event catalog 和测试必须作为同一变更发布。当前本地实现通过不代表可部署；目标链 finalized Token 身份、真实部署 manifest、AccessManager 配置、Fork/E2E、外部审计和灰度门禁仍必须完成。
