# TickerGarden V1 合约架构优化决策

> **当前实现（2026-09-04）：** `V1-EXEC-11` 已实现部署后市场永久自治与最终买入原子毕业；`launchPhase` 只允许 `NotGraduated -> PoolCreated`，用户 `rageQuit` 随时即时取回本金，奖励异步处理。目标链部署与独立审计仍开放。

手续费架构更新：总协议手续费维持 1%，不再切出 LP 协议手续费；Active 分支为 Creator40/Staker30/Platform30，无 Active 分支为 Creator70/Staker0/Platform30，向下取整余数归 Creator。Hook 不再 donate，LaunchLocker 不再 collect/compound，手续费统一由 FeeVault 记账。canonical LP 继续永久锁定但无协议 LP 手续费。该取舍消除基于即时池价的复投/捐赠与 JIT 经济风险，并减少链上 gas 和 keeper 运维面。

> 状态：`IMPLEMENTED / NOT YET DEPLOYMENT ELIGIBLE`
> 日期：2026-09-03
> 适用范围：V1 Meme Launch、配置读取、Gauge 与 LaunchLocker；不改变本文件之外的 Stock Vault 决策

## 1. 最终形态

本轮采用的原则是：**合并读取入口，不合并权威状态；复用无资金业务代码，不共享市场资金状态。**

```text
ApprovedQuoteRegistry ─┐
PonsBaselineRegistry ──┼─> LaunchConfigResolver（只读、无缓存、可选调用面）
LaunchTemplateRegistry ┘

TickerGardenFactoryV1
├─ TickerMemeTokenV1：每市场完整 CREATE2 合约
├─ PonsCompatibleCurve：每市场完整 CREATE2 合约
├─ MemeStockGauge：一个固定 implementation + 每市场 immutable-args CREATE2 clone
└─ LaunchLocker：每个毕业市场一个完整、独立 CREATE2 合约
```

`LaunchConfigResolver` 只降低前端、部署和运维读取三个 Registry 的认知成本。三个 Registry 仍是各自数据的唯一权威；Resolver 不缓存、不写入、不拥有配置权限。Factory 继续直接读取权威 Registry，避免把一个便利读取层变成发行必经的新故障点。

## 2. 为什么不物理合并三个 Registry

三个 Registry 的状态机、权限和风险不同：Quote 管理资产行为与 decimals，Pons Baseline 管理参考发行语义，Launch Template 管理部署实现和 codehash。物理合并只能少部署两个全局地址，却会扩大单一故障域，并增加权限误配、类型 ID 混淆和事件迁移风险。

保留独立存储、增加 typed Resolver 后，可以同时得到：

- 独立 selector 权限、暂停和退休状态机；
- 任一 Registry 缺陷不直接改写其他配置类型；
- 原有事件和索引语义不迁移；
- Web/运维可一次读取 `QuoteAssetConfig + PonsBaseline + LaunchTemplate`；
- Registry 返回值始终是实时权威值，不存在缓存漂移。

因此，Resolver 是管理面的聚合，不是安全边界的合并。

## 3. 为什么 Gauge 使用 immutable-args clone

旧架构为每个市场部署一份完整 `MemeStockGauge` runtime。Gauge 不托管 STOCK 或手续费资产，但包含较大的 activation、结算和双资产累加器代码；市场数量增加时，重复部署相同代码的成本线性增长。

新架构只部署一次不可升级 `MemeStockGauge` implementation。每个市场由 Factory 使用 OpenZeppelin 5.7 的 deterministic clone-with-immutable-args 部署一个独立实例，并在实例 runtime 中固化七个 ABI word：

```text
marketId
assetUid
quoteAssetConfigId
allocationManager
protocolFeeVault
quoteAsset
memeToken
```

选择 immutable args 而不是普通 initializer clone 的原因：

- 没有“部署后等待初始化”的抢跑窗口；
- 没有重复初始化或漏初始化状态；
- 市场身份不能通过 storage mutation 修改；
- Factory 的 CREATE2 预测与实际部署使用同一份参数编码；
- 每个 clone 仍拥有完全独立的 reward、position、activation 和 forfeiture storage。

Factory 在预测阶段校验地址形状和已存在依赖，在 Token 部署后、Gauge clone 创建前再次强制校验 Token/Quote/Manager/FeeVault 的代码存在性；部署后通过 `gaugeIdentity()` 回读并核对完整 identity hash。实现合约本身和参数长度错误的 clone 不能执行 Gauge 业务接口。

## 4. 为什么 Token 与 Curve 保持完整部署

