# V1 可选 STOCK 质押（冻结提案）

本文记录即将冻结的可选质押接口语义。`stakingEnabled` 是创建时写入 `CreateMarketParams`、并快照到不可变 `MarketConfig` 的 `bool`；它属于市场身份和经济配置的一部分。创建后不得修改、开启、关闭或重新绑定。

## 规则

### 禁用（`stakingEnabled == false`）

- `assetUid == 0`，`gauge == address(0)`；不得部署 Gauge，也不得读取 Stock Registry、canonical token、Vault 或任何 STOCK 数据。
- 交易、毕业、创建者收益和持有者收益流程照常运行；基础手续费按 Creator 70% / Platform 30% 分配。
- 所有面向该市场的质押、取消分配、领取质押奖励等 staking calls 必须拒绝，且失败不得改变状态。

### 启用（`stakingEnabled == true`）

- 创建时必须提供有效的 ACTIVE STOCK 指纹和 Vault 绑定，`assetUid` 非零；Factory 校验 canonical token、decimals、Registry 状态及指纹。必须部署并绑定该市场唯一 Gauge。
- 毕业后按正常 STOCK 质押规则运行；质押资产、Gauge 和 Vault 身份均不可替换。
- 基础手续费为 Creator 70% / Platform 30%。毕业后若存在有效 Active stake，则为 Creator 40% / Staker 30% / Platform 30%；否则为 Creator 70% / Staker 0% / Platform 30%。

### 持有者选项与税

持有者费用分成选项独立于 `stakingEnabled`。启用后将基础 Creator share 减半；该减半只影响 Creator share，释放出的部分按已冻结的持有者路由分配。Creator tax 为 `0..500 bps`，税额全部归 Creator；税不得改变 Staker 或 Platform 的固定份额。两项配置都在创建时冻结。

## ExpectedEconomics schema v6

`expectedEconomics` 升级为 schema `v6`，必须明确承诺 `stakingEnabled` 及其对应分支：禁用时承诺零 `assetUid`、零 Gauge 和无 STOCK 依赖；启用时承诺 ACTIVE STOCK 指纹、canonical token/decimals、Vault 与 Gauge 身份。任何字段缺失、分支不一致、零值与启用状态冲突，均须在创建或预览时拒绝。旧 schema 不得被静默解释为 v6。

## 接受测试矩阵

| 场景 | 关键输入/前置 | 必须结果 |
|---|---|---|
| 禁用创建 | `stakingEnabled=false, assetUid=0` | 成功；Gauge 不部署；不调用 Stock lookup；MarketConfig 快照零值 |
| 禁用非零资产 | 禁用但 `assetUid != 0` 或 Gauge 非零 | 整笔回滚 |
| 禁用业务 | 交易、毕业、creator/holder payment | 正常；基础 Creator70/Platform30 |
| 禁用质押 | 任一 staking call | 拒绝且无状态变化 |
| 启用有效 | ACTIVE 指纹、canonical token、Vault 可验证 | 成功；部署唯一 Gauge；快照全部身份 |
| 启用无效 | 非 ACTIVE、指纹错误、缺 Vault 或零 UID | 整笔回滚；不得部署/登记部分组件 |
| 启用毕业无 stake | `PoolCreated` 且无 Active stake | Creator70/Staker0/Platform30 |
| 启用毕业有 stake | 存在 Active stake | Creator40/Staker30/Platform30 |
| holder 选项 | 独立启用 | 基础 Creator share 减半；不改变 stakingEnabled |
| creator tax | `0`、`500 bps`、超界值 | 边界值成功且全归 Creator；超界回滚 |
| 不可变性 | 尝试 toggle 或 rebinding | 拒绝；assetUid、Gauge、Vault、schema 承诺不变 |
| schema | v5/缺字段/分支不一致 | 拒绝；不得向后静默兼容 |

## 发布状态

本文是待当前代码、ABI、测试和部署证据验证的规则文档，不构成 release readiness、`DEPLOYMENT_ELIGIBLE` 或广播声明。此前 `a5cd19b` 的证据视为过期，除非按当前实现重新验证。
