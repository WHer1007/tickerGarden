> 2026-09-06 更新：R3 测试链版本已部署，使用 7 天持有人周期与 0.42 ETH 测试毕业门槛。此前重命名候选的 NOT_BROADCAST / 阻塞记录属于历史阶段；当前验证范围和时间限制以 [R3 测试报告](../../outputs/reviews/arbitrum-r3-scenarios/REPORT.md) 为准。RH 生产就绪仍未确认。

> Historical 2026-09-05 pre-brand-renaming verification: that revision was `DEPLOYMENT_ELIGIBLE`, with eight production gates still open. Historical verification is recorded in [`outputs/reviews/optional-stock-staking/`](../../outputs/reviews/optional-stock-staking/) and [`deployments/evidence/v1-optional-staking-gates.json`](../../deployments/evidence/v1-optional-staking-gates.json). No release certificate exists and no broadcast was performed; the older evidence remains historical (`STALE`).

Current brand-renamed candidate: `IMPLEMENTATION_ALLOWED / NOT_BROADCAST`. Gate `V1-DEPLOY-ARTIFACT-CODEHASH-01` requires new release identity, ABI/codehash review and deployment rehearsal. Earlier R2 evidence is historical and does not certify these renamed sources.

# TickerGarden V1 Readiness 与部署门禁

> 历史说明：早先 Treasury 修复阶段的 `IMPLEMENTATION_ALLOWED` 与旧部署证据失效结论仅适用于当时的候选版本；上述旧候选曾由同一版本的完整验证重新取证，品牌重命名后的候选需新的 release 证明。


> **历史产品验证记录（2026-09-05，重命名前）：** `V1-EXEC-11` 的市场自治与原子毕业架构已通过生成物、确定性部署编排、测试网依赖核验及固定区块 Fork/E2E。`launchPhase` 只允许 `NotGraduated -> PoolCreated`，资产/配置级 pause/retire 仍是独立对象状态。当前没有广播测试网交易或 release certificate；独立审计和生产 E2E 门禁仍开放。

> 规格任务：`V1-P-012`
> 当前状态：`IMPLEMENTATION_ALLOWED`
> 机器权威：[`spec/v1_execution_manifest.json`](../../spec/v1_execution_manifest.json) 的 `readiness`
> 更新时间：2026-09-05

本文只定义某个 `executionSpecId` 可以做什么，不替代协议状态机。产品市场的 `launchPhase` 与发布工程的 readiness 是两个完全独立的状态域。

## 1. 唯一四态模型

```text
SPEC_FROZEN_NOT_DEPLOYABLE
    -> IMPLEMENTATION_ALLOWED
    -> DEPLOYMENT_ELIGIBLE
    -> PRODUCTION_READY
```

| 状态 | 允许 | 禁止 |
|---|---|---|
| `SPEC_FROZEN_NOT_DEPLOYABLE` | 文档、机器规范、生成器、参考模型、测试和无业务 scaffold | 产品/资金逻辑实现、网络部署、生产声明 |
| `IMPLEMENTATION_ALLOWED` | 实现产品合约与链下产品逻辑、单元/fuzz/invariant 测试 | 将未校验 artifact 部署到目标网络 |
| `DEPLOYMENT_ELIGIBLE` | 对已冻结目标链执行部署、验证和 canary | 宣称生产就绪或开放真实用户资金 |
| `PRODUCTION_READY` | 按已签字 manifest 开放生产 | 对该证书静默修改参数、代码、角色或地址 |

