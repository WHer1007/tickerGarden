# Holder replay checkpoints

本文件记录连续 Holder block replay 的 PostgreSQL 检查点实现。它支持恢复回放状态，并由 `holder-seed` 写入经过认证且带 evidence 的初始 seed；`holder-replay-worker` 已接入单 scope 的持续推进与 audit。它仍不证明完整历史或常驻生产调度。

## Checkpoint scope

每个 checkpoint 必须绑定不可变 scope，至少包括：

- chain ID 与 genesis hash；
- market ID、token、Quote、distributor、vault binding；
- token 与 distributor runtime codehash；
- replay/schema/config 版本和 scope digest。

scope 不匹配时拒绝继续，也不能通过覆盖旧记录来切换网络、部署或 market。`holder-scope-plan` 可从当前候选、manifest 和 hash-pinned 链状态推导 scope；`holder-seed` 仍须由运维明确选择并提交 seed request，重新完成部署块认证后才写入 checkpoint。checkpoint 存储不会单独把任意 operator seed 提升为已认证的注册状态或创建块证明。

## Atomic next-block save

在 next-block replay 成功后，通过 PostgreSQL CAS 事务原子保存：

- parent/target block identity（提交前由 ReplayNextBlock 核对 canonical/finality）；
- replay 后 ledger snapshot；
- 单块回放的 evidence digest 与统计，以及 migration 00072 中绑定的原始交易区块、receipt-root 输入、hash-pinned state reads 和完整 call traces；
- scope、schema 和状态 checksum；
- next cursor/checkpoint generation。

CAS 匹配旧 revision、scope digest 和绑定完整上一条记录（包含 parent block）的 digest。冲突、旧 worker、parent 不连续或 target 已失效都拒绝提交；不得静默覆盖或跳过区块。ledger、block identity、evidence 和 cursor 必须在同一事务中提交，失败则整笔回滚。

## Recovery boundary

Load 重新校验 scope、checksum、JSON/state 结构和相邻记录关系；Load 本身不读取链。继续 Advance 时由 ReplayNextBlock 重新核对 canonical/finality。损坏、缺字段、checksum 不符、generation 冲突或链分支变化应停止并要求人工处理。checkpoint 只能恢复已保存的 replay state，不能证明保存之前的完整历史。

该设计不复用 24 小时 `observation_work` cache 作为最终 checkpoint：该 cache 有租约、重试和清理语义，定位是可丢弃的 observation evidence，不是连续 ledger 的历史游标或审计记录。

## Explicit non-goals

即使 seed 已通过 pristine deployment/registration 认证并且 `AuditHistory` 已重放所有已保存 revision，只要历史范围未完整覆盖、独立共识来源未证明、私有 account storage 未证明或 trace/transaction 仍缺少独立共识证明，`HistoryVerified` 与 `PublicationEligible` 就必须继续为 false。checkpoint 不自动广播、不签名、不发布快照，也不授权领取或结算。

seed 认证流程、单 scope worker、原始 trace/receipt 证据归档和 revision-chain audit 已有实现；真实部署执行、多 scope 常驻调度、重组后显式恢复策略、生产数据库角色权限、证据 retention/容量验收和全历史验收仍待完成。没有自动回滚或重置既有 scope 的入口。数据库摘要防意外损坏，不抵御能同时修改 payload 和摘要的数据库管理员；初始化权限应限制给可信操作者。

## 接口与迁移

- 迁移 `00071_holder_replay_checkpoints.sql` 新增检查点历史表与 head 表；迁移 `00072_holder_replay_evidence.sql` 为每个 revision 保存 append-only evidence；两者与 observation cache 分离，不设 TTL。
- `EncodeCheckpoint` / `DecodeCheckpoint`：规范 JSON、最多 4 MiB/10000 账户，校验整数/账户/流/供给结构，保存全部内部字段。
- `CheckpointStore.Initialize`：保存明确未认证的 provisional 初始状态，禁止覆盖同 scope。
- `CheckpointStore.InitializeAuthenticatedEvidence`：校验并原子保存 pristine seed、revision 0 与 seed evidence。
- `CheckpointStore.Load`：返回恢复状态、revision 与摘要，不认证链上来源。
- `CheckpointStore.Advance`：加载副本、完整回放下一块、CAS 原子追加记录并推进 head；RPC 阶段不持有数据库锁。
- `CheckpointStore.AuditHistory`：在 repeatable-read snapshot 中校验完整 revision chain，离线重算 retained evidence，并重放 seed/replay 状态。

提交超时/结果不明时先 Load，比较高度和 block hash，再决定下一块。不得盲目重置或重复初始化。重组或缺证据会停止后续 Advance；已存记录可作为 `AuditHistory` 和 `candidate-inspect --publish` 的必要证据，但单独不能发布。

本轮验证命令（临时 PostgreSQL，不连接项目生产数据库）：

```sh
cd services/backend-go
GOMAXPROCS=2 GOFLAGS=-p=2 python3 scripts/verify_holder_checkpoints.py
make verify
```

详细执行结果见 `outputs/reviews/holder-checkpoints-2026-09-07/REPORT.md`。

本轮检查点并发/恢复测试、低并发 PostgreSQL 集成复跑、make verify 与 contract-check 均通过。首轮扩展数据库测试有失败记录，详见报告；不将复跑通过等同于生产性能验收。
