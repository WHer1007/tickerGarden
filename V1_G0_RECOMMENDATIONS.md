# TickerGarden V1-M0 G0 决策登记

> **当前覆盖（2026-09-04）：** `V1-EXEC-9` 已在本地实现永久自治市场、最终买入原子毕业、对象级配置治理和即时本金 `rageQuit`。旧管理建议已归档；目标链部署与独立审计仍开放。

> 状态：`PRODUCT_DIRECTION_APPROVED / IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`  
> 当前执行规范：`V1-EXEC-9`
> 历史机器清单：[`spec/v1_g0_recommendations.json`](./spec/v1_g0_recommendations.json)
> 外部证据：[`V1_G0_EXTERNAL_EVIDENCE.md`](./V1_G0_EXTERNAL_EVIDENCE.md)

> 修订说明：Pons 链上观测仍保留旧 `V1-EXEC-3` 证据编号；Quote 准入、STOCK 分配和原子毕业规则已经按当前 `V1-EXEC-9` 决策修订。管理员按 Asset UID 动态设置 `minimumAllocation`（不得低于414 raw units）；手续费按 Active 状态分配为 Creator40/Staker30/Platform30 或 Creator70/Staker0/Platform30，余数归 Creator。

本文记录 2026-09-02 已确认的 Pons 参考方向，并把仍需逐资产/工程/安全验证的事项留作部署门禁。产品批准不等于允许把观测值或不一致的公开源码直接部署。

## 1. 推荐组合

| G0 | 已确认方案 | 工程边界 |
|---|---|---|
| Pons baseline | 官方文档当前活跃 Factory `0x7eD598…` 的固定 block/codehash 行为，不建立运行时依赖 | GitHub `main` 不是可复现 deployed source；必须独立实现并做 runtime 差分 |
| Quote | 首发仅批准 native；可升级 USDG 只保留为观测证据，不得 ACTIVE | 权威配置见 [`spec/v1_initial_quote_configs.json`](./spec/v1_initial_quote_configs.json)；后续 ERC-20 只能追加已审计的不可升级直接合约，并通过 codehash、decimals、禁用委托 opcode 与 EIP-1967 三槽为零的部署门禁 |
| Pons diff | 手续费路由与毕业后 STOCK 质押是产品差异；其余发行主链路继承 | TickerGarden 自有 ABI/Registry/CREATE2/测试向量是实现硬化，不复制 Pons 地址与权限 |
| Official STOCK Base | Robinhood 官方目录中存在 chainId 4663 deployment 的全部资产均可准入；当前观测194项 ACTIVE 资产全部可由创建者选择为市场唯一质押 Base | Asset UID + token + decimals + Beacon/implementation 在生产登记前逐项验证；管理员按Asset设置动态最低仓位，质押量无上限；价格、Feed 覆盖和 backing target 不参与准入或权重；194不是协议上限 |
| Launch friction | 当前 Factory 创建费 immutable 为 `0.0005` 原生资产，要求精确支付 | 不采用旧建议的 `5 USDG`、保证金、STOCK 资格或地址限速；改费必须新 Factory/Router/Template + 新 `executionSpecId` |
| Launch-and-buy | 继承原子创建+首买、尾单部分成交和退款；不设毕业门槛1%上限 | 只允许真实 creator/beneficiary 和首买 recipient 自动豁免；活跃 runtime 的 3 秒反狙击衰减已由固定向量锁定 |
| Batch | V1 首版不提供 batch ABI | 单市场入口永久保留；批量操作明确移出 V1 首发范围，不再等待 Gas 决策 |

## 2. 精确 Pons 差异矩阵

### 2.1 继承

- phantom reserve constant-product 数学与整数取整；
- 尾单部分成交、超额 Quote 退款和 `reservedTokens`；
- `poolMemeAmount = floor(sweptTokens × sweptQuote / (sweptQuote + phantomQuote))` 以及 excess Meme 永久锁定；
- native/ERC-20 多 Quote、逐资产 economics 和 decimals 复核；
- 精确原生创建费与 atomic launch-and-buy 付款语义；
- 冻结参数的反狙击衰减；
- 最终 Curve 买入自动触发毕业；TickerGarden 将其收窄为 `NotGraduated → PoolCreated` 同交易原子提交；
- 任一毕业步骤失败使最终买入整体回滚；不继承 Pons 的持久中间态、permissionless retry 或 owner/terminal rescue；
- canonical full-range 初始流动性永久锁定。

### 2.2 明确差异

