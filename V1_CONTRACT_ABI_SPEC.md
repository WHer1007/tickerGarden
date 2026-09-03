# V1 合约 ABI、错误与事件基线

> 状态：`REVIEW`
>
> Solidity 接口：[`contracts/src/interfaces`](./contracts/src/interfaces)；机器可读清单：[`spec/contract_abi_surface.json`](./spec/contract_abi_surface.json)；自动检查：[`spec/test_contract_abi_surface.py`](./spec/test_contract_abi_surface.py)。
>
> 本文冻结模块边界和安全语义，不代表所有经济参数均已冻结。文末四项开放决策关闭前，不得进入生产实现。

## 1. 目标

本基线是正式编码前的“窄腰”：网站、Indexer、Backend、执行 Worker、部署脚本和 Solidity 实现都只依赖这里定义的名称与动作。新代码统一使用 `TickerMeme`，不再使用早期 `mStock` 技术占位词。

V1 的 ABI 遵循四条硬约束：

1. 资产身份只使用 `marketId` 和 canonical 合约地址，名称与 Symbol 不是主键。
2. 用户 withdraw、claim 和 vesting release 不接受任意收款地址，资金固定返回登记 beneficiary 或 Escrow。
3. Worker 只允许两种报价型回购，不存在任意 target、calldata、approve 或通用 execute。
4. 生产合约不可升级；迁移通过专用、延迟且资产绑定的入口完成。

## 2. 模块与职责

| 模块 | 主要写入口 | 不承担的职责 |
|---|---|---|
| OfficialStockRegistry | 登记资产、暂停/恢复资产 | 托管 Stock Token、创建市场 |
| TickerGardenFactory | 原子创建标准市场模块 | 后续管理创建者、修改排放 |
| MarketController | 激活、暂停、恢复、退休 | 扣押用户退出 |
| TickerMemeToken | Controller mint、自持 burn、一次性 metadata finalize | 管理员增发、transfer pause |
| EmissionController | 绑定 Gauge、登记 released、按 claim mint、期末取消 | 接收任意 minter 或更改终点 |
| StockStakingGauge | stake、withdraw、claim、checkpoint | 代理指定提款收款人 |
| CanonicalLPNFTGauge | v4 Subscriber 回调、sync、claim | 托管 LP NFT、阻止 NFT 生命周期 |
| RewardEscrow | 创建 tranche、释放已解锁奖励 | 管理员没收或改 beneficiary |
| PermissionlessInitializer | 初始化官方池并加入首笔流动性 | 持有 LP NFT、替用户指定收款人 |
| TickerGardenV4Hook | 校验唯一官方池、在 swap 回调中累计协议费 | 在用户交易链路中做回购 |
| ProtocolFeeVault | 按市场/资产/用途记账和消费 Bucket | 任意转账或策略投资 |
| FeeExecutor | 两类 Worker 回购、公开固定目的地结算 | 任意路由、任意收款、任意 approve |
| StockTreasuryVault | 接收回购 Stock Token、7 天迁移 | 与 TickerMemeToken 混放、日常提款 |
| NamingGovernor | 提案、快照投票、排队、向 Executor 消费成功提案 | 通用 DAO 调用 |
| NamingExecutor | 公开执行到期的唯一成功命名 | 修改 Token 地址或二次命名 |

Factory 的 `MarketModules` 必须返回全部 13 个市场模块地址，包括 Hook、Initializer 和两套命名模块，避免前端或后端维护另一份隐式地址映射。

`OfficialStockRegistry.AssetConfig` 固定保存 Asset UID、canonical Stock Token、USD Feed、Sequencer Uptime Feed、Token/Feed runtime code hash、Feed description hash、当前 multiplier、heartbeat、Sequencer 恢复宽限和两类 decimals。注册与从暂停恢复时都重新校验 live getter；Guardian 只能 `ACTIVE → PAUSED`，Timelock 才能注册、恢复与永久退休。代理 implementation/Beacon 漂移由环境 manifest 和运维监控负责，Registry 内的代理 runtime code hash 不能单独证明代理实现未升级。

Registry 只决定 Stock 资产能否进入/继续协议业务，不参与 LP NFT 的质押资格。LP NFT 仍可直接订阅 Gauge，资产暂停不得阻止 unsubscribe、withdraw、claim 或已归属奖励释放。

`TickerMemeToken` 的显示名称允许被治理最终修改一次，但 Permit 的 EIP-712 domain name 永久固定为 `TickerGarden Ticker Meme`、version 固定为 `1`。这样改名不会让已签名但尚未提交的 permit 突然失效；Web 必须从 `eip712Domain()` 读取签名域，不能把当前显示名称猜成 domain name。Token 本地只校验名称为 1–64 bytes、Symbol 为 3–8 位大写 ASCII、Logo URI 不超过 256 bytes；平台唯一性、保留词和 URI 内容策略由 Registry/Naming 模块完成。

