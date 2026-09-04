# TickerGarden V1 LaunchPhase、Sweep 与 Rescue Timing

> 规格：`V1-EXEC-8`；旧市场状态计时方案已 superseded。

## 1. LaunchPhase 事实

市场部署后永久自治，不存在市场级 pause、retire、Emergency、Recovery 或管理 Controller。Registry 只记录一次性 `launchPhase`：`NotGraduated -> Swept -> PoolCreated`，或 `Swept -> Rescued`。`sweptAt` 在进入 `Swept` 时 write-once。

## 2. Sweep 与 Rescue

- `sweptAt` 使用完成 sweep 交易的 block timestamp。
- permissionless rescue 的最早时间为 `block.timestamp >= sweptAt + 604800`；边界少一秒失败。
- `PoolCreated` 或 `Rescued` 后 retry/rescue 不再可用；交易排序决定 `Swept` 竞争路径。
- rescue 使用部署时冻结的 canonical distributor 和 exact tracked amounts，不接受临时 recipient；任一余额 delta 或 Registry 写入不匹配则整笔回滚。

## 3. RageQuit 与异步奖励

用户不等待 sweep/rescue 时钟，可在任意 launchPhase 随时 `rageQuit`，立即取回本人完整本金。未领取奖励异步放弃、再分配或记入 forfeiture reserve；重试入口只处理奖励，不重新转移本金。

## 4. 配置级状态

资产、Quote、Pons baseline 和 launch template 仍可按各自 Registry 规则 `ACTIVE <-> PAUSED -> RETIRED`。这些对象级状态只限制新增准入/新增敞口，不改变已部署市场的 launchPhase 或阻止 RageQuit。

旧文件中的管理型市场计时均已删除；本地实现和生成物已按 V1-EXEC-8 验证，目标链部署与 E2E 仍需单独完成。