- 使用 TickerGarden 自己的 CREATE2 domain、MarketRegistry、Token、Curve、Gauge、Hook 和 FeeVault 地址体系；
- 创建者附加税固定为0，属于 TickerGarden 手续费差异；
- Pons fee beneficiary 路由替换为 TickerGarden Curve `Creator70/Platform30`；毕业后无 active stake 时为 `Creator70/Staker0/Platform30/LP0`，存在 active stake 时固定为 `Creator40/Staker30/Platform30/LP0`，Staker 内部按实际 active STOCK 比例分配；
- 不使用 Pons BuybackVault/五年 vesting；
- 禁止任意团队反狙击豁免数组，只自动豁免真实 creator/beneficiary 与 atomic first-buy recipient；
- 不实现管理员 community takeover/creator override；创建者收益身份只按已冻结 epoch 规则迁移；
- launch-and-buy 由受认证的 TickerGarden Router 执行并保留外层 creator 身份。

## 3. 官方 STOCK Base 的状态

STOCK 准入范围已经确认：Robinhood 官方 Stock Token 目录中存在 chainId `4663` deployment 的全部资产都可准入，当前观测194项均为 ACTIVE，全部可以由市场创建者选择。每个市场恰好绑定一个 Base Asset UID 且不可改绑；同一 Asset UID 可以对应任意多个 Meme，持有人在毕业后自行决定是否分配及分配数量。点时目录和链上身份向量见 [`V1_OFFICIAL_STOCK_ADMISSION.md`](./V1_OFFICIAL_STOCK_ADMISSION.md) 与 [`spec/v1_rh_official_stock_catalog.snapshot.json`](./spec/v1_rh_official_stock_catalog.snapshot.json)。

STOCK 只以 raw balance 参与质押权重。不存在饱和值或质押上限；存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配，再按各用户实际 active raw balance 分配 Staker 份额。`OfficialStockRegistry`为每个Asset保存管理员延迟更新的`minimumAllocation`，其协议下限为414 raw units；该值只约束仓位变更，不进入market hash。价格、USD 名义目标、Chainlink Price Feed、sequencer 证据和 backing target 均不进入产品路径。生产登记仍须使用 finalized 状态验证官方身份与代理实现；这是部署安全取证，不是价格或实施参数门禁。旧价格研究仅按 [`spec/RETIRED_STOCK_PRICE_RESEARCH.md`](./spec/RETIRED_STOCK_PRICE_RESEARCH.md) 保留审计记录。

## 4. 已删除的旧建议

- “首发仅 USDG”删除；首发只启用 native，多 Quote 保留为后续追加能力且禁止可升级 Quote。
- “创建费 5 USDG”删除；初始费采用 Pons 当前 `0.0005` 原生资产语义。
- “首买最多毕业门槛1%”删除；曲线 partial fill 和滑点是唯一数量边界。
- “10,000 USD backing target”方案整体退出 `V1-EXEC-3`；STOCK 质押不读取价格。

## 5. 已关闭的前置验证

- P005：活跃 runtime 3 秒 anti-snipe 以及 native/ERC20 graduation receipt 已写入 [`spec/v1_pons_runtime_evidence.json`](./spec/v1_pons_runtime_evidence.json)，并由独立整数模型复核。
- P007：泛化数值域、生命周期上界和 accumulator 证明已写入 [`spec/v1_numeric_bounds.json`](./spec/v1_numeric_bounds.json)。
- 首发 Quote：仅 native 已批准；USDG 因可升级而不具备首发资格。后续不可升级直接 ERC-20 必须重新走 Registry、源码/行为审查和 finalized-block preflight。
- Batch：不属于 V1 首发能力，单市场入口为永久 ABI 约束。

## 6. 仍开放的分阶段门禁

1. Implementation：门禁为空，当前为 `IMPLEMENTATION_ALLOWED`；`V1-P-010`、`V1-T-001` 已按无价格 STOCK Base 规则闭合。
2. Deployment：最终 artifact ABI/codehash、initCodeHash、四组件 CREATE2 地址与目标链 Fork。
3. Production：Pons 参考许可、TickerGarden 独立审计、法律/角色/监控与72小时 soak 签字。

在上述门禁关闭前，不能宣称可部署、无需审计或已完成安全审计。

状态和完整 gate ID 不在本文重复维护，统一读取 `spec/v1_execution_manifest.json.readiness`。

发行主链路的正式说明见 [V1_PONS_BEHAVIOR_BASELINE.md](./V1_PONS_BEHAVIOR_BASELINE.md)，机器向量见 [`spec/v1_pons_behavior_vectors.json`](./spec/v1_pons_behavior_vectors.json)。
