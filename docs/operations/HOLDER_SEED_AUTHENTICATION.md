# Holder seed authentication

连续 Holder replay 的初始 seed 只能来自部署/注册块末仍处于 pristine 奖励状态的链上事实。`holder-seed` 已实现该严格认证与一次性 checkpoint 初始化；它不会自动发现部署区块，也不会把成功初始化解释为完整历史或发布资格。

## Command

```text
holder-seed --describe
holder-seed --initialize REQUEST.json
```

也可在 `services/backend-go` 中执行 `make holder-seed REQUEST=/absolute/path/request.json`。命令使用 `TG_HOLDER_REPLAY_DATABASE_URL` 与 `TG_HOLDER_REPLAY_RPC_URL`，后者缺省回退到 `TG_RPC_URL`。它只读链上状态并写入 replay checkpoint，不签名或广播交易。

请求必须是严格 JSON，`blockNumber` 必须是非零 canonical quantity，且明确绑定 Factory 与 runtime codehash：

```json
{
  "seed": {
    "scope": {
      "config": {
        "chainId": 421614,
        "genesisHash": "0x<64 hex>",
        "binding": {
          "distributor": "0x<40 lowercase hex>",
          "vault": "0x<40 lowercase hex>"
        },
        "quote": "0x<40 lowercase hex; zero means native>",
        "distributorCodeHash": "0x<64 hex>",
        "tokenCodeHash": "0x<64 hex>",
        "maxAccounts": 10000
      },
      "marketId": "0x<64 hex>",
      "token": "0x<40 lowercase hex>"
    },
    "factory": "0x<40 lowercase hex>",
    "factoryCodeHash": "0x<64 hex>"
  },
  "blockNumber": "0x<deployment block>"
}
```

## Required block evidence

seed block 必须同时通过完整区块交易根、receipt root 和 filter-log 交叉核对，并在同一 canonical/finality fence 前后保持一致。认证范围必须覆盖该块的全部交易、receipt、日志、交易索引和 block identity，不能只读取命中 Holder 事件的交易。

## Pristine reward-state checks

在部署/注册块末，认证器应验证：

- parent block 的 token code 为空，seed block 的 token code 与绑定 deployment codehash 一致；
- token identity、`deployedAt` 和 `initialSupply` 与注册事实一致，且 `initialSupply == totalSupply`；
- 初始 mint 唯一，并且其 Transfer 账户集合完整；
- 从完整 Transfer 集合重建的逐账户余额与链上 `balanceOf` 一致，余额求和等于 `totalSupply`；
- 链上 exclusions 完整、无重复、与 seed ledger 的排除集合一致；
- Holder distributor 的 market/binding、reward mode、stream duration、market state、release state、last funding 和逐账户奖励字段都处于零奖励的 pristine 状态；
- seed 前后重新检查 canonical block、parent、genesis/finality anchor、codehash 和交易/receipt commitments。

如果同一部署/注册块已经出现 funding、stream、claim、checkpoint 后状态变化或其他奖励初始化迹象，认证器必须拒绝 seed；不能猜测交易顺序、把余额快照当作初始状态，或将该块降级为“近似 pristine”。

## Checkpoint and publication boundary

`CheckpointStore.Initialize` 仍保留显式 provisional operator seed 路径，完整审计会拒绝该路径。生产 seed 使用 `AuthenticatePristineSeedWithEvidence` 后调用 `InitializeAuthenticatedEvidence`，将认证摘要、注册交易、区块、账户/Transfer/交易计数及原始 seed 证据随 checkpoint 原子持久化，并在后续 CAS revision 中保持同一 seed provenance。初始化后 `HistoryVerified=false` 仍必须保持，直到从认证范围开始的完整 canonical history、独立来源核对和 D01 发布门禁均完成。seed 本身不授权发布 snapshot、广播、领取或结算。

## Current status

当前状态：认证器、RootVerified receipt 适配、严格 CLI、认证 provenance 持久化、同块 funding/burn 拒绝以及 checkpoint worker 接续路径已有本地实现和测试。部署块仍需运维方明确选择；真实网络 seed 初始化、持续运行、告警与生产验收尚未执行。认证 seed 只证明该部署块末的干净边界，不证明 RPC 共识独立性或后续历史完整性。

Seed revision 0 和后续 checkpoint revision 通过 migration 00072 原子持久化原始交易区块 JSON、receipt-root 原始输入、hash-pinned seed reads 和全部调用轨迹，并以 evidence digest 绑定 checkpoint。单个 checkpoint 状态 payload 上限为 5 MiB，单证据包上限为 384 MiB；当前没有自动 retention/删除策略。`--audit` 可在离线环境重算交易/receipt roots 并重放状态，但 seed 期间取得的 root proof 仍是 ingestion-time 证据，不能单独升级为独立共识证明或完整历史证明。
