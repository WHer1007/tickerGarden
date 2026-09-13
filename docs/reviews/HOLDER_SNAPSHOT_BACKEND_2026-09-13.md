# Holder 快照后端交付

2026-09-13。状态：TEST_BACKEND_DEPLOYED / PERIODIC_PUBLICATION_DISABLED。用户明确先完成后端，暂不启用周期发布。本轮没有创建市场、设置发布者、签名或发送链上交易。

## 已完成

- 显式已确认区块的 Transfer 重放、完整范围检查、双 RPC 供应量与逐账户余额复核、合约排除名单、Quote/Meme 比例分配、舍入余款保留。
- 规范 JSON 摘要、完整 Merkle 数据集及证明持久化。同轮多候选按 dataHash 隔离保存；API 只选择已发布 dataHash。Pipeline 数据集权限为 SELECT/INSERT，实测 UPDATE/DELETE 均不可用。
- 最新 Distributor ABI 导出、资金/发布者状态、轮次与独立领取位图投影；重组清理链上观察，不删除证明归档。
- `/v1/holder-snapshots`、账户/版本绑定分页、OpenAPI 4.6.0 及前端生成客户端。无证明、损坏数据或无有效市场返回 503；错误及正常响应 no-store。
- 资金归集与发布的双 RPC 模拟入口，身份、历史预算、历史持仓、最新预算、已发布轮次冲突和重放核对。

## 测试与部署

- 后台 62 项单元测试，10 项 API 契约测试，类型、打包、生成产物与 baseline 检查通过。
- 真实 PostgreSQL 3 项集成测试全部通过、0 跳过，使用隔离临时 schema。包括索引缺口、RPC 分歧、重复准备、证明查询、领取位、重组后撤回观察且保留数据集、账户游标隔离。
- 前端 386 项测试通过。
- 后端生成的三账户、奇数节点树在本地 EVM 的实际 Distributor 完成发布和领取，剩余未分配资金符合舍入规则。该测试不代表 RH 实际用户资金验收。
- Read API Preview：`dpl_3hcn7LGN7fggbmRnT4Fy6V2wgNF2`，测试别名 https://tickergarden-read-api-test.vercel.app 。
- Pipeline Preview：`dpl_FzFBzZ8b17xFzFejJy1YHztDfFq1`，测试别名 https://tickergarden-pipeline-test.vercel.app 。
- 所有部署显式 `--regions sin1`，分别确认 2 个运行时函数均在 sin1 后再切别名。
- 测试数据库迁移 0004 完成；新 `holder-rewards` 投影已在线推进，并与其余投影对齐。队列 generation 1 的任务成功，无失败任务。

## 保留边界

没有配置周期、随机取样、签名密钥、nonce/广播恢复执行器，也没有打开前端快照写入批准开关。提供的是数据、查询、投影和可重跑的交易模拟链路，不能声称自动链上发奖已启用。当前没有真实市场，线上没有真实奖励 Root；线上可验证接口存在、正确返回无市场不可用状态及 no-store。

本版本投影有界全量重放，最大账户/事件数及失败关闭规则见 [操作文档](../operations/HOLDER_SNAPSHOT_BACKEND.md)。生产容量与独立发布者安全审查不在本轮完成范围。

[验收证据](evidence/holder-snapshot-backend-2026-09-13/)。
