# TickerGarden V1 RH Stock Quote 创建时价格参考

> 产品方向：`CONFIRMED`（2026-09-05）<br>
> 工程状态：`SPECIFIED / IMPLEMENTATION_PENDING`<br>
> 当前执行版本：`V1-EXEC-10` 已支持管理员准入的 native/direct immutable ERC-20 Quote 白名单；`NATIVE_ETH_V1` 只是 bootstrap 示例。本文不把任何 BeaconProxy Stock Token 自动激活为 Quote。

## 1. 结论

Robinhood 官方链下只读 API 可以用于少量白名单 Stock Token 的 Quote 配置生成和创建页面估值参考：

- `GET https://api.robinhood.com/rhj/assets` 提供 Asset UID、symbol、Robinhood Chain canonical Token 地址、状态与 `currentMultiplier`；
- `GET https://api.robinhood.com/rhj/prices/{symbol}` 提供底层股票的 USD `bid/ask`、报价生成时间、底层日成交量和停牌标志；
- `GET https://api.robinhood.com/rhj/corporate-actions` 提供公司行动状态。

该 API 不能成为 Curve、Factory、毕业、FeeVault 或 Treasury 的链上信任依赖。平台受约束的 Quote 配置生成器使用 API 形成参考，再用 Robinhood Chain 上对应的 Chainlink Feed 交叉校验；治理最终批准的是 Quote Token 原始最小单位表示的 `phantomQuote` 和 `graduationThreshold`。用户创建 Meme 市场时只能选择已经 ACTIVE 的版本化 Quote config，不能提交任意价格、乘数或毕业参数。

权威来源：

- [Robinhood Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/)
- [Robinhood Chain Oracles & Price Feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/)

## 2. REST 与 Chainlink 的价格语义不能混用

Robinhood 官方文档明确区分两种价格：

| 来源 | 返回值 | 是否已经包含 `uiMultiplier` |
|---|---|---|
| REST `/rhj/prices/{symbol}` | 底层股票每股 USD `bid/ask` | 否 |
| Robinhood Chain Chainlink Feed | 一枚 Stock Token 的 USD 价格 | 是 |

设：

```text
underlyingBidUsd = Decimal(prices.bid)
underlyingAskUsd = Decimal(prices.ask)
M                = Decimal(assets.currentMultiplier) // shares per whole token

tokenBidUsd = underlyingBidUsd × M
tokenAskUsd = underlyingAskUsd × M
```

REST 路径必须乘一次 `currentMultiplier`。Chainlink Feed 已返回 multiplier-adjusted token price，禁止再次相乘。所有字段都是十进制字符串；生成器必须使用定点数或任意精度十进制运算，禁止用 JavaScript `number`、二进制浮点或格式化后的 UI 字符串计算链上整数。

`uiMultiplier()` 只改变每个完整 Stock Token 在 UI 中对应的底层股数，不改变 `balanceOf()`、`totalSupply()` 或 Curve 的 raw-unit balance 会计。市场创建后，Quote 的实时 USD 价格和 multiplier 变化不得反向修改已经冻结的 Curve 参数。

## 3. 创建 Quote config 的确定性换算

Stock Token 当前为18 decimals。设治理已经独立批准：

- `targetGraduationUsd`：该版本希望参考的毕业 Quote 美元规模；
- `phantomToThresholdNumerator / phantomToThresholdDenominator`：随 Pons baseline 冻结的 phantom/threshold 比例；
- `referencePricePolicy`：价格侧、最大时效和 REST/Chainlink 最大允许偏差。

安全基线使用 multiplier-adjusted bid 作为保守参考：

```text
referenceTokenUsd      = tokenBidUsd
graduationThresholdRaw = ceil(targetGraduationUsd × 10^18 / referenceTokenUsd)
phantomQuoteRaw        = floor(
  graduationThresholdRaw
  × phantomToThresholdNumerator
  / phantomToThresholdDenominator
)
```

生成后必须用与 Factory/GraduationExecutor 相同的 `PonsSupplyMath` 和 `GraduationPoolMath` 验证供应分区、整数舍入、signed amount、sqrt price、tick 与 max-liquidity 域。治理实际登记的是最终 raw integers；`targetGraduationUsd` 和参考价格只属于可审计的生成证据，不进入 Curve 热路径，也不意味着毕业时仍值同样的美元金额。

若产品尚未冻结 `targetGraduationUsd`、比例、价差容忍度或最大价格时效，生成器只能输出 `PROPOSED` 草案，不能生成 ACTIVE Quote config。

## 4. 数据校验和 fail-closed 条件

Robinhood 文档说明 `/prices/{symbol}` 的缓存窗口为15秒、API 端点限流为60 requests/second；应优先请求单一 symbol，不能把轮询频率当作价格新鲜度证明。每次生成或刷新 Stock Quote config 至少校验：

