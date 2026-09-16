# Token Detail 数据契约

核对日期：2026-09-08

本文对应已实现的只读接口和前端校验器，供后续 Dune SQL、上传工具和详情页接入使用。它不改变交易、结算、持仓或奖励权威边界。

## HTTP 接口

```text
GET /v1/markets/{marketId}/detail?period=1H|6H|1D|1W|1M|ALL
```

支持六档窗口：`1H`、`6H`、`1D`、`1W`、`1M`、`ALL`。接口只返回展示数据，要求 Read Model 已同步且 finalized；页面缓存 30 秒。后端 Dune 结果由后台每 5 分钟轮询一次，Dune 源结果超过 20 分钟即视为过期。请求不会触发 Dune SQL 执行，也不会向浏览器暴露 API key。

Dune 仅在同时配置以下变量时启用：

```text
TG_DUNE_DETAIL_QUERY_ID=<scheduled query id>
TG_DUNE_API_KEY=<server-side key>
```

Dune 轮询读取该查询的 latest completed result，使用 `GET /api/v1/query/{id}/results?limit=10000`；响应不得分页，最多 10,000 行，响应体最多 16 MiB。每行必须只有一个 `payload` JSON 字符串。测试网没有真实 query ID 或 API key 时，不得称为 Dune live 数据；接口会按 section 使用 finalized indexer fallback，缺失部分返回 `null` 和 `reasons`。

## Dune 查询行与 payload

一个 scheduled query 包含多个 market 和 period 行，不能为每个 period 建多个 query。每行的 `payload` 必须符合 `version: 1` 的 `Report`：

```json
{
  "version": 1,
  "chainId": 46630,
  "displayOnly": true,
  "marketId": "0x…64 hex…",
  "memeToken": "0x…40 hex…",
  "quoteAsset": "0x…40 hex…",
  "quoteDecimals": 6,
  "period": "1H",
  "statistics": null,
  "chart": null,
  "trades": null,
  "holders": null,
  "fees": null,
  "sources": {},
  "reasons": {}
}
```

`null` 表示该 section 没有可验证数据，不表示零。所有金额和供应量在 JSON 中均为十进制字符串；禁止浮点数和符号推断。Dune 轮询成功后会覆盖每个 `sources[*]` 的 `provider=dune`、`queryId`、`executionId`、`cachedAt`；SQL payload 必须提供真实的 `asOf`、`blockNumber`、`blockHash`。

各 section 的来源优先级是 Dune → finalized indexer fallback。每个 section 独立判定，不能因一个 section 缺失而伪造其它 section，也不能把 indexer fallback 标记成 dune。`asOf` 必须不晚于当前时间 30 秒，且不超过 20 分钟；source block/hash、chain、market、token 和 quote 必须一致。

## 字段语义

### Statistics

`price` 和 `volume24h` 是 quote 计价的十进制值，不是 USD。`volumeBasis` 固定为：

```text
EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE
```

24h 窗口由 `volumeFrom`/`volumeTo` 表示，并要求完整覆盖。Dune 没有可靠 USD price 时不得填 0 或换算成 USD。

### Chart

周期和粒度固定为：`1H=60s`、`6H=300s`、`1D=900s`、`1W=3600s`、`1M=14400s`、`ALL=86400s`。点必须连续、对齐 interval，最多 2,000 个；缺失价格点为 `null`。

### Holders、流通量与市值

总供应量来自已审核市场的 baseline supply。流通量使用：

```text
TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1
```

它排除当前已知协议地址（包括 curve、vault、pool manager 等），是展示用的版本化排除规则，不是真实经济意义上的统一全网 circulating supply。holder count 是排除已知协议地址后的正余额地址数量，不是自然人数量；只展示排序后的前 100 个地址。

详情页的 cap 按 quote 计价，由价格与流通量计算；不是 USD，也不是 FDV。前端会在缺失价格或供应量时显示 `Unavailable`。

### Fees

手续费累计是实际 emitted/allocated credits，不是 claimable amount，也不是当前 liability。creator credits 已包含 creator tax；holder credits 已从 creator amount 中扣除，禁止重复相加。金额按 asset 分开累计，asset 只能是 meme token 或 quote asset；recipient 只能是 `creator`、`stakers`、`platform`、`holders`。

### Trades

只允许已 finalized 的外部执行及明确标记的内部 reward conversion。交易按 timestamp 降序，最多 100 条；`memeRaw`、`quoteRaw` 为原始整数字符串，`price` 为 quote 计价十进制字符串。交易量不得由 Transfer 总量推导。

## Dune 接入边界

RH 主网已由 Dune 官方公告和公开页面确认上线；RH Testnet `46630` 是否能直接查询，必须在 Dune workspace 用实际 `robinhood.logs`/相关表核对，而不能由主网公告推断。若测试网没有真实 Dune query 结果，使用项目 finalized indexer 生成上传快照；上传表是自有采集数据的分析副本，不是 Dune 原生索引。

随附的接入工具（尚未对真实 Dune 账号执行）：

- `docs/dune/detail_uploaded.sql`
- `tools/dune-detail-upload.mjs`

工具导出符合上述契约的 NDJSON，SQL 按市场和周期选择最新快照并去重。操作步骤见 [`docs/dune/README.md`](../dune/README.md)。

## 对应实现

- Go 模型、校验和 period 定义：`services/backend-go/internal/tokendetail/model.go`
- Dune latest-result 轮询和 10,000 行/16 MiB 校验：`services/backend-go/internal/tokendetail/dune.go`
- Dune 优先、section fallback、30 秒页面缓存：`services/backend-go/internal/tokendetail/service.go`
- finalized indexer 的 candles、trades、holders、fees：`services/backend-go/internal/analytics/detail.go`
- 前端 schema 校验、显示精度和 quote cap：`apps/web/src/v1/tokenDetail.ts`

