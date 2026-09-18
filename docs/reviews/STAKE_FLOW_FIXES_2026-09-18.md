# Stake 审查修复 — 2026-09-18

基线：test `fcdb06a`。实现分支：`codex/stake-flow-hardening`。本报告记录本地实现与验证，不代表已部署。

## 对应审查报告的六项修复

1. **累计奖励时间一致性**：Worker 在 history、positions 同一 finalized 锚点生成 `stake-reward-summary` 数据库记录。累计所得为该锚点累计已领加可领，排除 burn 模式不可领取的 meme 奖励及紧急退出放弃的奖励。按变更的钱包/市场、每批最多 200 条续作；代次切换重算，孤块记录不可读取。API 只读取数据库。前端去掉 latest throughBlock 追赶、四轮等待、十分钟签名缓存及刷新前清空。
2. **回执归因**：质押和两种紧急退出/正常退出核对本交易账户、目标合约、Vault、资产、市场及配对本金事件；核对回执区块仍为 canonical。去掉签名前余额与区块末余额/仓位的严格等式。操作前重读当前钱包仓位；签名前的链、账户、资产约束和模拟保持。
3. **展示读写分离**：Stake 使用 confirmed DB bootstrap 和 Explore 质押筛选目录，退出全局 snapshot/health 轮询。钱包仓位复用已读取市场身份；不可变身份核验缓存包含链、release、全部路由/池/资产配置。动态资产约束继续读取，写入仍强制完整校验。公共统计与钱包 RPC 不相互等待。
4. **在途失效**：按市场合并统计请求，事件在请求中到来会增加失效代次，结束后补读一次。奖励汇总按链/市场/账户分别合并、失效；保留已发布值，避免跨钱包覆盖。
5. **解锁一致性**：本机倒计时到点仅触发链上时间核验；核验前显示已有字段中的 `Checking unlock…`，不会提前宣称 Ready。失败保持禁用并低频重试。链上时间及按钮在同次仓位读取后更新。
6. **失败与恢复**：保留结构化错误原因，区分拒签、余额、Gas、最低仓位、锁定、待清理、回滚及未知结果。pending 只看当前钱包当前 Stake 市场。程序自动核对回执，不自动重发交易；核验失败保留本地记录，RPC 期间新产生的记录不会被误删。不新增页面元素。

## 紧急退出限制的范围

标记键为 `assetUid + user + marketId`。它限制该钱包在该市场再次质押，以及该市场的质押奖励结算/领取；不会冻结其他钱包或该钱包的其他市场，也不是全平台领取开关。本金已由紧急退出返还。

新增 `stake_cleanup_observations`：复用本金投影已有 RPC 核验，将待清理本金和确认锚点一起保存，清理后记录归零。没有增加额外轮询或签名权限。

## 运维清理工具

`services/backend-ts/scripts/stake-cleanup-plan.ts`：不加载私钥，不签名，不广播。

在对应环境已加载现有数据库 TLS 配置及 `TG_ENVIRONMENT` 后，用 Node 24 执行：

```sh
node --experimental-strip-types scripts/stake-cleanup-plan.ts
node --experimental-strip-types scripts/stake-cleanup-plan.ts <wallet> <marketId> <sender>
```

首条列出当前 canonical/generation 内最多 200 条待清理记录；达到上限时按输出的具体钱包、市场处理，不能将一页当全量。第二条要求 `TG_RPC_URL`，重新核对链 ID、genesis、管理器 runtime codehash、当前 pending，模拟并输出 unsigned calldata。若已经清理，返回 `already-clean`。调用 `settleRageQuitRewards` 是 permissionless，但实际发交易需既有运维钱包自行签名；本次未启用自动 Keeper，也未花费 Gas。交易回执成功不等于异常清理一定完成，执行后重跑工具核对当前 pending，仍 pending 才重新准备，不能重复发送仍待处理的交易。

## 发布顺序

1. 对各目标数据库执行 `0023_stake_recovery`，更新 pipeline 权限；新增两张工作/观察表及增量查询索引。既有本金/奖励记录不变。
2. 发布 Worker，确认 `stake-summary` checkpoint 推进及待清理记录正常。
3. 发布 Read API，再发布前端。旧 reward-history 接口保留，兼容旧客户端。
4. 按项目规则从 test 验收后晋级 master；Vercel 必须使用并验收 sin1。本次未发布。

## 验证

- 前端完整测试：621 项通过，包含慢请求失效补读、钱包/市场切换、回执事件匹配、自动恢复保留 journal、解锁边界。
- 后端完整单元测试：164 项通过；生成物、OpenAPI、覆盖、Vercel 打包及类型检查通过。
- 本地 PostgreSQL 全部 38 项集成测试通过（无跳过）；增加 summary 分页/孤块/钱包/API cache-control 及待清理观察回归。
- 合约 Stake 相关 15 套件、221 项通过，含本金优先退出、permissionless cleanup、Vault/Gauge 不变量；没有修改合约。
- 前端生产构建及资源预算、SEO 检查通过。

未使用浏览器、没有测试网/主网签名交易，没有修改生产数据库或部署。线上生效与真实钱包验收仍需后续发布步骤。
