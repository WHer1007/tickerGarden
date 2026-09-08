# Holder replay worker

`holder-replay-worker` 已实现从持久检查点持续连接 finalized 链的运行路径。本地实现和测试已完成；认证 seed 现可由独立的 `holder-seed` 命令创建，生产 scope、真实链初始化、告警交付和完整历史验收仍未完成。

## Commands and configuration

```text
holder-replay-worker --describe
holder-replay-worker --once SCOPE.json
holder-replay-worker --run SCOPE.json
holder-replay-worker --audit SCOPE.json
```

严格 JSON scope 绑定 chain ID、genesis、market、token、quote、distributor/vault、runtime codehash 和账户预算。worker 使用 `TG_HOLDER_REPLAY_DATABASE_URL`、`TG_HOLDER_REPLAY_RPC_URL`（缺省回退到 `TG_RPC_URL`）以及可选的 `TG_HOLDER_REPLAY_PAUSE_MS=0..60000`。

scope 必须已经由受控流程初始化检查点。worker 自身没有 initialize 或 seed 导入入口，也不会把缺失检查点解释为空账本。生产初始化使用 `holder-seed --initialize REQUEST.json`；详见 `docs/operations/HOLDER_SEED_AUTHENTICATION.md`。

## Progress and failure behavior

每一步先加载 head，并验证 chain ID、genesis、canonical head、finalized 高度以及 head 上的 token/distributor runtime code。即使 idle 也会执行这些检查。发现 finalized 子块时，只选择 `head + 1`，要求 parent hash 匹配，再执行完整交易、回执和 trace 回放并通过 checkpoint CAS 提交。

每步外层限制 55 秒，回放内部保留 45 秒限制。`--once` 执行一步；`--run` 按配置暂停后继续执行同样的单步操作。idle 轮询至少等待三秒，即使显式暂停参数为零也不会形成热循环。

缺块、scope 不匹配、未知 Nitro 类型、receipt/trace 不可用、finality 变化、codehash 漂移、重组、回放差异和 checkpoint 冲突都会停止进程。worker 不自动跳块、倒退或重置。提交结果不明时，应先读取当前检查点再决定是否重启。

`--audit` 在一个 PostgreSQL repeatable-read snapshot 中从 revision 0 流式检查到当前 head，要求认证 seed 存在、每条 payload 的规范 JSON 与摘要一致、revision 无缺口、parent digest 与区块父哈希连续、所有 revision 保留同一 seed provenance；它还读取每个 revision 绑定的原始交易区块 JSON、receipt-root 原始输入、hash-pinned seed reads 和全部调用轨迹，在离线环境重算交易/receipt roots 并重放 ledger 状态。持久证据链通过后，再用 RootVerified RPC 对当前 head 做完整市场与逐账户对账。它验证本地持久链和当前状态，但仍输出 `historyVerified=false`、`publicationEligible=false`。

每个 checkpoint payload 的数据库上限为 5 MiB；每个 revision 的原始证据包上限为 384 MiB，revision 记录和 head 通过 digest/CAS 保留，当前迁移没有自动清理策略。证据包包含规范化状态之外的原始交易区块 JSON、receipt-root 输入、hash-pinned state reads 和全部 call traces，可供离线审计复算。数据库中 ingestion-time 的 receipt root 或 observation proof 只能证明当时摄取的一组数据满足本地校验，不能替代独立共识来源或历史完整性证明。

## Explicit non-goals

worker 不发现或认证初始 registration/balances；该职责属于独立 seed 命令。worker 不签名、不广播、不结算奖励、不发布 snapshot。即使单块成功，`HistoryVerified=false` 与 `PublicationEligible=false` 仍保持不变，直到完整范围证据接入独立对账及资金发布门禁。

## Current status and checks

本地测试覆盖 idle、严格 next block、错误 chain/genesis/head/codehash/finality/parent、存储冲突、严格 JSON 和 CLI 参数。`make holder-checkpoint-check` 覆盖 PostgreSQL CAS、认证 provenance、全 revision audit、拒绝 provisional seed 和重启恢复；`make verify` 覆盖 race、vet、格式和全部命令构建。

本轮没有对生产数据库执行迁移或进行公开链操作。真实 RPC/数据库 seed 初始化与持续运行、运维告警、证据容量及长期 retention 验证和重组人工处理仍是必要后续工作。