Token 与 Curve 的构造过程本身承担安全职责：固定供应直接铸给预测 Curve、绑定 Factory、读取构造期瞬时快照、验证 prefund 和发行经济参数。将它们改成共享状态代理会把构造不变量变成初始化不变量，增加抢跑、漏初始化和 storage-layout 风险。

现有两个 typed deployment helper 只用于避免 Factory 内联大段 creation code，并让 Factory 保持 CREATE2 deployer；它们没有通用 creation-code 或任意 delegatecall 入口。物理合并 helper 主要只少一个全局地址，不能降低每市场部署成本，却会把 Token 与 Curve 变成同一个 codehash 故障域。因此本轮保持两个 helper 和两份完整市场 runtime。

## 5. 为什么 LaunchLocker 保持每市场完整独立

LaunchLocker 与 Gauge 的风险性质不同。Locker 仅永久持有具体市场的 Position NFT 以及意外直接转入的 Quote/Meme 余额；核心 LP fee 与协议 LP 分成都固定为0，也不存在 collect、Permit2 授权或同仓复投。继续按市场隔离 Locker，主要是为了让 tokenId、PoolKey、资产归属和永久托管边界保持一一对应，避免共享合约把多个市场集中到同一托管故障域。

每市场完整 Locker 虽然增加毕业交易 Gas 和地址数量，但换来：

- 一个 Locker 只能操作一个 market、PoolKey 和 tokenId；
- 某市场的 Position 状态或意外余额不会污染其他市场；
- NFT owner、池身份和锁定余额可以直接链上证明；
- 不需要共享账本、管理员提款或跨市场余额路由。

这是有意保留的安全隔离成本。

## 6. Gas 与管理影响

在 Solidity 0.8.26、optimizer 200、Cancun 配置下，本轮本地编译和回归观察为：

| 项目 | 旧完整 Gauge | 新 Gauge clone | 变化 |
|---|---:|---:|---:|
| 每市场 runtime | 10,055 bytes | 269 bytes | 减少约 97.3% |
| 每市场仅 code-deposit Gas | 2,011,000 | 53,800 | 减少 1,957,200 |
| Factory 创建代表性集成测试 | 5,968,776 gas | 3,856,688 gas | 减少 2,112,088，约 35.4% |

当前共享 implementation runtime 为 11,463 bytes，只支付一次部署成本。上述数字是本地测试基准，不是 RH Testnet 的最终交易报价；目标链部署前仍需固定 artifact、交易输入和区块环境重新记录。

代价是 Gauge 热路径多一次 delegatecall，并需要从 clone runtime 读取固定参数。该开销不会扩大状态故障域，但必须继续通过 allocate、checkpoint、credit、settle、claim、rageQuit/forfeiture Gas 与不变量测试约束。

## 7. 部署和审计证据

部署清单必须把 Gauge implementation 与市场 clone 分开记录：

- `protocolModules.MemeStockGauge.moduleKind = CLONE_IMPLEMENTATION`；
- `create2.components.GAUGE.deploymentKind = ERC1167_IMMUTABLE_ARGS_CLONE`；
- 记录 implementation 地址与 runtime codehash；
- 记录 clone init-code hash、runtime codehash、salt、预测/实际地址和 immutableArgsHash；
- `gaugeIdentity()` 返回数据的 hash 必须等于 immutableArgsHash；
- clone 地址不得等于 implementation 地址；
- TOKEN、CURVE、LOCKER 仍标记为 `FULL_CREATE2`；
- 所有 CREATE2 冲突必须回滚，禁止 nonce fallback。

当前架构已达到 `DEPLOYMENT_ELIGIBLE`：RH Testnet 外部依赖快照、artifact/CREATE2/Hook/权限/ABI 证据和固定区块 Fork/E2E 已闭合。尚未广播交易；实际部署清单、AccessManager 安装与撤权、源码验证、独立审计和 canary soak 仍分别属于广播后或 production work。

## 8. 必须持续成立的不变量

1. 两个 Gauge clone 的 identity、position、reward、activation 与 forfeiture 状态互不影响。
2. implementation 不可直接作为市场 Gauge 使用，也不存在升级入口。
3. Gauge clone 没有 initializer；identity 只能来自部署 runtime。
4. Factory 预测地址、实际地址、salt、implementation 和 immutable args 必须完全一致。
5. Gauge 不托管 STOCK 本金或手续费资产。
6. Token/Curve 的构造期不变量不能被 clone 化或通用部署接口绕过。
7. LaunchLocker 的 Position NFT 和余额永远保持市场级隔离。
8. Resolver 不能写配置、缓存配置或替代三个 Registry 的权威性。
