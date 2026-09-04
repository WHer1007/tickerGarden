# TickerGarden V1 外部 G0 证据记录

> 状态：`OBSERVED_NOT_APPROVED`  
> 观测时间：2026-09-02 12:28:48（Asia/Shanghai）  
> 固定区块：Robinhood Chain `52,289,586`（`0x31de032`）  
> 区块哈希：`0x9477917aacd098d56b4d5fb375e555a09d1a61b7bf33417429e5c8e4a2e86006`  
> 机器记录：[`spec/v1_g0_external_evidence.json`](./spec/v1_g0_external_evidence.json)

> 后续决策：本文件保留取证当时的 `BLOCKED` 快照，不随产品决定回写。2026-09-02 后续已选择 `0x7eD598…` 固定行为作为参考并批准多 Quote 协议能力；当前规范见 [V1_PONS_BEHAVIOR_BASELINE.md](./V1_PONS_BEHAVIOR_BASELINE.md) 与 [V1_G0_RECOMMENDATIONS.md](./V1_G0_RECOMMENDATIONS.md)。公开源码复现、反狙击差分和逐资产生产配置仍未关闭。

本文只记录可复现的外部事实，不代表产品、安全或部署批准。任何 `BLOCKED` 项都不得被实现者用默认常量绕过。

## 1. Pons V2 官方来源冲突

两个 Pons 官方来源目前指向不同的 Pons V2 Factory：

| 来源 | Factory | 固定区块状态 |
|---|---|---|
| [Pons V2 官方文档](https://docs.ponsfamily.com/v2) | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | `launchEnabled=true` |
| [Pons 官方源码仓库](https://github.com/ponsdotdev/ponsfamily/tree/845bd546b37515621e47b08015ce4f9d374f6eca) | `0x7E1EAbd52Ae29598e6483F72dCf1a70b14284dB8` | `launchEnabled=false` |

两者均返回一个启用的 `launchConfigId=0`，且 LaunchConfig 数值相同：

| 字段 | 值 |
|---|---:|
| `supply` | `1,000,000,000 × 10^18` |
| `curveFeeBps` | `100` |
| native `phantomQuote` | `1.68 × 10^18` |
| native `graduationThreshold` | `4.2 × 10^18` |
| `poolFee` | `0` |
| `tickSpacing` | `200` |
| 推导 `reservedTokens` | `285714285714285714285714285` |
| 推导 `sellableTokens` | `714285714285714285714285715` |

但它们不是相同部署：

| Factory | Runtime bytes | Runtime Keccak-256 |
|---|---:|---|
| `0x7eD598…` | `24,177` | `0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84` |
| `0x7E1EAb…` | `22,757` | `0x9d6391ccd6730301cf53ea0f520b42d9f13d9dd11ba803c19ae3a01d145b7d9e` |

仓库固定 commit `845bd546b37515621e47b08015ce4f9d374f6eca` 的 Factory 源文件 SHA-256 为 `561475202f7635d9c2caa1c4eed196642bedc2c32ed77afc6297175ef86ea2c7`。该源码声明了 `snipeTaxStartBps()`、`snipeTaxSeconds()` 与 `feePolicy()` 的 public getter，但这些 selector 在 `0x7E1EAb…` 固定区块运行时均回滚；因此不能把仓库当前源码当成该部署的已验证精确源码。

结论：`V1-G0-PONS-BASELINE-01` 仍为 `BLOCKED`。必须先选择权威 release/Factory，并取得与其 runtime 匹配的 ABI/源码或独立行为规格。

## 2. Quote Asset 事实

[Robinhood Chain 官方 Token Contracts](https://docs.robinhood.com/chain/contracts/) 当前列出的稳定币是：

```text
USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
decimals = 6
```

该官方页面没有列出 USDC。因此，既有产品决定“使用 RH 链官方 USDC”与当前官方资产清单不一致，不能将任意同名 USDC 合约视为官方资产。

在固定区块上，两个 Pons Factory 均批准了上述 USDG，并返回相同 economics：

| 字段 | Raw value | 人类单位 |
|---|---:|---:|
| `phantomQuote` | `3,236,000,000` | `3,236 USDG` |
| `graduationThreshold` | `8,090,000,000` | `8,090 USDG` |
| `expectedEconomics` | `0x7909a028ec0fee3564b05d53b74cd91d79786f17ac5aa90be360c0b78201e86a` | — |

该比例同样推导出 `2/7` 的池保留量。它只证明 USDG 的 Pons 现网配置，不自动授权 TickerGarden 改用 USDG。

历史结论：上述 USDG 仅是链上观测，`V1-G0-PONS-QUOTE-01` 不构成对其的批准；其可升级代理身份也不符合普通 Quote 门禁。该点时快照中的“新增 Quote BLOCKED”已由 `V1-EXEC-10` 的管理员白名单实现取代：管理员现在可以追加任意通过风险评估的 native 或 direct immutable ERC-20 config，但每个具体资产在进入 `ACTIVE` 前仍必须提供 canonical 合约、发行/桥接权威、源码/行为审查及非代理证明。Robinhood 官方 Stock Token 如作为 Quote，仍必须走独立的 Asset UID/Beacon 指纹和行为审查路径，不能据此为 USDG 或其他代理资产创建通用豁免。

## 3. 已观测但未批准的其他状态

- `0x7eD598…`：`launchFee = 0.0005 ETH`、`snipeTaxStartBps = 9900`、`snipeTaxSeconds = 3`。
- `0x7E1EAb…`：`launchFee = 0.0005 ETH`，但全局发行关闭；不能仅凭存在启用的 LaunchConfig 推断公众可发行。
- Pons 官方文档仍声明三项独立审计处于进行中；TickerGarden 不得宣传 baseline 已审计。
- 外部状态会变化。所有生产 fixture 必须引用区块号、区块哈希、runtime codehash 与行为向量，不能只记录“latest”。

## 4. 对任务的影响

| G0/任务 | 当前状态 | 原因 |
|---|---|---|
| `V1-G0-PONS-BASELINE-01` / `V1-P-005` | `BLOCKED` | 官方来源冲突，尚无获批的唯一 runtime/ABI |
| `V1-G0-PONS-QUOTE-01` / `V1-P-005` | `BLOCKED` | 明确要求 USDC，但官方清单与 Pons 已批准资产是 USDG |
| `V1-G0-PONS-DIFF-01` | `BLOCKED` | 必须先选择 baseline 才能签署逐项差异 |
| `V1-P-007` | `BLOCKED` | Quote 与 backing target 数值域未冻结 |
| `V1-P-010` | `BLOCKED` | 仍需产品、安全、法律与部署负责人签字 |

在这些门禁关闭前，可以继续完善不依赖具体经济参数的规格测试，但不得开始 Curve、Graduation、生产 Quote Registry 或 Gauge 数值常量的实现。