1. `/assets` 中 `id`、`deployments[].chainId == 4663`、canonical Token 地址和链上 `uid()`/`decimals()` 一致；
2. Asset 为 `ASSET_STATUS_ACTIVE`，并且目标 symbol、Asset UID 与 Token 地址形成唯一映射；
3. `/prices/{symbol}` HTTP 成功且恰好返回目标资产；`currency == "USD"`；`0 < bid <= ask`；
4. `generatedAt` 不在未来且不超过已批准的 `maxReferenceAgeSeconds`；
5. `isTradingHalt == false`；不存在 pending multiplier；不存在该资产 `IN_PROGRESS` 公司行动；
6. Token、共享 Beacon 与 implementation 指纹仍和 `OfficialStockRegistryV1` 一致；
7. Chainlink `answer > 0`、`updatedAt > 0` 且未超过官方 heartbeat；读取 Feed 自身 `decimals()`，不得硬编码8；
8. RH L2 Sequencer 正常并经过恢复宽限期；Stock Token `oraclePaused() == false`；
9. Chainlink token price 不再乘 multiplier，且与 REST multiplier-adjusted bid/ask 的偏差不超过已批准容忍度；
10. 任一请求超时、HTTP 404/429、字段缺失、未知 enum、陈旧价格、停牌、公司行动、Oracle/Sequencer 异常或价格分歧都停止生成，不得回退为零、复用未标注的旧值或由浏览器自行放行。

`dailyTradingVolume` 是底层股票成交量，不是 RH 链上 Stock Token 流动性。Quote 白名单仍须独立验证 canonical DEX/RFQ route、池深度、LP 集中度以及目标金额的实际 swap simulation。

## 5. 创建页面与链上信任边界

```text
Robinhood /assets ──────────────┐
Robinhood /prices/{symbol} ─────┼─> 受约束的 Quote Config Generator
Robinhood /corporate-actions ───┤        │
RH Chain Chainlink + Token ─────┘        ├─> raw evidence + hash + PROPOSED config
                                        │
                               延迟治理审核/登记
                                        │
                               ACTIVE Stock Quote config
                                        │
用户创建 Meme ──选择 configId───────────┤
                                        ▼
Factory 冻结 quoteAsset / phantomQuote / graduationThreshold
                                        │
                                        ▼
Curve 与毕业池只按 raw Token 数量运行，不再读取 API/Oracle
```

创建页面可以实时显示：

- Stock Token 的 multiplier-adjusted USD bid/ask 参考区间和 `generatedAt`；
- 当前 ACTIVE config 的 `phantomQuote`、`graduationThreshold` Token 数量；
- 按最新参考价格估算的美元值，并明确标记“展示值会变化、链上 raw 参数不会变化”；
- 数据陈旧、停牌、公司行动、Oracle 暂停或 Quote config 非 ACTIVE 时禁止发起新市场创建。

前端 API 结果只用于展示和提前失败。资金敏感的创建交易仍必须由 Factory 读取链上 Registry、校验 ACTIVE config 与不可变 `expectedEconomics`；浏览器不能提交 API 价格替代 Registry 参数。

## 6. 点时验证样例

2026-09-04 对官方端点的点时读取获得：

```text
symbol             = AAPL
chainId            = 4663
canonical token    = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
underlying bid     = 320.97 USD
underlying ask     = 321.00 USD
currentMultiplier  = 1.000566080061092436
token bid          = 321.15169471720883918292 USD
token ask          = 321.18171169961067195600 USD
isTradingHalt      = false
generatedAt        = 2026-09-04T17:03:24.714442651Z
```

该样例只证明 API 字段和换算语义，不是 AAPL 的生产 Quote config，也不能在以后复用其动态价格。

## 7. 实现与发布缺口

当前 `ApprovedQuoteRegistry` 对普通 ERC-20 禁止可执行 `DELEGATECALL`，因此 Robinhood BeaconProxy Stock Token 仍不能登记为 Quote。启用任何 Stock Quote 前必须另行完成：

1. 增加只接受 `OfficialStockRegistryV1` canonical Asset UID/Token/Beacon/implementation 指纹的专用 Stock Quote 准入路径；普通 ERC-20 的 direct immutable 规则保持不变；
2. 将 Stock Quote 的 Asset UID、参考价格证据 hash、生成策略版本和最终 raw 参数写入版本化部署证据；
3. 实现并测试 Quote Config Generator，覆盖 REST/Chainlink multiplier 差异、十进制舍入、限流、陈旧数据、停牌、公司行动和不一致价格；
4. 增加真实 RH Stock Token fork 测试，覆盖 buy/sell、尾单退款、原子毕业、FeeVault/Treasury 精确偿付、pause/blocklist/adminBurn 与 Beacon 升级；
5. 选定少量满足流动性门槛的 Stock Token 并生成新的 ACTIVE config；在专用代理路径完成前，`spec/v1_initial_quote_configs.json` 只把 native 条目作为示例，其他符合现有 direct immutable 规则的 ERC-20 仍可由管理员独立加入。

因此，本文确认的是“官方链下价格可用于创建时的可审计参考”，不是“链下 API 可以直接控制链上市场”或“194 种 Stock Token 已获得 Quote 资格”。
