# TypeScript Serverless 前端 API 冻结清单

> 状态：`CURRENT TEST CONTRACT / NOT_PRODUCTION_READY`
>
> 2026-09-15 按本地测试候选 `apps/web` 更新。生成 DTO 以 `services/backend-ts/openapi/v1.json`（5.1.0）为准；历史 TS-00 锁定过程见本文末尾。

## 目标 release

- Robinhood Testnet `46630`，`V1-EXEC-11`，当前前后端 release `0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2`。
- 可信 Factory 为 `0xf11839c3566c8b3345ed81e4a0e26cc38aa2866a`。完整前端绑定来自该 release 的 `frontend-bootstrap.json`，后端事件地址来自 `services/backend-ts/packages/events/src/index.ts`。
- 索引起点为 activation block `118689839`。新市场从各自出生块发现并补采；页面数据需通过 finalized publication 校验。
- 当前 Holder 功能采用钱包快照领取路径；前端按目标 distributor 的 reward mode 校验后开放相应操作。旧版 24 小时 stream 与 position 模式不能作为当前钱包快照的验收依据。
- 本清单仅覆盖测试网运行时；已经部署的主网合约需要独立的主网目录、索引起点和环境配置，不能直接复用此测试 release。

## 正式 Read API caller

本节 Read API 只允许 `GET`；Content 上传和 Pipeline 创建交易通知的 `POST` 调用在下一节单独列出。生成契约的正常响应为下表 schema；错误码和完整字段以 baseline 锁定的 OpenAPI 为准。普通目录分页的 `revision`、`cursor`、`limit` 与筛选条件不可跨 publication 混用。Explore 使用独立的 confirmed 展示接口；市值游标固定后台 20 分钟排名版本，Recent buys 游标固定最后买入位置，卡片始终读取当前数据库字段，不能用于交易授权。

| 路径与 query | 响应 schema / 关键约束 | caller 与页面 | 任务 |
| --- | --- | --- | --- |
| `/health` | `HealthResponse`；`executionSpecId/status/sync` | `app.ts` 启动、重连、可见性恢复 | TS-01/05 |
| `/v1/config/{kind}?revision&limit&cursor` | `ConfigPage`；kind=`asset/quote/baseline/template`，`items/nextCursor/sync` | `app.ts:loadConfigDirectory`，全站/Create | TS-06 |
| `/v1/markets?assetUid&marketId&memeToken&launchPhase&search&createdFrom&createdTo&sort&revision&limit&cursor` | `MarketPage`；`items/nextCursor/sync`，排名排序另含 `ranking` | `app.ts` 基础目录、Home、Explore | TS-06 |
| `/v1/markets/{marketId}?revision` | `MarketDetailResponse`；`market/sync` | `app.ts` Trade、Stake、Claim 市场解析 | TS-06/07/09/10 |
| `/v1/market-statistics?markets` | `MarketStatisticsResponse`；`registry/items/observedAt` | `app.ts` 和 `v1/marketOverview.ts`，Home/Explore/Trade | TS-08 |
| `/v1/prices/references` | `DisplayPriceResponse`；`status/confidence/references/expiresAt` | `app.ts`、`v1/displayPrices.ts` | TS-08 |
| `/v1/users/{address}/positions?revision&limit&cursor` | `PositionPage`；`items/nextCursor/sync` | `app.ts`，Stake | TS-09 |
| `/v1/users/{address}/accounts?revision&limit&cursor` | `AccountPage`；`items/nextCursor/sync` | `app.ts`，Stake 账户 | TS-09 |
| `/v1/users/{address}/activity?limit&cursor` | `UserActivityPage`；finalized source、`displayOnly=true` | `app.ts`、`v1/userActivityWidget.ts` | TS-11 |
| `/v1/updates?since` | `SnapshotUpdatesResponse`；`mode/sync/invalidated/pollAfterMs` | `app.ts` snapshot poller | TS-13 |
| `/v1/stats/holders` | `GlobalHolderCountsResponse`；finalized source 和排除策略 | `v1/globalHoldersWidget.ts`，Stats | TS-08 |
| `/v1/stats/series?interval&from&to` | `GlobalFlowSeriesResponse`；`coverage/points/groups` | `v1/globalSeriesWidget.ts`，Stats | TS-08 |
| `/v1/stats/overview?from&to` | `GlobalStatisticsResponse`；`coverage/stocks/groups` | `v1/globalStatsWidget.ts`，Stats | TS-08 |
| `/v1/markets/{marketId}/candles?interval&from&to` | `MarketCandlesResponse`；OHLC、成交量、交易数与覆盖 | `v1/candleWidget.ts`，Trade | TS-07 |
| `/v1/markets/{marketId}/trades?from&to&limit&cursor` | `MarketTradesResponse`；分类、原始数量、来源和覆盖 | `v1/tradeWidget.ts`，Trade | TS-07 |
| `/v1/markets/{marketId}/holders?limit&cursor` | `MarketHoldersResponse`；余额、排除账户、供应量、revision | `v1/holderWidget.ts`，Trade | TS-07 |
| `/v1/markets/{marketId}/detail?period` | `TokenDetailResponse`；period=`1H/12H/1D` | `v1/tokenDetailWidget.ts`，Trade | TS-07 |
| `/v1/transactions/{txHash}` | `TransactionStatusResponse`；receipt、orphaned receipts、head/finalized | `v1/transactionObservation.ts`，交易进度 | TS-11 |

