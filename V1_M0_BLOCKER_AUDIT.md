# TickerGarden V1-M0 阻塞审计

> 当前执行规范：`V1-EXEC-10`；readiness：`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`；更新：2026-09-04。

## 已关闭的本地实现项

| 范围 | 结论 |
|---|---|
| 市场自治 | 已部署市场只有单向 `launchPhase` 事实，没有平台干预入口 |
| 用户本金 | `rageQuit` 先返还完整本金，奖励失败只能进入异步清理 |
| 配置治理 | Asset、Quote、Pons baseline、Launch template 仅控制新增准入/新增敞口 |
| 合约与 ABI | 19 个 canonical 产品模块（含 TreasuryDistributorV1）；源码、接口和 product artifact 已同步 |
| 权限与部署 schema | 83 个协议 mutation（22 个角色门控、61 个 immutable direct/public/module caller）、5 类协议角色；Root publisher 与 independent reviewer 分离；四个配置 Registry 分别证明绑定同一 canonical AccessManager；无部署后市场管理角色 |
| 链下消费者 | Indexer、Backend、Website、Rewards/Treasury 前端与 maintenance runner 已同步 `V1-EXEC-10` |
| 本地验证 | 根目录 `npm test` 聚合验证 60 项执行规范、全部 Foundry/状态化不变量、链下与 Web；具体动态计数以当次 CI 输出为准 |

## 用户前端归属与 Treasury 边界

V1 唯一正式用户 UI 为 `website-fruit-tree/`；其中 `Rewards` 保持名称并承载 Position、Staker、Creator、Treasury。原辅助前端已迁入 `archive/legacy-website/`，只作历史追溯，不参与构建、测试、CI、部署或功能对接。正式前端对 read API、Factory、LaunchRouter、AllocationManager、FeeVault、CreatorRegistry、TreasuryDistributor 和 Treasury Proof API 执行配置、健康及 canonical 绑定校验，失败即 fail closed。

Treasury 属于 V1，但当前仍为 `NOT_DEPLOYABLE`，未完成实链 E2E。上述前端归属说明不改变本审计既有 readiness 或部署阻塞结论。

旧 V1-EXEC-5 的市场状态、Controller、管理型 Recovery、force-release 与状态乘积结论已归档，不是当前产品能力或安全回退方案。

## Deployment blockers

进入 `DEPLOYMENT_ELIGIBLE` 前仍需：

1. 确认 Robinhood Chain 测试/归档 RPC、目标 chainId 与同一 finalized block；
2. 对 PoolManager、PositionManager、Permit2、Router、Quoter、USDG 和将启用的官方 STOCK 重新获取地址、代理/Beacon implementation 与 codehash；
3. 提供 Governance、Guardian、Security/Unpause、Treasury Root Publisher、Independent Root Reviewer 角色成员及 Platform Treasury 的最终地址，生成无占位符的 production manifest，并完成 19 个共享模块/implementation、CREATE2 Token/Curve/Gauge/Locker、Hook permission bits 和 AccessManager role/delay 精确 diff；
4. 冻结 V4 Router/Quoter 的目标链地址、runtime codehash、精确 ABI、Permit2/native settlement 与 deadline 语义；在此之前正式前端继续锁定毕业后 Pool swap；
5. 在固定目标块完成 live Fork、部署、源码验证和完整发行—Curve 交易—毕业—Pool 交易—质押—手续费—Treasury—退出 E2E；
6. 对目标链实际 Gas、reorg/finality、RPC 限流和监控行为形成证据。

在这些证据完成前，部署入口继续 fail closed。

## Production blockers

进入 `PRODUCTION_READY` 前仍需：

- 独立安全审计关闭全部 Critical/High；
- 完成 Pons 来源/许可与 Stock 收益产品的法律、地区准入和风险披露签字；
- 完成 deployer 权限移交/撤销、监控告警、事故 runbook 和至少 72 小时 canary soak；
- 浏览器实链 E2E 与运维演练通过。

机器权威始终是 [`spec/v1_execution_manifest.json`](./spec/v1_execution_manifest.json) 与部署 manifest；本文不复制会漂移的 gate ID 清单。
