# TickerGarden V2-M0 阻塞审计

> 历史审计档案说明：本文中的 `V2-EXEC-3`、10 STOCK 线性释放和相关测试结论保留为历史证据，不代表当前执行规则。当前规范为 `V2-EXEC-5`。

> 审计日期：2026-09-02  
> 结论：`IMPLEMENTATION_ALLOWED / DEPLOYMENT_GATES_OPEN`  
> 决策包：[`V2_G0_RECOMMENDATIONS.md`](./V2_G0_RECOMMENDATIONS.md)  
> 外部证据：[`V2_G0_EXTERNAL_EVIDENCE.md`](./V2_G0_EXTERNAL_EVIDENCE.md)

## 1. 当前完成度

| 任务 | 状态 | 当前证据 |
|---|---|---|
| V2-P-001 | DONE | 唯一 MarketRegistry 状态权威 |
| V2-P-002 | DONE | canonical ABI、selector、event topic 与权限词汇 |
| V2-P-003 | DONE | 组合调用身份传递 |
| V2-P-004 | DONE | Creator revenue epoch |
| V2-P-005 | DONE | [`spec/v2_pons_runtime_evidence.json`](./spec/v2_pons_runtime_evidence.json) 已固定活跃 runtime 3 秒 anti-snipe 与 native/ERC20 graduation receipt 向量，并由独立整数模型复核 |
| V2-P-006 | DONE | Emergency/Recovery 生命周期 |
| V2-P-007 | DONE | [`spec/v2_numeric_bounds.json`](./spec/v2_numeric_bounds.json) 已给出泛化数值域、生命周期上界与 accumulator 证明；STOCK 只按 raw-unit 数量分配，不需要价格或 target |
| V2-P-008 | DONE | typed ID/hash/template/pool discovery |
| V2-P-009 | DONE | migration/rescue/timing |
| V2-P-010 | DONE | Pons/多Quote/创建费/首买与官方全量 STOCK 身份准入已批准；当前观测的194种 ACTIVE 官方 STOCK 均可由市场创建者任选一个作为不可变 staking base |
| V2-P-011 | DONE | Emergency/Graduation/Curve sweep/事件 owner/template 部署模式与 immutable 创建费 ABI 已闭合 |
| V2-P-012 | DONE | 四态 readiness、同源 deployment preflight 与 production placeholder policy |
| V2-T-001 | DONE | Curve、尾单、毕业池 Meme、CREATE2、runtime anti-snipe、graduation receipt、官方 STOCK base 选择、10 STOCK线性手续费分桶与价格无关不变量均已覆盖 |
| V2-T-002 | DONE (PRE-ARTIFACT) | Markdown/manifest/ABI/权限/event/readiness/placeholder 一致性；compiled product artifact 出现后启用 exact diff |

## 2. 已穷尽的参数无关工作

`spec/test_v2_execution_spec.py` 覆盖：

- 79个 mutation 的 canonical selector、caller、delay、precondition 和 recipient；
- 53个 event 的 canonical signature 与 topic0；
- 11类 domain-separated typed hash 的固定 Keccak-256 向量；
- 唯一市场状态权威、creator epoch、Emergency root、迁移与七日 rescue；
- 供应保留量与 Curve/Pool fee 分桶的整数守恒；
- Pons-compatible amountOut/amountIn、buy/sell fee 顺序、尾单部分成交与退款；
- `reservedTokens/sweptTokens/poolMemeAmount/lockedExcessMeme` 分区与 CREATE2 四组件固定地址；
- 池级 accumulator remainder 与用户 remainder 守恒；
- 32槽激活轮的30秒边界、聚合、清理和 collision fail-closed；
- 活跃 runtime 3 秒 anti-snipe 的 `[9900, 618, 19, 0]` 衰减、fee interaction 与 exempt 路径；
- native/ERC20 graduation 的 swept quote/token、pool Meme、excess Meme、sqrtPrice、tick/liquidity 和 permissionless caller trace；
- 泛化 decimals、uint/int 边界、fee accumulator 生命周期和 activation timestamp 的数值域证明；
- Robinhood 官方目录当前194项 Asset UID/token/18 decimals、共享 Beacon/implementation 的固定区块链上复核，以及目录数量非协议上限的准入规则；
- 194项当前 ACTIVE 官方 STOCK 均可作为市场唯一 staking base，目录规模不是协议上限，同一 STOCK 可服务任意多个 Meme 市场；
- `B=10×10^stockDecimals`，`S=0` 时总费约40/0/40/20，`0<S<B` 时按 `min(S,B)/B` 线性释放质押者份额，`S>=B` 时约20/40/20/20；质押者桶内部按有效 STOCK raw-unit 比例结算；
- STOCK 价格、Chainlink Feed、sequencer 和 backing target 不进入 ABI、MarketConfig、hash、事件或准入判定；旧价格研究只作为 `V2-EXEC-1` 历史资料；
- 外部证据必须固定区块，且 `OBSERVED`/`PROPOSED` 不得被测试或实现静默当成 `APPROVED`。
- Emergency 单参数 ABI/链上计算职责、自动毕业事件所有权、创建费不可变与四态 readiness/placeholder 门禁。