## 正式手写 caller

| Method / 路径 | 请求与响应冻结点 | caller / 条件 | 任务 |
| --- | --- | --- | --- |
| `GET /v1/stats/display` | SchemaVersion 4 materialized global display; optional overview/allocations/stocks section; database-only values including USD; no expiry gate | `controllers/stats.ts` | Stats display integration |
| `GET /v1/stats/events` | Shared display channel; only Stats region invalidations after snapshot commit; no financial authority | `v1/statsUpdates.ts` | Stats lifecycle tests |
| `GET /v1/protocol-statistics` | Legacy schemaVersion 3 snapshot reader, retained for existing API consumers; no longer used by Stats or rebuilt by the minute scheduler | Legacy API | TS-08/15 |
| `GET /v1/statistics-prices` | `chainId/displayOnly/prices/expiresAt`；缺价保持 unavailable | `app.ts:refreshExplorePrices` | TS-08/15 |
| `GET /v1/market-display-statistics?marketId` | `chainId/marketId/displayOnly/complete/totalRaw/participants` | `v1/stakeStatistics.ts`，Stake | TS-08/09/15 |
| `GET /v1/launch-recovery?marketId` | 必须绑定 marketId、交易/创建身份与恢复状态 | `app.ts`，Create 未决交易 | TS-11/15 |
| `GET /v1/holder-reward-history?marketId&account&throughBlock` | `chainId/marketId/account/throughBlock/displayOnly/complete/claimed` | `app.ts:loadHolderRewardHistory`，Claim | TS-10/15 |
| `GET /v1/staker-reward-history?marketId&account&throughBlock` | 同上，资产仅允许该市场 Quote/Meme | `app.ts:loadStakeRewardHistory`，Stake | TS-10/15 |
| `GET /v1/creator-rewards?account&marketId&epoch&cursor` | 数据库中的轮次、原资产余额、待归集费用、提名状态；钱包隔离与签名游标，无 RPC 或全局健康依赖 | `v1/creatorRewards.ts`，Claim/Creator | Creator flow |
| `GET /v1/creator-markets?address&limit&cursor` | `chainId/address/displayOnly/complete/items/nextCursor`；每项 creator 必须等于 address | `v1/creatorMarkets.ts`，Claim/Creator | TS-10/15 |
| `GET /v1/holder-markets?q` | `chainId/complete/items`，最多 20 项，marketId/memeToken 唯一 | `v1/holderMarkets.ts`，Claim/Holder 搜索 | TS-10/15 |
| `GET /v1/wallet-holder-markets?account` | `chainId/account/displayOnly/items` | `app.ts`，Claim/Holder 最近市场 | TS-10/15 |
| `POST /v1/launches` | Pipeline；body 仅为 `{transactionHash}`，后端独立核验创建交易；成功返回 `status=confirmed/marketId`，失败可用同一 hash 重试；不提交或重发链上交易 | `v1/pendingMarket.ts:notifyLaunchDatabase`，Create/交易恢复 | 当前版本 |
| `POST /v1/content/challenges` | body=`account,digest`；响应绑定 origin/chain/account/digest/nonce/expires/message | `create/upload-auth.ts`，Create | TS-12/15 |
| `POST /v1/content/uploads` | 签名 metadata JSON；返回幂等 session 与可选 S3 PUT | `create/metadata.ts`，Create | TS-12/15 |
| `POST /v1/content/uploads/{uploadId}/complete` | 固定对象 version 并入队；返回 202 | `create/metadata.ts`，Create | TS-12/15 |
| `GET /v1/content/uploads/{uploadId}` | Bearer session token；仅 ready 的 IPFS URI 可用于创建 | `create/metadata.ts`，Create | TS-12/15 |

