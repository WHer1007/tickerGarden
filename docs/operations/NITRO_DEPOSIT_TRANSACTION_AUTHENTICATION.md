# Nitro deposit transaction authentication

本文件记录已实现的 `0x64` deposit transaction 认证。实现按固定版本源码从 JSON 重建规范编码，并纳入整块 transaction trie 校验。本地测试通过；尚无真实 deposit 区块对照证据。

规范来源固定为 commit [`260bc5dcbd5a16925d7e26145577b2612f30f428`](https://github.com/OffchainLabs/go-ethereum/tree/260bc5dcbd5a16925d7e26145577b2612f30f428)，相关定义位于：

- [`core/types/arb_types.go`](https://github.com/OffchainLabs/go-ethereum/blob/260bc5dcbd5a16925d7e26145577b2612f30f428/core/types/arb_types.go)
- [`core/types/arbitrum_signer.go`](https://github.com/OffchainLabs/go-ethereum/blob/260bc5dcbd5a16925d7e26145577b2612f30f428/core/types/arbitrum_signer.go)
- [`core/types/transaction_marshalling.go`](https://github.com/OffchainLabs/go-ethereum/blob/260bc5dcbd5a16925d7e26145577b2612f30f428/core/types/transaction_marshalling.go)

## 认证边界

实现使用该 commit 的 deposit transaction 类型定义、RLP/typed envelope 编码、字段顺序和 transaction hash 规则。成功路径必须同时满足：

- 从必需的 chainId、requestId、from、to、value 字段重建 `0x64 || RLP([chainId, requestId, from, to, value])`，不是接受外部提供的 RLP；RPC input、nonce、gas 必须分别为 `0x`、`0x0`、`0x0`，可选费用与签名值出现时必须为零；
- 交易 metadata 的 hash、block hash、block number、transaction index 与区块位置一致；
- 全部交易按区块索引重建 transaction trie，并与 header `TxHash` 一致；
- deposit 交易的特殊 sender/signing 语义按 arbitrum signer 规则处理，不能套用普通 Ethereum signature 验证；
- chain ID、parent/target/finalized 和外部 canonical/finality anchor 仍由上层认证流程提供。

这项工作只定义 L2 block 内 deposit transaction 的编码和 trie 认证。它不认证对应的 L1 消息来源、L1 inbox、跨链证明或桥接状态；这些属于另行设计的外部信任边界。

## 未完成与 fail-closed 边界

本地测试覆盖大整数金额、必需字段缺失、元数据篡改、错误网络、零地址收款、整块交易位置与替换交易根拒绝。测试使用合成 deposit，不宣称真实区块、L1 桥接或生产验收通过。以下交易类型仍 unsupported，不能静默跳过或按普通交易解释：`0x65`、`0x66`、`0x68`、`0x69`、`0x78`。

已有通用 trace 绑定，但 deposit 的真实 trace 联调尚未验证。创建块/seed 认证、持久化 replay checkpoint、恢复游标、完整历史认证和发布流程仍未完成。即使 `0x64` 单笔解码与 transaction trie 认证通过，也不能宣称全 Nitro 支持、完整 Holder 历史已认证、跨链 L1 来源已验证或生产就绪。

## RPC 兼容性

本实现消费完整区块 RPC 交易对象，要求 input/nonce/gas 存在；仅含官方 Transaction.MarshalJSON 最小字段的对象可能被拒绝。这是明确的保守输入约束。非零 value 保留为 uint256，零目标地址不表示合约创建。