Pons runtime/毕业参考向量、管理员审核白名单的多 Quote 能力、通用数值上界、“V1 首发无 batch ABI”，以及 Robinhood 官方目录全部 STOCK 的质押 Base 身份准入与194项点时观测已经闭合。`NATIVE_ETH_V1` 只是 bootstrap 示例，不是 Quote 上限；任意 Token（包括 USDG、cbBTC 与可升级 Stock proxy）均可在管理员逐资产风险审核后通过通用 `addQuoteConfig` 进入白名单。代理槽、implementation、runtime/codehash、decimals、源码/行为和 exact-balance-delta 等事实继续作为审核与运行时证据，但代理身份或 opcode 类型本身不构成通用拒绝条件。194 个当前观测为 `ACTIVE` 的官方 STOCK 均可由 Meme 创建者任选一个作为该市场唯一且不可变的 staking base；每个非零 allocation 使用管理员按 Asset UID 动态设置的 `minimumAllocation`，且不得低于414 raw units；存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配。质押 Base 路径和链上市场运行不读取 STOCK 价格，不计算美元名义价值，也不以 Chainlink Feed、sequencer 或 backing target 覆盖率作为 Base 准入条件。

少量 Robinhood 官方 Stock Token 作为 Quote、并使用官方链下 API 生成创建时价格参考的产品方向已写入 [`V1_STOCK_QUOTE_PRICE_REFERENCE.md`](./V1_STOCK_QUOTE_PRICE_REFERENCE.md)。`V1-EXEC-11` 的专用 BeaconProxy 指纹承诺、身份漂移 fail-closed、部署 preflight 与固定区块真实 Stock Token Fork 均已验证；可选的 `addStockQuoteConfig` 是更严格的证据承诺路径，不取代通用管理员白名单。194 个 Base 不自动成为 Quote，Stock Quote 激活状态为 `NO_ACTIVE_CONFIG`。确定性价格配置生成器和产品参数/首批 allowlist 仍属于 `PENDING_PRODUCT_ACTIVATION`，不得混写为 runtime 或技术部署门未完成。

## 2. 确定性推导

`readiness.gateSets` 分为 implementation、deployment、production 三组。判定顺序固定：

```text
if implementation.open is non-empty:
    SPEC_FROZEN_NOT_DEPLOYABLE
else if deployment.open is non-empty:
    IMPLEMENTATION_ALLOWED
else if production.open is non-empty:
    DEPLOYMENT_ELIGIBLE
else:
    PRODUCTION_READY
```

三个布尔值也只能由 state 派生：

```text
implementationAllowed = state >= IMPLEMENTATION_ALLOWED
deploymentEligible     = state >= DEPLOYMENT_ELIGIBLE
productionReady        = state == PRODUCTION_READY
```

禁止人工设置布尔值绕过 open gate。CI、deployment preflight、Web 状态和 release 签字必须读取同一 manifest 并使用同一个推导函数。

状态是某个不可变 `executionSpecId` 的发布证书，只允许逐级前进。若已签字证据失效，不把旧证书“降级后继续使用”；应停止相应发布与前端新增准入、撤销发布资格，并创建新的 execution spec/release 记录重新走门禁。该发布控制不得转化为对既有市场的链上干预入口。

## 3. 各阶段最低证据

active Pons runtime 差分、非空首发 Quote、通用数值/overflow 上界、batch scope，以及官方 STOCK 全目录质押 Base 身份准入/194项点时观测已经分别由 `spec/v1_pons_runtime_evidence.json`、`spec/v1_initial_quote_configs.json`、`spec/v1_numeric_bounds.json`、manifest 与 `spec/v1_rh_official_stock_catalog.snapshot.json` 固化。`V1-EXEC-11` 的现有 implementation gate 已全部关闭：市场创建时必须从 ACTIVE 官方目录选择且只选择一个 `assetUid`，之后不可改绑；同一 STOCK 可被任意多个 Meme 市场选用；毕业后持有者自行决定是否向对应市场分配该 STOCK；每个非零 allocation 使用管理员按 Asset UID 动态设置的 `minimumAllocation`，且不得低于414 raw units；存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配。质押 Base 的 STOCK 价格、Feed 和 backing target 不属于现有 implementation 证据；Stock Quote 扩展必须另行建立证据和门禁。