## 条件、测试与排除

- `GET /v1/treasury/markets/{marketId}/epochs/{epochId}/claims/{account}` 仅在目标环境配置 proof origin 且旧 Treasury 市场确实开放时执行 TS-L01。当前 release 未配置该 origin或写入批准，因此不能将 DOM 或遗留 caller 当成已启用能力。
- `GET /v1/events`、`GET /v1/market-directory` 和 `/market-creation/{id}` 仅属于 `VITE_INTEGRATION_BOOTSTRAP` 测试模式，不进入正式 TypeScript Read API。
- `/v1/meme-fee-burns` 已由后端及生成客户端支持，但目前没有正式前端 caller；保留作为后端能力，不计作已展示的页面功能。
- `GET /v1/assets/{assetUid}/statistics` 与 `GET /v1/users/{address}/rewards` 只有生成方法，没有当前正式 caller，本轮排除。
- `getMarketStatistics()` 生成方法没有 caller，但相同 `/v1/market-statistics` 路径有正式手写 caller，所以该路由保留并在 TS-15 统一。
- Blockscout、Coinbase 等浏览器外部展示请求不属于本后端契约；TS-08/14 应由持久 Read API 替代页面关键统计依赖，链上交易和钱包 fresh read 仍由浏览器 `viem` 执行。

## 历史 TS-00 完成证据（2026-09-10，非当前运行时身份）

1. baseline JSON 中的 source locks 固定当前 Go OpenAPI、规范 ABI、产品 artifact、部署 manifest 和前端 bootstrap；后续契约变化必须显式更新并说明原因。
2. 所有正式后台请求均归入 TS-01、05～13、15；测试路由、无 caller 路由和 TS-L01 已明确归类。
3. 当前链上 reward mode 已通过只读 RPC 核验；生产主网身份仍未配置，本清单只证明 test release 范围。
4. 响应字段由锁定 OpenAPI 或列明的 caller 校验冻结；TS-15 完成前 Go 仍是生成 DTO 的临时来源。

## Wallet snapshot rewards

`GET /v1/holder-snapshots?chainId&distributor&marketId&account&cursor` supplies finalized, display-only published round proofs and independent claimed-asset masks. It is included in the current OpenAPI 5.1.0, uses no-store, and returns 503 for missing or corrupt proof archives. See [backend operations](../operations/HOLDER_SNAPSHOT_BACKEND.md).

## 旧目录接口排名维护（兼容其他调用方）

`/v1/markets` 的旧排名实现仍由 `0015_explore_rankings` 提供，Explore 页面已迁移至文末的 confirmed 展示接口。该旧实现增加仅用于展示的最近买入索引及市值排名快照。买入记录随已确认交易写入事务增量更新；重复/较旧事件不会置顶，内部兑换与零额交易不参与，交易移除、分类变化和链重组会修正受影响项目。Recent buys 只列出有符合条件买入的项目，动态游标不保证遍历覆盖全部项目。

