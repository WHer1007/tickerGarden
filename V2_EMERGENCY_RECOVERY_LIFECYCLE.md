# TickerGarden V2 Emergency 与 Recovery 生命周期

> 规格任务：`V2-P-006`  
> 状态：`FROZEN / IMPLEMENTATION_ALLOWED`  
> 更新时间：2026-09-02

## 1. Emergency 激活

`EMERGENCY_EXIT` 是不可逆终态。Market 必须连续处于 `PAUSED` 或 `RETIRED` 至少24小时，`RECOVERY_ROLE` 的调用本身再受24小时 AccessManager 延迟。外部入口固定为：

```solidity
activateEmergencyExit(bytes32 marketId)
    returns (uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash)
```

调用者不能提供 recoveryEpoch、snapshotBlock、cap 或 stateHash。Controller 在激活块 `N` 内固定取 `snapshotBlock = N - 1`，并原子按以下顺序执行：

```text
1. read old Registry config/runtime, Gauge totals and current Quote/Meme STAKER liabilities
2. checked compute recoveryEpoch = oldRecoveryEpoch + 1 and snapshotBlock = N - 1
3. compute canonical stateHash from those exact pre-transition values
4. FeeVault.freezeRecoveryCaps(marketId, recoveryEpoch, snapshotBlock, stateHash)
5. require returned quoteCap/memeCap equal the values read in step 1
6. Gauge.disableForEmergency(recoveryEpoch, snapshotBlock, stateHash)
7. disable the ACTIVE Hook binding when a pool exists
8. MarketRegistry.commitEmergencyExit(marketId, snapshotBlock, stateHash) last
9. emit EmergencyExitActivated and return recoveryEpoch/snapshotBlock/stateHash
```

FeeVault 冻结的 cap 必须由其自身重读两个当前 `STAKER_REWARD` liability 得出，Controller 不能指定金额；FeeVault 同时持久化 snapshotBlock/stateHash 并发出 `RecoveryCapsFrozen`。Registry 的 commit 最后发生，Hook/Gauge 的受限入口因此只允许不可变 Controller 在该原子 Emergency 调用中、Registry 尚处于 PAUSED/RETIRED 时执行。任何一步失败全部回滚。旧 Gauge/source 永久不能恢复；同一 marketId 不安装 successor。force release 只依赖 Registry 终态，不依赖 root。

## 2. Snapshot 与 stateHash

事件重放包含 genesis/market creation 至 `snapshotBlock` 的所有最终日志，不含 Emergency 激活交易。激活交易冻结的 cap 是链上支付上界。

```text
stateHash = keccak256(abi.encode(
  keccak256(bytes("TICKERGARDEN_V2_EMERGENCY_STATE_V1")),
  uint256(1),
  block.chainid,
  marketRegistry,
  feeVault,
  marketId,
  recoveryEpoch,
  snapshotBlock,
  oldGauge,
  oldSourceVersion,
  quoteAsset,
  memeToken,
  quoteRecoveryCap,
  memeRecoveryCap,
  gaugeStoredTotalActive,
  gaugeTotalPending
))
```

上述字段在激活交易中读取；FeeVault 以 `marketId + recoveryEpoch` 存储 snapshotBlock/stateHash 和两资产 cap，Registry 存储终态 epoch/sourceVersion。Indexer 计算结果不构成链上权威。`snapshotBlock` 必须可装入 uint64，否则 fail closed。

## 3. Root 生命周期

每个 `marketId + recoveryEpoch + feeAsset` 只能有一个 ACTIVE root，但被取消的 proposal 可由递增 `proposalNonce` 重新提案：

```text
NONE/CANCELLED --propose--> PENDING --permissionless finalize after 48h--> ACTIVE [terminal]
                               \--Guardian cancel---------------------> CANCELLED
```

- `proposeRecoveryRoot`：RECOVERY_ROLE，24h AccessManager delay；要求 Emergency、root 非零、declaredTotal >0 且 `<= frozen cap`。
- `cancelRecoveryRoot`：PAUSE_GUARDIAN_ROLE，0 delay；仅 PENDING 可取消。
- `finalizeRecoveryRoot`：PUBLIC；从 `proposedAt` 起满48小时，且 proposalNonce/root/total 未变。
- PENDING 或 CANCELLED root 不能 claim；ACTIVE 后 root/total 永不修改或取消。
- 未声明或未领取部分继续留在该市场 STAKER liability，不转给任何其他 Bucket。

## 4. Merkle 约定

叶子使用双哈希，内部节点按 OpenZeppelin `MerkleProof` 的 commutative sorted-pair hash：

```text
inner = keccak256(abi.encode(
  keccak256(bytes("TICKERGARDEN_V2_RECOVERY_LEAF_V1")),
  uint256(1),
  block.chainid,
  feeVault,
  executionSpecId,
  marketId,
  recoveryEpoch,
  feeAsset,
  user,
  amount
))
leaf = keccak256(bytes.concat(inner))
node = commutativeKeccak256(left, right)
```

claim 固定支付 leaf 中的 user，不接受 recipient。消费键为 `marketId + epoch + feeAsset + user`；累计 paid 不得超过 declaredTotal 或 cap。

## 5. Root view

```solidity
struct RecoveryRootView {
  bytes32 root;
  uint256 declaredTotal;
  uint256 claimedTotal;
  uint64 proposedAt;
  uint64 finalizableAt;
  uint32 proposalNonce;
  uint8 status; // NONE, PENDING, ACTIVE, CANCELLED
}
```

前端必须显示 PENDING/挑战剩余时间，不能把 proposal 当成可领取 root。

## 6. 不变量

1. Emergency、Gauge disable、source invalidation、cap、snapshot 与 stateHash 原子。
2. recovery cap 冻结后只可因 claim 减少对应负债，绝不增加。
3. 错误或未最终确认 root 不可领取；ACTIVE root 不可替换。
4. proof 不可跨链、FeeVault、executionSpec、市场、epoch、资产或用户重放。
5. 本金 force release 不调用 Gauge，不等待 proposal/root。
6. 外部 ABI 永远只有 `activateEmergencyExit(bytes32)`；任何让 caller 提供 snapshot/hash/cap 的重载都禁止。