当前 `DEPLOYMENT_ELIGIBLE` 证据由 [`deployments/evidence/v1-optional-staking-gates.json`](../../deployments/evidence/v1-optional-staking-gates.json) 记录，验证详情见 [`outputs/reviews/optional-stock-staking/`](../../outputs/reviews/optional-stock-staking/)。旧 [`v1-deployment-gates.json`](../../deployments/evidence/v1-deployment-gates.json) 保留为 `STALE` 历史证据。测试网计划仍要求在广播前再次读取 latest 依赖代码；公共 RPC 只提供近期状态，固定历史 Fork 需要 archive-capable RPC。

进入 `PRODUCTION_READY` 前还必须有：Critical/High 审计问题为0、Pons 参考许可与法律批准、deployer 权限移交/撤销、源码和可复现构建验证、监控告警与事故 runbook，以及至少72小时 canary soak。

当前 deployment 与 production 集合均可能存在 open gate；具体 ID 只在机器清单维护，本文不复制一份可漂移的列表。

## 4. Production manifest 占位符规则

规则只扫描 `deployments/manifests/*.production.json`；参考向量和测试 fixture 可以使用显式标注的 synthetic 值，但不能复制到生产 manifest。生产文件遇到以下任一项直接失败：

- `null`、空字符串、空数组或空对象；
- 未在 path allowlist 中声明语义的零地址/零 hash；
- 重复字节或低熵 address/hash，例如 `0x1111…`、`0xaaaa…`；
- 包含 `draft/example/placeholder/tbd/todo/changeme/sample` 的状态或值；
- 来自参考 vector 的 fixture 地址、salt、hash 或伪造 codehash；
- production Quote 列表为空，或关键 artifact/role/chain evidence 缺失。

零值例外必须同时由 schema 路径和业务语义限定。当前只预留 native Quote 的 `address(0)`、市场初始 `poolId` 和初始 binding status；不能因为“某字段可能为零”而全局放行零地址或零 hash。

## 5. CI 与 preflight

- 规格测试校验 state、布尔值、gate 集合和文档/ABI/权限的一致性。
- deployment 包从机器清单读取 open gates，不保存第二份 readiness 常量。
- preflight 在任何交易、RPC 写入或签名请求前先执行 readiness 与 placeholder 校验。
- 当前 preflight 必须在同一 finalized block 重取每个实际启用 Quote、官方 STOCK Base 与可选 Stock Quote 的 canonical token、runtime/codehash、decimals、代理/Beacon/implementation 及 exact-balance-delta 资产事实；这些事实用于核对管理员批准的配置和风险证据，代理身份或 opcode 类型不构成通用拒绝条件。与已批准配置的内容哈希、decimals、代码存在性或转账记账事实不一致即拒绝。Stock Quote 专用指纹承诺和真实代理转账路径已在固定区块 Fork 中验证；价格生成器、首批参数/allowlist 与浏览器上线 E2E 仍是产品激活或生产门禁，且链下价格不得成为运行中市场的结算输入。
- `assertV1Deployable` 只接受 `DEPLOYMENT_ELIGIBLE/PRODUCTION_READY`；生产发布还必须单独通过 `assertV1ProductionReady`。
- 没有 production manifest 时不表示生产通过；它不阻止已取得技术资格的测试网 rehearsal，但始终阻止生产开放。

## 6. 不变量

1. 顶层 `status == readiness.state == derive(gateSets)`。
2. 三组 open gate ID 不重复；关闭 gate 必须同时附对应证据。
3. 不允许跳级、混用名称或以 `FROZEN_FOR_IMPLEMENTATION` 等旧状态代替四态。
4. 未达到 `DEPLOYMENT_ELIGIBLE` 时部署函数始终 fail closed。
5. 未达到 `PRODUCTION_READY` 时生产开放函数始终 fail closed。
6. production manifest 的占位符例外只能缩小到具体 schema path，不能关闭扫描器。