市值榜复用 Pipeline `/internal/dispatch` 的现有每分钟调度，按 UTC 20 分钟桶去重生成；价格刷新入口也可触发同一幂等函数。无需新增 Preview cron 或常驻服务。构建成功原子发布、失败保留上次结果；成功构建时清理两小时前的旧版本。Read API 对这些表只读，Pipeline 可写。排名不依赖浏览器触发，不读取即时 RPC。

发布次序为：在测试数据库应用迁移与权限，生成初始市值排名，发布 Pipeline/Read API/Web 候选版，验收 `sin1` 后切换测试别名。生产须另行批准，不能使用测试数据库或 release。

### Developer buy funding

`GET /v1/quote-purchase` accepts mainnet `chainId=4663`, allowlisted `token`, and raw `amountOut`. Returns an expiring exact-output quote with ETH input, intermediate input, block number and price impact (including LP fees). No caching, signing or submission. At most four concurrent reads and eight queued reads per instance. The browser rebuilds calldata from the reviewed route catalog, checks wallet balance again, simulates and submits from the wallet. SATS/BND are not offered.

### Trade payment conversion

`GET /v1/trade-conversion?chainId=4663&sellToken=...&buyToken=...&sellAmount=...&taker=...`

Fixed-input ETH/USDG conversion to the market paired asset through 0x AllowanceHolder v2. Mainnet only; target must be ETH, USDG or a supported Stock route. Server-only `ZEROX_API_KEY`; never expose it in Vite variables. Responses and failures use `Cache-Control: no-store`; in-flight sharing includes the complete intent, including wallet. The response contains the bound intent, `buyAmount`, `minBuyAmount`, 30-second `expiresAt`, normalized `transaction` and optional provider fee. Unknown query parameters, unsupported chain/assets and invalid amounts return 400; unavailable routes and provider authorization failures return a public 503 without upstream details.

This endpoint never submits a transaction. Frontend validates the AllowanceHolder calldata, fixed spend, recipient and minimum, then uses the existing transaction executor. Conversion uses the user-approved 1% tolerance (`slippageBps=100`). Final project minimum is quoted from the conversion minimum and shown separately for approval; Developer Buy's 10% ETH cap is unrelated. Conversion and project buy are two separate wallet transactions. Positive conversion surplus remains in the wallet; the project buy consumes receipt-confirmed paired assets, capped at the reviewed expected amount. After recovery without a resolved receipt balance, it uses the guaranteed minimum. Pending/funded conversion progress is scoped to chain/account/market and never silently replays conversion after a purchase interruption.

Market invalidation stream: `GET /v1/markets/{marketId}/events` (SSE). Payload contains only marketId, revision and changed region names; no user information or display values. Shared instance-level PostgreSQL LISTEN, bounded streams, 60-second client recovery reads. These hints do not authorize transactions.

### Project RPC scope

`GET /v1/rpc-scope?addresses=0x...,0x...` is a bounded, database-only helper for the Web RPC proxy. Maximum 60 lowercase addresses; returns `{chainId, targets:[{address,topics}]}` for fixed protocol contracts, configured assets, reviewed exchange contracts and canonical registered market contracts. Unknown targets are omitted. No client-supplied allowlist is accepted. The proxy enforces address and topic scope before forwarding contract/log requests. Wallet balance, nonce, gas and block-header reads remain available for wallet execution; transaction-hash responses must resolve to an allowed target. Calls do not update projections or initiate RPC from this endpoint.


## Explore confirmed 展示接口