## 3. 固定收款与资产路径

### 3.1 奖励与退出

- `StockStakingGauge.withdraw(uint256)` 只能把 Stock Token 返还 `msg.sender` 对应仓位。
- 两个 Gauge 的 `claim()` 都不接收 recipient：20% 发 beneficiary，80% 发该市场 RewardEscrow 并登记同一 beneficiary。
- `RewardEscrow.releaseVestedFor(address beneficiary)` 可由任何人触发，但只能支付参数所指 beneficiary，调用者不能获款。
- LP Gauge 只登记 canonical PositionManager 回调时的 NFT owner；回调中的 `data`、`owner` 或 caller 均不能重定向历史奖励。

### 3.2 手续费与回购

- Hook 只接受 canonical PoolId，并只把协议费记入该市场 ProtocolFeeVault。
- 用户 swap 内只收集和分桶，不执行 Stock/TGARD 回购。
- `executeStockBuyback` 输出固定进入对应 `StockTreasuryVault`。
- `executeTgardBuybackAndBurn` 输出固定进入已冻结 TGARD burn 目的地。
- `burnTickerMemeBucket` 与 `forwardProtocolRevenue` 无需报价，允许公开触发，但目的地分别固定为 Token burn 和 ProtocolTreasury。
- 所有 Bucket 消费以 `batchId` 幂等，并受额度、deadline、最小输出和固定路由约束。

## 4. 命名治理最小 ABI

最终命名只暴露：

```text
proposeFinalMetadata(name, symbol, logoUri)
castVote(proposalId, support)
queueFinalName(proposalId)
executeFinalName(proposalId)
```

NamingExecutor 通过 `consumeApprovedProposal(proposalId)` 从 Governor 原子消费已到期提案，再调用 Token 的 `finalizeMetadata`。执行接口不接收 Token、target 或 calldata，因而不能变成通用治理执行器。

投票 7 天、10% quorum、有效票 2/3、执行延迟 7 天、失败冷却 30 天仍是产品约束。当前文档对快照时钟存在“区块”与“时间戳”两种表述，因此接口暂不暴露实现特定的 block/timestamp 参数；实现前必须统一为一种时钟并写入测试。

## 5. 错误与事件规则

- 可预期拒绝使用 custom error，不使用字符串 revert。
- 权限错误明确指出固定调用方，例如 `OnlyEmissionController`、`OnlyPoolManager`、`OnlyExecutionWorker`。
- 资金事件至少索引 `marketId`、资产或 beneficiary、幂等 `batchId`；金额使用原始最小单位。
- 状态变化事件同时包含前后状态，迁移事件包含 successor、余额、原因哈希和 Timelock operationId。
- 事件不把 Symbol 当唯一索引；前端与 Indexer 必须保留历史名称，但使用地址和 `marketId` 关联。

## 6. 明确禁止的 ABI

以下 selector 及等价的 fallback、delegatecall、插件或任意 multicall 形式都禁止：

```text
execute(address,uint256,bytes)
withdrawToken(address,address,uint256)
approveToken(address,address,uint256)
setMinter(address)
setMaximumSupply(uint256)
setEmissionEnd(uint256)
setRewardBeneficiary(address)
```

此外，claim/withdraw 不得新增 `recipient` 或 `to`，FeeExecutor 不得新增 Worker 可调用的方法。

## 7. 验收方法

```bash
cd contracts
/Users/dear/.foundry/bin/forge fmt --check src test
/Users/dear/.foundry/bin/forge build

cd ..
python3 -m unittest spec.test_contract_abi_surface -v
python3 -m unittest spec.test_permissions_matrix -v
```

机器检查覆盖：接口与清单对应、权限矩阵动作覆盖、Worker 只有两个入口、禁止 selector 不存在、用户领取/退出不可重定向，以及 Factory 返回完整模块集合。

## 8. 仍需关闭的决策

| ID | 决策 | 阻塞范围 |
|---|---|---|
| G0-FEE-01 | 原生 LP 费 0.60% 与协议费如何精确组成目标总费率 | Hook 费率常量、swap 会计与完整属性测试 |
| G0-NAME-01 | 命名治理使用 timestamp 还是 block-number 快照 | Governor 时钟、7/7/30 天换算 |
| G0-NAME-02 | 提案资格、保留词、Symbol 永久占用的最终规则 | Governor 与 Registry 集成 |
| G0-POOL-01 | canonical PoolKey、TGARD/Stock route 和部署地址 | Hook、Initializer、Executor 生产构造参数 |

在这些决策关闭前，允许继续实现与其无关的 Token、Escrow、排放数学和固定权限骨架；不得伪造生产地址或把未确认费率写成不可变常量。
