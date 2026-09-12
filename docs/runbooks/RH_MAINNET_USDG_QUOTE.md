# RH 主链 USDG Quote 生产接入

2026-09-12 用户明确要求生产支持 RH 官方 USDG 作为 Quote。随后用户批准毕业阈值 7,000 USDG，并统一所有生产 Quote 的虚拟储备为毕业阈值的 40%；这不代表链上已经激活。

## 资产身份

| 字段 | 值 |
| --- | --- |
| 网络 | Robinhood 主链，4663 |
| 名称 / Symbol | Global Dollar / USDG |
| 官方地址 | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| 精度 | 6；1 USDG = 1,000,000 raw |
| 用途 | Quote；本次不将其登记为 Stock Stake 资产 |
| 登记路径 | 管理员审核后 `ApprovedQuoteRegistry.addQuoteConfig` |
| 发布选择 | 已在生产 paired-assets 清单，`includedInRelease=true`；保留唯一条目 |
| 激活状态 | `REGISTRY_ACTIVATION_REQUIRED`，参数已批准，链上尚未激活 |

官方出处：[Robinhood Token Contracts](https://docs.robinhood.com/chain/contracts/)。2026-09-12 在 finalized 区块 `61177484` 回读 symbol、decimals、运行时代码和 EIP-1967 implementation slot；与既有清单身份一致。[现场证据](../reviews/evidence/usdg-quote-2026-09-12/identity.json)。

当前 implementation 为 `0x68184c449e1a8f34fa18d289737129fd27b66f8f`。普通 Quote 路径的 runtime codehash 检查不等于对 implementation 的持续固定，生产审核必须覆盖代理升级及实际转账限制；本次身份核实不代替完整合约安全审核或精确到账 Fork 验证。

## 已批准的经济参数

- `graduationThreshold = 7000000000` raw，即 **7,000 USDG**。
- `phantomQuote = 2800000000` raw，即 **2,800 USDG**。
- 所有生产 Quote 统一 P = 40% × G，以整数精确计算；G 未批准的资产，P 与 G 均保持 null。为精确表达 40%，未来批准的 raw 阈值须可被 5 整除，生成器不擅自舍入。
- 旧 3,236 / 8,090 USDG 仅保留于 reference 字段，不用于生产候选。

## 参数批准后的执行顺序

1. 在生产清单及其生成源同步批准的原始数量，生成对应 baseline 的新 configId / economicsHash。
2. 核对实现、精度、转账限制及精确到账，验证 USDG 市场创建、双向交易、手续费领取、毕业建池和适用的奖励兑换路径。
3. 将 USDG 配置纳入初始生产激活计划；若协议已部署，则由协议管理多签按实际 AccessManager 延迟 schedule / execute 新增配置。当前生产方案的管理员执行延迟为 48 小时。
4. 回读配置 ACTIVE 与身份、保存交易回执，再更新后端数据库、价格来源和批准的前端选择目录。USD 统计使用后端价格证据，不把永久 1 USD 硬编码为市场价格。
5. 前端展示数据仍仅从数据库获取。任何另行授权的 Vercel 发布必须使用 Singapore `sin1`。

本次更新生产参数及验证规则，没有更改合约或发送链上交易。
