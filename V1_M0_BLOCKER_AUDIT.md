# TickerGarden V1-M0 阻塞审计

> 当前执行规范：`V1-EXEC-6`；readiness：`IMPLEMENTATION_ALLOWED / NOT_DEPLOYABLE`；更新：2026-09-04。

## 已关闭的本地实现项

| 范围 | 结论 |
|---|---|
| 市场自治 | 已部署市场只有单向 `launchPhase` 事实，没有平台干预入口 |
| 用户本金 | `rageQuit` 先返还完整本金，奖励失败只能进入异步清理 |
| 配置治理 | Asset、Quote、Pons baseline、Launch template 仅控制新增准入/新增敞口 |
| 合约与 ABI | 18 个 canonical 产品模块；源码、接口和 product artifact 已同步 |
| 权限与部署 schema | 70 个协议 mutation、3 类协议角色；无部署后市场管理角色 |
| 链下消费者 | Indexer、Backend、Website 与 maintenance runner 已同步 `V1-EXEC-6` |
| 本地验证 | Foundry 612、规格 59、链下与 Web 全部测试通过 |

旧 V1-EXEC-5 的市场状态、Controller、管理型 Recovery、force-release 与状态乘积结论已归档，不是当前产品能力或安全回退方案。

## Deployment blockers

进入 `DEPLOYMENT_ELIGIBLE` 前仍需：

1. 确认 Robinhood Chain 测试/归档 RPC、目标 chainId 与同一 finalized block；
2. 对 PoolManager、PositionManager、Permit2、Router、Quoter、USDG 和将启用的官方 STOCK 重新获取地址、代理/Beacon implementation 与 codehash；
3. 生成无占位符的 production manifest，并完成 18 个共享模块/implementation、CREATE2 Token/Curve/Gauge/Locker、Hook permission bits 和 AccessManager role/delay 精确 diff；
4. 在固定目标块完成 live Fork、部署、源码验证和完整发行—交易—毕业—质押—手续费—退出 E2E；
5. 对目标链实际 Gas、reorg/finality、RPC 限流和监控行为形成证据。

在这些证据完成前，部署入口继续 fail closed。

## Production blockers

进入 `PRODUCTION_READY` 前仍需：

- 独立安全审计关闭全部 Critical/High；
- 完成 Pons 来源/许可与 Stock 收益产品的法律、地区准入和风险披露签字；
- 完成 deployer 权限移交/撤销、监控告警、事故 runbook 和至少 72 小时 canary soak；
- 浏览器实链 E2E 与运维演练通过。

机器权威始终是 [`spec/v1_execution_manifest.json`](./spec/v1_execution_manifest.json) 与部署 manifest；本文不复制会漂移的 gate ID 清单。
