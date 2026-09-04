# TickerGarden V1 正式用户前端

`website-fruit-tree/` 是 TickerGarden V1 面向用户的唯一正式前端。原辅助前端已迁入 `archive/legacy-website/`，只作历史追溯，不参与活动构建、测试、CI、部署或功能对接。

当前仓库 readiness 为 `IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`。本地实现允许继续开发，但这不表示目标链部署、实链 E2E 或生产发布已经获批。

## 页面

- `index.html`：首页与产品入口
- `markets.html`：市场浏览
- `trade.html`：市场交易
- `create.html`：创建市场
- `stats.html`：统计
- `faq.html`：FAQ 与边界说明
- `rewards.html`：Rewards（保持名称），承载 Position、Staker、Creator、Treasury

## 真实接入能力

- read API：健康、同步状态、配置、市场与用户 Position 读取
- Factory：canonical 市场创建、预览及运行时绑定校验
- LaunchRouter：原生币/ERC-20 launch-and-buy 路径
- Curve：买入/卖出报价、精确授权、模拟、提交及 canonical 事件/回执确认
- AllocationManager：Position 存入、分配、关闭、rageQuit 与奖励清理
- UserStockVault direct principal exit：只依赖钱包、配置的 rageQuit Factory 和链上 Factory→Registry→Vault 不可变身份图；即使 read API、Gauge、奖励读取或市场阶段不可用，仍可模拟并直接提出完整已分配本金
- FeeVault：Staker/Creator 费用读取与领取
- CreatorRegistry：Creator beneficiary 与 epoch 读取/更新
- TreasuryDistributor：Treasury epoch、Merkle root、领取状态、claim 与 Root 服务费退款 credit 提取
- Treasury Proof API：按账户/epoch 获取并在本地重建校验 Treasury proof

这些是真实运行时接入边界；它们不表示目标链已部署或生产交易已完成。毕业后的 Pool route 可以被读取和展示，但 Pool swap 当前保持锁定：开放它还需要冻结 Robinhood Chain V4 Router/Quoter 地址、runtime codehash、精确 quote/swap ABI、Permit2/native settlement 与 deadline 语义，并通过 live Fork 和浏览器实链 E2E。前端不会猜测 calldata 或使用未经 deployment evidence 绑定的 Router。

## Vite 环境变量

```text
VITE_V1_READ_API_URL
VITE_V1_FACTORY_ADDRESS
VITE_V1_LAUNCH_ROUTER_ADDRESS
VITE_V1_ALLOCATION_MANAGER_ADDRESS
VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS
VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS
VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS
VITE_V1_TREASURY_PROOF_API_URL
VITE_V1_TREASURY_RELEASE_APPROVAL
```

缺少、格式非法、健康检查失败或配置地址无法与 Factory/Registry canonical 绑定一致时，前端必须 fail closed：不报价、不模拟、不签名、不提交资金敏感操作。

唯一有意独立于 read API 发布门的是 `Rewards > Positions > Direct vault principal exit`。该入口只使用 `VITE_V1_FACTORY_ADDRESS` 作为 rageQuit Factory，从 Factory 的 immutable `runtimeBindings()` 解析 MarketRegistry 与 OfficialStockRegistry，再核验 market→assetUid、asset→Stock/Vault、`vaultIdentity()`、Registry schema 反向绑定及用户实际 allocation。它不读取 Gauge、奖励、lock、minimumAllocation、asset active 状态或 market phase；回执必须同时包含 canonical `AllocationRageQuit`/`StockWithdrawn`，并证明 receipt block 的 allocation 已归零且钱包收到精确本金。

`VITE_V1_TREASURY_RELEASE_APPROVAL` 是独立的 Treasury 写操作上线门。只有完成目标链部署、真实链路 E2E 与上线批准后，部署方才可将其精确设置为 `V1-TREASURY-EXEC-1:DEPLOYED_E2E_APPROVED`。未设置时 Rewards 仍可读取并校验 Treasury 状态与 proof，但 `requestRoot`、`claim`、`finalizeRoot`、`expireRootRequest`、`rolloverExpiredEpoch` 和 `withdrawServiceCredit` 全部保持禁用；该开关不会误锁 Position、Staker 或 Creator 功能。

## Treasury 状态

Treasury 前端与合约能力均属于 V1 范围，但当前明确为 `NOT_DEPLOYABLE`，尚未完成实链 E2E，因此发布构建默认只读。Treasury Root 是 attested、publicly reproducible、review-delayed 的承诺，不是 trustless validity proof。此 README 不宣称部署完成、生产就绪或上线批准。
