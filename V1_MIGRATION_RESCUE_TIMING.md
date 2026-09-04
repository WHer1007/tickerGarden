# TickerGarden V1 原子毕业与旧 Rescue 迁移

> 规格：`V1-EXEC-10`；旧 `Swept` / retry / 七日 rescue 方案已 superseded。

## 1. LaunchPhase 事实

市场部署后永久自治，不存在市场级 pause、retire、Emergency、Recovery 或管理 Controller。Registry 只记录 `NotGraduated -> PoolCreated`。`MarketRuntime` 不再包含 `sweptAt`，也不存在 `Swept` 或 `Rescued`。

## 2. 最终买入与失败语义

- 最终 Curve 买入触发最后一次费用入账，并同步调用 exact registered GraduationExecutor。
- Executor 只消费本次 Curve 明确传入且实际到账的 Quote/Meme 数量；无关余额不得被纳入毕业计划。
- Pool 初始化、LP mint、Position NFT 直接归 canonical LaunchLocker、双资产 dust 永久进入同一 Locker、Hook 激活和 Registry 提交必须全部成功。
- 任一步骤失败，最终买入、费用入账、资产转移和所有毕业副作用全部回滚，市场保持 `NotGraduated`；不存在等待救援的协议托管资产。
- ABI、权限与链下消费者均不提供 `retryGraduation`、`rescueSweptLaunch`、`markSwept`、`markRescued` 或可指定的市场资产接收人。

## 3. RageQuit 与异步奖励

用户无需等待任何毕业或救援时钟，可随时 `rageQuit`，立即取回本人完整本金。全部未领取奖励异步放弃并记入 platform forfeiture reserve；奖励清理的 permissionless 重试只处理 forfeiture 记账，不重新转移本金，也不是毕业重试。

## 4. 配置级状态

资产、Quote、Pons baseline 和 launch template 仍可按各自 Registry 规则 `ACTIVE <-> PAUSED -> RETIRED`。这些对象级状态只限制新增准入/新增敞口，不改变已部署市场的 launchPhase 或阻止 RageQuit。

旧文件中的管理型市场计时和七日终态救援均已删除；本地实现和生成物按 V1-EXEC-10 验证，目标链部署与 E2E 仍需单独完成。
