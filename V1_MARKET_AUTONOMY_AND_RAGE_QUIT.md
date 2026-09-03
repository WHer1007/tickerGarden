# V1 市场自治与用户 RageQuit

> 版本：`V1-EXEC-6`；本地实现与生成物已验证，目标链部署、独立审计和实链 E2E 尚未完成。

## 市场自治

市场部署后永久自治，不存在市场级 pause、retire、Emergency 或 Recovery 管理状态，也不存在 MarketController。`launchPhase` 仅记录一次性单向生命周期事实。

## 配置与用户边界

资产、Quote、Pons baseline、Launch template 仍可由各自 Registry 执行对象级 `ACTIVE <-> PAUSED -> RETIRED`；这只限制新增准入或新增敞口。用户可在任意 launchPhase、任意时间 `rageQuit`，立即取回本人完整本金；未领取奖励异步放弃、再分配或进入 forfeiture reserve。

## 迁移不兼容

旧 `V1_EMERGENCY_RECOVERY_LIFECYCLE.md` 已移除。其 MarketStatus、MarketController、Emergency、Recovery root/cap、Merkle claim 和相关 ABI/权限均为 superseded 设计，不在本文件复述。源码、生成物、manifest 与本地测试已按 V1-EXEC-6 验收；外部部署与生产门禁仍独立开放。
