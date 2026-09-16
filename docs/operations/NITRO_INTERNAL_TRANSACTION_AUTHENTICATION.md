# Nitro internal transaction authentication

当前交易认证已增加 Arbitrum Nitro internal transaction type `0x6a` 的专用解码与认证路径。该能力针对 Nitro internal transaction，不能概括为“全部 Nitro 交易已支持”，也不代表生产链路已经就绪。

## 已实现的 `0x6a` 边界

实现以固定的 Offchain Labs 源码 commit [`260bc5dcbd5a16925d7e26145577b2612f30f428`](https://github.com/OffchainLabs/go-ethereum/tree/260bc5dcbd5a16925d7e26145577b2612f30f428) 为依据，参照其中的 [`arb_types`](https://github.com/OffchainLabs/go-ethereum/blob/260bc5dcbd5a16925d7e26145577b2612f30f428/core/types/arb_types.go) 与 [`arbitrum_signer`](https://github.com/OffchainLabs/go-ethereum/blob/260bc5dcbd5a16925d7e26145577b2612f30f428/core/types/arbitrum_signer.go) 定义。

认证规则包括：

- 使用 Arbitrum internal transaction 的专用语义，不把它当作普通 Ethereum signature transaction；
- `ArbOS` sender/to 固定为 `0xa4b05` 语义所要求的内部端点；
- 按 `0x6a || RLP([chainId, data])` 重建完整交易编码；
- internal authentication 与普通签名认证分开处理；
- nonce、gas、value 必须为零；
- 交易仍须通过整个 block 的 transaction trie、交易索引、block hash、chain ID 和外部 canonical/finality fence。

真实对照已使用 Arbitrum Sepolia block `306336967`，hash `d724c7c27a13f4173b0d2f03a1b4f90b2d3da5ba47e64180484d462c40b3e41a`：整块交易根及 13 笔回执的 receiptsRoot 验证通过，覆盖 1 笔 system/internal transaction 与 12 笔 type-2 transaction。固定 fixture 位于 [`internal/chainrpc/testdata/arb-sepolia-306336967.json`](../../services/backend-go/internal/chainrpc/testdata/arb-sepolia-306336967.json)。

这证明的是该固定 block 的 decoder、transaction trie 和认证规则对照通过。原始 block header 的共识来源、canonical/finality 仍由外部 anchor/RPC 信任边界提供。

## 仍不支持的类型

以下交易类型仍 fail-closed/unsupported，不能被静默跳过或按普通交易解释：`0x65`、`0x66`、`0x68`、`0x69`、`0x78`。Receipt 类型支持是另一条独立路径；交易 decoder 支持某一类 Nitro/internal transaction，不等于对应 receipt、system transaction 或交易 trie 语义全部完成。

## 尚未闭合的发布边界

当前仍没有持久化 block replay checkpoint、可恢复 seed/断点、创建块 seed 认证或完整跨历史范围的 Nitro transaction coverage。Holder block replay 的单块 digest、整块原子回放和 trace/receipt 绑定仍属于候选证据层；`HistoryVerified` 与 `PublicationEligible` 不因 `0x6a` 认证而变为 true。

因此不能据此宣称全 Nitro 支持、完整 Holder 历史已认证、D01/D02 已闭环或生产广播/发布已就绪。生产网络验收、持久化恢复、完整历史和发布门禁仍需单独完成。

## 本轮 RPC 检查限制

2026-09-07 再次读取上述高度，block hash 与 fixture 一致。当前配置 RPC 对该系统交易的 `debug_traceTransaction` 返回 HTTP 400；不能据此推断节点不支持全部 trace，也没有证明整块 trace 回放完成。保留原有逐交易 trace 门禁，不跳过系统交易。测试结果与脱敏的实时读取记录见 `outputs/reviews/nitro-internal-2026-09-07/`。

后续 `0x64` deposit 的本地实现与测试见 [deposit 认证说明](NITRO_DEPOSIT_TRANSACTION_AUTHENTICATION.md)，尚无真实 deposit 区块验收。