- `GET /v1/explore/bootstrap`：返回 `displayOnly/configs/sync`，从展示 cursor 或已核验创建记录读取已知 head；空库允许返回 unavailable sync + 空列表，不等待全局健康检查或资金结算。
- `GET /v1/explore`：接受 `launchPhase/sort/search/assetUid/limit/cursor`，返回 `MarketPage`。仅查询 `explore_display_cards` 与独立展示排名，不在 HTTP 中执行 RPC、重放交易或计算统计。游标签名绑定筛选条件；排名版本保留两小时，过期游标返回 409 后客户端重开第一页。
- `GET /v1/explore/cards`：`markets` 为最多 100 个 marketId，返回 `chainId/displayOnly/items`，直接读取当前完整卡片（含 `metrics/curveProgress/lastBuy`）。被重组撤销的市场不返回；不按前端时间过期或清空已有指标。
- `GET /v1/explore/events`：共享展示 Worker 的数据库通知连接，SSE `change {marketId,regions,revision}` 与 `ready`。浏览器合并通知，仅补读可见卡片；market/trades 变化触发第一页校对。60 秒补漏，重连主动校对，不依赖 `/v1/updates` 或全局重新初始化。

`0020_explore_display` 提供 confirmed + canonical recent 的数据库视图。confirmed 记录优先；新创建记录在展示 Worker 追上之前可立即列出。后台将美元市值、24h 成交额和最后有效买入位置随展示状态保存，重组 journal 一起撤销。24h USD 成交额是配对资产成交量乘共享当前美元价的估算（排除协议内部成交），不宣称历史成交时美元金额；无交易为 0，缺少完整覆盖或报价为 null。

市值排名由展示 Worker 每 20 分钟写独立快照，分页时只冻结次序，不冻结卡片数值。新市场未进入该快照时先展示在已有排名之前，下一周期纳入正式排名。Recent buys 按区块、交易序号、日志序号排列，保留最近买入位置，不随 24h 缓冲淘汰。上述机制不修改奖励和资金结算确认规则。

发布顺序：先执行数据库迁移与角色权限更新，再发布 Read API 和展示 Worker，验证新接口后发布前端；旧 `/v1/markets` 接口保留给其他业务读取。


### Stats confirmed display

Stats, Explore and market detail consume one receipt/block-verified display worker and the existing shared USD price table. Stats does not introduce log scans, RPC calls, exchange quotes or a price scheduler. USDG remains fixed at USD 1. The independently stored `stats_display_snapshots` row contains all public render values, including valuations. HTTP selects the full payload or one section by deployment identity; requests never build aggregates or reject rows based on age.

The worker uses idempotent event contributions and minute buckets for external volume, trade-time fee revenue and allocation-time credits. A separate per-asset/account position projection tracks allocated principal; per-stock sums and account references are maintained on each delta. Narrow per-market contribution rows maintain Bloomed counts and indexed launch times. Snapshot valuation reads asset totals, relevant fee-token prices and the shared price catalog, not market holder arrays or the full account ledger. Rollback restores market contributions and prior account amounts and deletes orphan flow contributions in the same transaction as the display cursor. Notifications become visible only after commit.

Changes invalidate `overview`, `allocations` or `stocks` only when their stored values differ. The browser debounces bursts, merges only the requested section, retains successful results on network failure, and performs a 60-second recovery read while visible. It never converts USD or clears values because a local freshness timer expired. The Stocks list remains independent of global health/bootstrap/publication requests.

Migration `0021_stats_display` must be applied before the updated worker/API. On first activation, the display worker rebases to its verified stored baseline, seeds prior rolling activity and latest per-wallet allocation checkpoints, then catches up using the same display events. Keep the last successful Stats snapshot while reinitializing. This path is display-only; reward settlement, principal verification and their finality rules remain separate.

- `GET /v1/markets/{marketId}/launch-readiness`: compact persisted launch preparation status; DB-only and no-store.


### Stake reward summary (5.9)

`GET /v1/staker-reward-summary?marketId=…&account=…` reads a stored, wallet-isolated finalized summary. `claimed` and `earned` share `throughBlock` and `revision`. It never calls RPC or adds a latest wallet preview to older history. Responses are `no-store`; transient failures retain the last same-wallet/market values in the client. Unknown coverage returns 503; a proven empty wallet history returns empty amount maps only after the summary checkpoint completes.

`GET /v1/explore?stakingEnabled=true` supplies the Stake selector from confirmed display tables. This display directory is independent of finalized wallet settlement publications; writes still verify canonical contracts and current wallet state.
