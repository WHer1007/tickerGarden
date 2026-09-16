# TickerGarden V1-M0 阻塞审计

> 当前执行规范：`V1-EXEC-11`；readiness：`DEPLOYMENT_ELIGIBLE / NOT_PRODUCTION_READY / NOT_BROADCAST`；更新：2026-09-05。

## 已关闭的本地实现项

| 范围 | 结论 |
|---|---|
| 市场自治 | 已部署市场只有单向 `launchPhase` 事实，没有平台干预入口 |
| 用户本金 | `rageQuit` 先返还完整本金，奖励失败只能进入异步清理 |
| 配置治理 | Asset、Quote、Pons baseline、Launch template 仅控制新增准入/新增敞口 |
| 合约与 ABI | 19 个 canonical 产品模块（含 TreasuryDistributorV1）；源码、接口和 product artifact 已同步 |
| 权限与部署 schema | 84 个协议 mutation（23 个角色门控、61 个 immutable direct/public/module caller）、5 类协议角色；Root publisher 与 independent reviewer 分离；四个配置 Registry 分别证明绑定同一 canonical AccessManager；无部署后市场管理角色 |
| 链下消费者 | Indexer、Backend、Website、Rewards/Treasury 前端与 maintenance runner 已同步 `V1-EXEC-11` |
| 本地验证 | 根目录 `npm test` 聚合验证 61 项执行规范、全部 Foundry/状态化不变量、链下与 Web；具体动态计数以当次 CI 输出为准 |

## 用户前端归属与 Treasury 边界

V1 唯一正式用户 UI 为 `apps/web/`；其中 `Rewards` 保持名称并承载 Position、Staker、Creator、Treasury。原辅助前端位于 `archive/legacy-website/`，只作历史追溯，不参与构建、测试、CI、部署或功能对接。正式前端对 read API、Factory、LaunchRouter、AllocationManager、FeeVault、CreatorRegistry、TreasuryDistributor 和 Treasury Proof API 执行配置、健康及 canonical 绑定校验，失败即 fail closed。

Treasury 属于 V1，并已纳入技术 deployment evidence；但尚未实际部署，也未取得独立的 Treasury holder 写操作上线批准。上述前端归属说明不改变生产门禁。

旧 V1-EXEC-5 的市场状态、Controller、管理型 Recovery、force-release 与状态乘积结论已归档，不是当前产品能力或安全回退方案。

## Technical deployment gate conclusion

七个技术 deployment gates 已由 [`deployments/evidence/v1-deployment-gates.json`](../../deployments/evidence/v1-deployment-gates.json) 逐项关闭：测试网 chain/dependency 快照、artifact/codehash、确定性 CREATE2、Hook mask、AccessManager 权限 diff、ABI/event diff，以及固定区块真实 Fork/E2E。当前状态允许受控测试网 rehearsal，但没有发生链上部署。

Broadcast 前仍须完成的 operator holds：

1. 明确接受 chain 46630 上没有 Uniswap 官方 mapping 的 project-pinned test-only v4 依赖，并在发送交易前重读 codehash 与 PositionManager binding；
2. 签字冻结 deployer、五类独立 Safe、Platform Treasury、Root Service Treasury、费用资产、费用金额及全部 Treasury 时间参数；
3. 执行无私钥地址 preview、无广播完整 simulation，并核对预测地址、payload hash、gas、余额与 nonce；
4. 广播后生成 receipt-bound deployed manifest，完成源码验证、AccessManager role handoff/ADMIN_ROLE 撤销和浏览器 E2E；
5. 正式前端在实际 release 绑定和浏览器 E2E 前继续锁定毕业后 Pool swap。

## Production blockers

进入 `PRODUCTION_READY` 前仍需：

- 独立安全审计关闭全部 Critical/High；
- 完成 Pons 来源/许可与 Stock 收益产品的法律、地区准入和风险披露签字；
- 完成 deployer 权限移交/撤销、源码验证、监控告警、事故演练和至少72小时 canary soak；
- 浏览器实链 E2E 与运维演练通过。

机器权威始终是 [`spec/v1_execution_manifest.json`](../../spec/v1_execution_manifest.json) 与部署 manifest；本文不复制会漂移的 gate ID 清单。
