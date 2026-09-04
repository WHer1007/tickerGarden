# TickerGarden V1 Readiness 与部署门禁

> **当前产品边界（2026-09-04）：** `V1-EXEC-9` 的市场自治与原子毕业架构已在本地实现并通过生成物与测试门禁；`launchPhase` 只允许 `NotGraduated -> PoolCreated`，资产/配置级 pause/retire 仍是独立对象状态。目标链部署、独立审计和生产 E2E 门禁仍开放。

> 规格任务：`V1-P-012`
> 当前状态：`IMPLEMENTATION_ALLOWED`  
> 机器权威：[`spec/v1_execution_manifest.json`](./spec/v1_execution_manifest.json) 的 `readiness`
> 更新时间：2026-09-04

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

Pons runtime/毕业向量、首发仅 native Quote、通用数值上界、“V1 首发无 batch ABI”，以及 Robinhood 官方目录全部 STOCK 的身份准入与194项点时观测已经闭合。可升级 USDG 仅作为历史观测证据，不属于首发 ACTIVE 配置；后续 ERC-20 Quote 必须是已审计且通过 finalized-block 不可升级身份门禁的直接合约。194 个当前观测为 `ACTIVE` 的官方 STOCK 均可由 Meme 创建者任选一个作为该市场唯一且不可变的 staking base；每个非零 allocation 使用管理员按 Asset UID 动态设置的 `minimumAllocation`，且不得低于414 raw units；存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配。协议不读取 STOCK 价格，不计算美元名义价值，也不以 Chainlink Feed、sequencer 或 backing target 覆盖率作为准入条件。当前 implementation open gates 已清空且本地产品资金逻辑已实现；deployment 与 production gate 仍然开放，不能部署到目标网络或宣称生产就绪。

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

active Pons runtime 差分、非空首发 Quote、通用数值/overflow 上界、batch scope，以及官方 STOCK 全目录身份准入/194项点时观测已经分别由 `spec/v1_pons_runtime_evidence.json`、`spec/v1_initial_quote_configs.json`、`spec/v1_numeric_bounds.json`、manifest 与 `spec/v1_rh_official_stock_catalog.snapshot.json` 固化。`V1-EXEC-9` 的 implementation gate 已全部关闭：市场创建时必须从 ACTIVE 官方目录选择且只选择一个 `assetUid`，之后不可改绑；同一 STOCK 可被任意多个 Meme 市场选用；毕业后持有者自行决定是否向对应市场分配该 STOCK；每个非零 allocation 使用管理员按 Asset UID 动态设置的 `minimumAllocation`，且不得低于414 raw units；存在 Active stake 时按 Creator40%/Staker30%/Platform30% 分配，无 Active stake 时按 Creator70%/Staker0%/Platform30% 分配。STOCK 价格、Feed 和 backing target 不属于 implementation 证据。

进入 `DEPLOYMENT_ELIGIBLE` 前还必须有：目标 chainId/RPC/finalized block hash、所有模块 artifact/地址/init/runtime codehash、四组件 CREATE2 向量、Hook 低位权限证明、AccessManager target-selector-role-delay 精确 diff、四个配置 Registry 各自的 `authority()` 绑定证明、Treasury `authority()`/canonical `marketRegistry()` 不可变绑定证明、编译 ABI/event 精确 diff，以及产品/Fork/E2E 测试。

进入 `PRODUCTION_READY` 前还必须有：Critical/High 审计问题为0、Pons 参考许可与法律批准、deployer 权限移交/撤销、源码和可复现构建验证、监控告警与事故 runbook，以及至少72小时 canary soak。

具体 open gate ID 只在机器清单维护；本文不复制一份可漂移的当前列表。

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
- preflight 必须在同一 finalized block 重取每个实际启用的直接 ERC-20 Quote 与官方 STOCK 的 canonical token、runtime/codehash、decimals、代理/Beacon/implementation 及 exact-balance-delta 资产事实；ERC-20 Quote 还必须证明 `proxyKind == NONE`、implementation 等于 token、EIP-1967 implementation/admin/beacon 三槽为零，且 runtime 不含可执行 `CALLCODE`、`DELEGATECALL` 或 `SELFDESTRUCT`。与已批准身份指纹不一致即拒绝。该检查验证资产身份与转账行为，不验证或读取 STOCK 价格。
- `assertV1Deployable` 只接受 `DEPLOYMENT_ELIGIBLE/PRODUCTION_READY`；生产发布还必须单独通过 `assertV1ProductionReady`。
- 没有 production manifest 时不表示通过；只表示尚无文件可扫描，readiness gate 仍阻止部署。

## 6. 不变量

1. 顶层 `status == readiness.state == derive(gateSets)`。
2. 三组 open gate ID 不重复；关闭 gate 必须同时附对应证据。
3. 不允许跳级、混用名称或以 `FROZEN_FOR_IMPLEMENTATION` 等旧状态代替四态。
4. 未达到 `DEPLOYMENT_ELIGIBLE` 时部署函数始终 fail closed。
5. 未达到 `PRODUCTION_READY` 时生产开放函数始终 fail closed。
6. production manifest 的占位符例外只能缩小到具体 schema path，不能关闭扫描器。
