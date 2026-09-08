> 2026-09-06 更新：R3 测试链版本已部署，使用 7 天持有人周期与 0.42 ETH 测试毕业门槛。此前重命名候选的 NOT_BROADCAST / 阻塞记录属于历史阶段；当前验证范围和时间限制以 [R3 测试报告](../../outputs/reviews/arbitrum-r3-scenarios/REPORT.md) 为准。RH 生产就绪仍未确认。

# TickerGarden 合约品牌命名清理

日期：2026-09-06。范围：活动合约及其必要的规范、生成器、ABI、部署工具和应用依赖。本次未广播交易。

## 命名变更

| 原名称 | 当前名称 |
| --- | --- |
| PonsCompatibleCurve | TickerGardenCurve |
| PonsBaselineRegistry / IPonsBaselineRegistry | TickerGardenBaselineRegistry / ITickerGardenBaselineRegistry |
| PonsBaseline | TickerGardenBaseline |
| ponsBaselineId / Hash / Registry | tickerGardenBaselineId / Hash / Registry |
| PonsCurveMath / PonsSupplyMath / PonsAntiSnipe | TickerGardenCurveMath / TickerGardenSupplyMath / TickerGardenAntiSnipe |
| TICKERGARDEN_V1_PONS_BASELINE | TICKERGARDEN_V1_LAUNCH_BASELINE |
| /v1/config/pons | /v1/config/baseline |

相关事件、错误、测试命名和接口同步更新，OpenAPI 版本升至 2.0.0。活动 Solidity 源码及部署脚本中的 Pons 品牌标识已清理。本次品牌变更不调整手续费分配、持有人周期或管理员权限规则。

## 兼容性与部署

这不是单纯的注释替换：ABI 名称、事件签名及基线哈希域发生变化。新前后端、索引器与合约必须作为一致的新 release 使用；旧索引数据需使用独立实例或重新构建，不能直接混用新旧字段。新基线哈希须重新计算，依赖的 Quote 配置和发布参数也须使用新版本生成器重建。

已部署 R2 仍使用历史 ABI，源码修改不会更新其链上代码。激活工具增加旧清单拒绝检查，防止将此 checkout 用于激活旧 R2。历史部署收据、第三方研究来源、行为证据和真实外部引用保留原名称，避免篡改来源事实。

当前候选为 `IMPLEMENTATION_ALLOWED / NOT_BROADCAST`；`V1-DEPLOY-ARTIFACT-CODEHASH-01` 已重新打开。旧 release 的成功证据不能证明此候选可部署，后续须重新审查 ABI/codehash、演练并发布新 release。RH 仍为最终目标生产网络。

## 验证记录

- 普通合约全量首次执行：809 通过、2 失败；两处旧哈希/排序索引预期修正后定向复测 2 通过，共覆盖 811 项用例。没有将首次全量执行记录改写为成功。
- 独立 product track：315 通过、0 失败。
- 规范 62 项、链下服务 137 项、前端 57 项、CI 工具单测 19 项通过；Go 测试、前后端构建通过。
- fixtures、interfaces、product artifacts 一致性检查通过；部署 track 通过。
- Arbitrum Sepolia 真实 v4 Fork：1 项通过，区块 305786194，哈希 `0xa7b5a8e3a16ccf9131119cc074742a7866313e9a07cd593eb6851f41fac5444d`。使用新快照前已核验七个外部依赖代码哈希。
- 完整 CI 在 RH Fork 环节停止：环境缺少 `ROBINHOOD_RPC_URL`。因此不能宣称完整 CI 或 RH Fork 已通过。
- `git diff --check` 通过。

原始验证日志见 [outputs/reviews/brand-rename](../../outputs/reviews/brand-rename/)。上述测试不构成已部署或生产就绪证明。
