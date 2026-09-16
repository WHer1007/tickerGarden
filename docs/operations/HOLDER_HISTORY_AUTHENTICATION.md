# Holder history authentication boundary

当前 Holder 连续分发器的历史输入仍然是“已绑定来源的 RPC/数据库观察”，不是独立共识证明。本文记录现有 chainrpc 与整块回放能力及其边界，不能作为完整历史或发布授权。

## 已有的信任层

`services/backend-go/internal/chainrpc/receipt_root.go` 的 `VerifyReceiptRoot` 会读取完整区块交易列表和回执，按交易顺序重新编码 receipt，校验 receipt trie root、`gasUsed`、Bloom、交易类型、区块哈希/高度和当前 RPC 对该区块的再次观察，并产生 receipt-set commitment。它绑定的是 RPC 返回的区块 header 与回执编码；它不会通过共识验证 header，也不会证明交易 trie 中的交易哈希、签名或发送者元数据。调用方仍必须提供网络、genesis、canonical/finality 和历史范围绑定。

该实现明确拒绝不支持的 receipt 类型，并对 Nitro 升级前 legacy `0x78` receipt 采取 fail-closed 行为。不能因为 receipt-root 校验成功就跳过 Nitro 类型适配；在不支持的网络/时期必须停止并报告不可用。

仓库当前保留对已实现自定义 receipt 类型的支持；Geth `Receipt.MarshalBinary` 对 typed receipt 按类型前缀编码。这个事实不等于交易 decoder 已支持 Nitro/system transaction：`VerifyTransactionBlock` 对不支持的 Nitro/system 或未保护 legacy transaction 仍 fail-closed，不会静默省略。

`services/backend-go/internal/chainrpc/transaction_lookup.go` 的 `TransactionByHash` 只是 provider lookup。它区分 pending、显式 null 和 included 字段，校验格式与字段一致性，但不证明 canonical inclusion、交易签名有效性或最终性。调用方仍须独立绑定 included block、receipt、genesis 和确认状态。

`services/backend-go/internal/chainrpc/trace.go` 的 `TransactionCallTrace` 是 RPC `debug_traceTransaction` 的 callTracer 观察，带大小、深度、节点数和数据格式限制。它不是共识证明；必须绑定已签名交易、canonical receipt block，并重新检查历史覆盖。`holderledger.ApplyTrace` 只在调用者完成这些认证后重放成功调用，支持 silent checkpoint、zero claim、token callback/FeeVault sender 约束和 reverted subtree 原子忽略。

## 对连续 Holder 的实际边界

`holderledger.Reconcile` 可以在一个固定 finalized block 上，把外部提供的 replay 与独立链上读取比较，包括 runtime codehash、genesis、目标 block、finality、market state、release state、逐账户 token balance/claimable 和 total supply。它仍明确不认证 replay 的初始 registration，不证明从启用区块起的完整 action/trace 覆盖，不枚举未知账户，不证明私有 account storage、Receipt/Transaction trie 完整性或 FeeVault/全资产 solvency。结果即使零差异，`PublicationEligible` 仍为 false。

因此，当前链路不能宣称“完整 Holder 历史已认证”，也不能把 trace 或 receipt root 结果直接升级为可发布快照。完整历史仍需要外部可信的原始 header 共识来源、支持目标网络 receipt 类型的验证、canonical receipt/transaction 覆盖、交易签名与 trie 绑定、全区块 trace 绑定以及初始状态证明。本轮已实现标准交易的 trie/签名验证、单块 trace 根绑定、pristine 注册起点认证和逐块持久证据链审计；Nitro 交易支持仍是有限的，独立共识来源、全 canonical 范围覆盖和完整历史发布门禁仍未完成。

## 当前整块回放能力

`holderledger.ReplayNextBlock`（`services/backend-go/internal/holderledger/block_replay.go`）已将一整个 next finalized block 接入原子回放，但仍是有限的证据步骤：

- 单块最多 256 笔交易，整个操作 45 秒超时；超限、缺失或不支持的证据直接失败；
- 校验 parent/target 的连续高度和 parent hash、genesis、target/finalized anchor，以及 parent 和 target 两侧的 token/distributor runtime codehash；
- 要求完整交易列表、每笔 receipt 和每笔 call trace，按交易索引逐一匹配；trace root 必须匹配签名交易的 from/to/input/value/type，成功/回退状态也必须与 receipt 一致；
- receipt root、receipt set commitment、transaction trie、交易签名和 chain ID 都必须通过现有边界检查；
- 所有交易先在 clone ledger 上执行，整块完成并通过末尾 fences 后才提交，任一缺失、reorg、trace mismatch 或 action error 都不改变原 ledger；
- 输出 `evidenceDigest`，覆盖 parent/target/config、receipt commitment、初始 parent seed、每笔认证交易和 trace；`HistoryVerified` 与 `PublicationEligible` 仍为 false。

parent 仍只是外部提供且经 fence 的 end-of-block seed，不能被当作创建块或注册状态证明。创建块 seed 认证现在由 `holder-seed` 调用 `AuthenticatePristineSeedWithEvidence` 完成；`CheckpointStore` 和 migration 00072 保存 seed/replay evidence，`AuditHistory` 可离线重算并重放已保存的证据。`holder-replay-worker` 提供单 scope 的 `--once`/`--run`/`--audit` CLI，但这不等于完整范围、独立共识或生产调度完成；仍需上层提供候选范围、持续运行配置和生产验收。

任何诊断命令或 replay 输出仍属于 provider observation / candidate evidence。生产广播、发布、领取和 D01/D02 财务闭环仍是未完成的集成与验收条件。
