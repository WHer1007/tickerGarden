# 生产报价源验证

验证时间：2026-09-16 北京时间，原始样本 UTC 2026-09-15 17:15–17:20。初次验证结论：**报价链路尚未全部通过验收**。本轮只读探测、响应回放与代码检查；没有修改业务报价逻辑、部署或执行交易。

## 实测

| 来源 | 本地 | 现有 VPS | 结论 |
| --- | --- | --- | --- |
| Robinhood assets / corporate-actions / prices | 全部 200 | 全部 200，首轮约 490–1045 ms | 可达，返回 194 个 Stock 报价 |
| Coinbase ETH/USD spot | 连接超时 UND_ERR_CONNECT_TIMEOUT | 200，首轮 72 ms；样本 2414.175 USD | 先前 ETH 失败属于本地访问问题；VPS 可用 |
| Coinbase USDG/USD spot | 连接超时 | 404 | 当前生产适配器使用了不可用接口，不能上线后依靠重试解决 |
| Kraken USDG/USD Ticker、AssetPairs | 未测 | 200；交易对 online，bid 0.9999、ask 1.0000 USD | 可作为 USDG 候选来源，尚未接入 |
| 测试 Read API prices/references | 未测 | 200，但 references=[] | 不能据此认定 Vercel 价格刷新链路已通过 |

数字仅是采样时读数，不是当前实时价格或延迟 SLA。VPS 连通不等于 Vercel 函数已验证；新生产报价逻辑尚未部署到函数运行环境。

用 VPS 真实响应回放当前生产适配器，共 196 项：157 可用（156 Stock + ETH），24 Stock 因 corporate_action_pending 被屏蔽，14 Stock 因 invalid_price 被拒绝，USDG 失败。Stock 可用样本 generatedAt 距采集时刻约 9.126 秒，在 300 秒过期阈值内。

## 已定位问题

### 1. 14 个 Stock 是本地精度校验误判

输入价格和 multiplier 均允许最多 18 位小数，`multiplyDecimal` 使用 BigInt 精确相乘，可产生最多 36 位小数；随后 `positive` 又使用只允许 18 位小数的输入正则，导致合法乘积被拒绝。

例如 AAPL：`329.87 × 1.000566080061092436 = 330.05673282975256186332`。数值为正且买卖价顺序正确，但有 20 位小数，因此被误判。首轮涉及 DELL、CCL、MSFT、UPS、SGOV、MU、F、AMAT、LLY、JNJ、ORCL、AAPL、COST、ASML。

修复应区分上游输入精度与内部乘积精度，保留 BigInt 精确计算、正数校验和 bid ≤ ask；不可用浮点转换或省略乘数绕过。

### 2. 公司行动过滤范围过宽

当前实现只要同 symbol 的任意公司行动不是 COMPLETED，就屏蔽价格。首轮 24 项均为现金分红，其中 22 项 processDate 在采样 UTC 日期之后；相关资产 pendingMultiplier 均为空且 isTradingHalt=false。

官方文档明确 IN_PROGRESS 包含 PENDING + READY，processDate 是处理调度日期，不能仅凭该状态推断当前已暂停报价。该过滤会将未来分红公告也当作当前价格无效。应根据当前 multiplier、pendingMultiplier 生效窗口、交易/预言机暂停状态和数据时间一致性决定是否暂缓，无法判定的状态仍保守处理；不建议直接删除所有公司行动检查。GOOGL、HII 的 processDate 已过去，不能只靠未来日期排除规则处理全部 24 项。

### 3. USDG 接口选择错误

VPS 能访问 Coinbase ETH，USDG 则明确 404。Kraken 公开接口已返回 USDG/USD 正常订单报价与交易对身份，可替换为独立 USDG 展示价格适配器。需要校验 result/error、交易对身份、正数与价差、获取时间/缓存期限和失败状态；Ticker 本身没有报价生成时间，不得把本地接收时间宣称为交易所报价时间。禁止将 USDG 固定为 1 美元。

## 其他注意点

- Robinhood REST 是未乘 multiplier 的 underlying-equity bid/ask，当前乘一次的方向正确；链上 Chainlink 价格已调整 multiplier，切换来源时不能再乘一次。
- 194 项分四批，每批重新读取同样的三个全量接口，共 12 次请求。可以在一次刷新中共享这些响应，再分批解析，减少重复请求并改善跨批次时间一致性。
- 当前价格 TTL 为 300 秒。落地运行时需验证刷新周期、过期显示为“-”、失败重试与告警，且不能把旧价格重新标记为新报价。
- 这些价格用于展示统计，不作为合约成交报价、最小收到金额或资金结算依据。

## 证据与后续验收

忽略提交的原始响应与分析位于 `outputs/quote-validation-20260916/`：`local.json`、`vps.json`、`vps-repeat.json`、`evaluation.json`、`alternatives-vps.json`。回放使用当前 `fetchRuntimePriceReferences`，输入固定为抓取响应及当时采集时间；它验证解析结果，不是一次生产数据库写入。

下一步修复以上三项，添加精度/公司行动/报价源异常回归测试，然后在测试部署的实际 Vercel 运行环境验证刷新、持久化、Read API 和前端显示全链路。

官方依据：[Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)、[Coinbase Prices API](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices)。Kraken 可达性及返回结构以本次原始 HTTP 响应为依据。

## 两项 Stock 修复已完成

按用户确认，194 个已登记官方 Stock 不因公司行动公告被额外禁用。修复乘积校验，允许最多 36 位小数，保留输入 18 位限制和 BigInt 精确运算。移除 corporate-actions 公告列表对报价可用性的依赖；当前资产 ACTIVE、报价未停牌且身份/时效有效即可使用。官方 pendingMultiplier 的未来生效时间不会立即屏蔽，仍使用 currentMultiplier，并将报价有效期截断到切换时刻；到期未切换、时间不明、停牌或停用仍不可发布有效报价。

原 VPS 响应回放修复后为 194/194 Stock 可用，另有 ETH 可用、USDG 接口问题未修复。最新真实 REST 抓取亦为 194/194 Stock 可用、无拒绝，见 `outputs/quote-validation-20260916/fixed-live.json`。修复回放摘要见 `fixed-evaluation.json`；初次分析所用原始数据仍保留在 vps.json。后端 99 项测试通过，含 36 位极小乘积、未来乘数生效边界、已到期/无效乘数、停牌、资产停用、错误价格与币种；构建通过。

这两项 Stock 代码问题已解决。USDG 接口替换及部署环境全链路验收仍待完成；本轮未提交或部署。以上可用数量是采样结果，不代表未来停牌或上游异常时强制提供报价。

## USDG 策略变更已实现

按用户明确要求，USDG 展示估值固定为 1 美元，不再调用任何 USDG 外部报价接口。API 来源枚举新增 fixed_usd，前端明确标注 fixed assumption，不将其显示为 Coinbase 或实时市场报价。链上成交/结算不变；ETH 与 Stock 的动态报价不变。API 版本提升为 5.4.0，生成客户端和 schema 锁已同步。后端 99 项、前端 471 项测试和前端构建通过；回归测试验证不请求 USDG 外部接口、固定值为 1、页面来源说明正确。原 Coinbase 404 为历史记录，不再是发布阻塞项；此前建议接入 Kraken 已被本次用户决定取代。修改尚未提交或部署。