## 3. 为什么现在可以开始实现

### V2-P-005（已关闭）

产品已选择活跃 `0x7eD598…` 固定行为作为参考。runtime evidence 固定了 3 秒反狙击衰减，并提供 native/ERC20 graduation receipt；`reservedTokens`、Curve buy/sell、尾单、pool 分区及 v4 初始池参数均由独立整数模型复核。公开 GitHub `main` 与 runtime 不一致仍需保留为证据说明，但不再是实现阻塞。

### V2-P-007（已关闭）

`INDEX_PRECISION=1e27` 的算法及泛化溢出/生命周期上界已在 `v2_numeric_bounds.json` 证明。官方目录当前194项资产的准入身份已经逐项验证；STOCK 仅作为份额权重，协议不需要统一 `targetUsd18` 或 Stock 价格。

### V2-P-010（已关闭）

Pons 行为参考、多 Quote 能力、首发 native + USDG、`0.0005` 原生创建费、无1%人为首买上限，以及 Robinhood 官方 STOCK 全量身份准入已经批准。每个 Meme 创建时从 ACTIVE 官方目录选择恰好一种 STOCK，绑定后不可修改；同一 STOCK 可被多个市场选择。USDG 与官方 STOCK 均可能采用可升级实现，因此部署前仍必须重取资产身份和 implementation/codehash 指纹，但不需要任何价格或 sequencer Feed。Batch 已明确移出 V2 首发范围。

### V2-T-001（已关闭）

参考模型现已覆盖 Pons buy/sell、fee 顺序、partial fill/refund、供应分区、毕业池 Meme 二次分区、CREATE2、runtime anti-snipe、完整 Graduation 差分、泛化数值域、官方 STOCK base 选择和10 STOCK饱和的线性手续费分桶。价格专属生成器与快照被保留为 `V2-EXEC-1` 历史研究，但不再是当前执行规范输入。

### V2-M1 及以后

无业务 namespace/scaffold 已建立，readiness 由空的 implementation open gates 推导为 `IMPLEMENTATION_ALLOWED`。下一步可以实现接口、Registry、Factory/Curve、Graduation、Vault/Gauge 和 Hook；任何目标网络部署仍必须等 deployment gate 全部关闭。

## 4. 后续执行顺序

下一执行顺序固定为：

```text
实现接口/产品合约，并保持“每市场恰好一个 ACTIVE 官方 STOCK base”的不可变绑定
→ 用最终 artifact 生成 ABI/initCodeHash/CREATE2 向量
→ 在目标 finalized block 重取实际启用资产的身份、runtime/codehash、decimals 与转账行为证据
→ 完成 unit/fuzz/invariant/Fork/E2E 与权限精确 diff
→ 关闭 deployment gates 后进入 DEPLOYMENT_ELIGIBLE
→ 完成审计/法律/角色/监控/72h soak 后进入 PRODUCTION_READY
```
