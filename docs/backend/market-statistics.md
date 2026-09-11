# TypeScript Serverless 市场统计与展示价格

统计属于展示数据，不参与钱包报价、滑点、签名、奖励结算或资金安全判断。当前权威实现位于 `services/backend-ts/packages/analytics-projector`、`statistics-store` 与 `display-price`；旧 Go 请求内统计缓存、`00079_market_statistics.sql` 和 `TG_STATISTICS_STOCK_ROUTES` 已退出新服务运行链。

## 数据和一致性

- Curve、毕业后 Pool、内部奖励兑换、手续费和 Holder 变化由 pipeline 对已覆盖的 canonical/finalized 区块增量投影；页面 GET 只读取 PostgreSQL publication，不启动历史扫描或 RPC。
- 全局成交按 `assetUid + quoteAsset` 分组。不同 Quote、原始交易量、内部兑换量和手续费资产保持分列，不能直接相加成伪 USD 总额。
- K 线使用精确整数与有理数；完整覆盖内的空桶为 null OHLC 和零成交。缺少覆盖、没有成交和来源冲突分别表达。
- revision、锚点 block/hash、coverage 和 cursor 共同冻结分页视图；过滤条件或 revision 改变会使旧 cursor 失效。

## 展示价格

pipeline 的受保护定时任务从 Robinhood REST `/rhj/assets`、`/rhj/corporate-actions` 和 `/rhj/prices` 获取当前 f72 资产目录的报价。每条响应必须同时匹配 chain ID、Stock Token 地址、asset UID 和 symbol，并满足 ACTIVE、无待处理 multiplier、无未完成 corporate action、非停牌及 USD 计价。

`currentMultiplier` 恰好乘一次，保存 raw bid/ask、adjusted bid/ask、asOf、expiresAt、来源和状态。超时、过期、身份不一致或上游异常均写入 stale/unavailable；前端显示 `Unavailable`，不得回落成 `$0`。当前价格不能替代历史窗口的 USD coverage。

## 接口

- `GET /v1/market-statistics`：Explore/Trade 当前市场统计，批量读取，不在请求内触发 RPC。
- `GET /v1/market-display-statistics`：市场展示统计和 24h coverage。
- `GET /v1/protocol-statistics`：按资产和 Quote 分组的协议统计。
- `GET /v1/stats/overview|series|holders`：Stats 页面服务端聚合，浏览器无需翻完整市场目录。
- `GET /v1/prices/references` 与 `/v1/statistics-prices`：带来源、有效期和 unavailable 语义的展示价格。

接口及生成客户端的唯一来源是 `services/backend-ts/openapi/v1.json`。具体投影、容量、恢复和告警验收以 [`V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md`](../v1/V1_TYPESCRIPT_SERVERLESS_DEVELOPMENT_TASKS.md) 与 [`V1_TYPESCRIPT_SERVERLESS_OPERATIONS.md`](../v1/V1_TYPESCRIPT_SERVERLESS_OPERATIONS.md) 为准。
