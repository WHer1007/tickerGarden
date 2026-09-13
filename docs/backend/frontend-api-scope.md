# TypeScript Serverless 前端 API 冻结清单

> 状态：`TS-00 CONTRACT FROZEN / TEST TARGET ONLY / NOT_PRODUCTION_READY`
>
> 本清单按 2026-09-10 当前工作树的真实 caller 冻结。精确生成 DTO 由锁定的 `services/backend-ts/openapi/v1.json` 定义，身份与摘要见 [typescript-serverless-baseline.json](./typescript-serverless-baseline.json)。

## 目标 release

- Robinhood Testnet `46630`，`V1-EXEC-11`，当前前端 release `0x5c2c656b1b23e895ea268c34b187cd267e0f4fdcc1759c726cbca7fafb7c9c12`。
- 可信 Factory 为 `0xf36e6af97dde5ecc7fd7d9817c5c2f9fea2f1fe7`；注册表、FeeVault、AllocationManager 和 LaunchRouter 地址锁在 baseline JSON。
- 索引起点为当前前端 release 的 activation block `117032526` / `0x36065fb09f78a00f75c528cad0e81e2f1a7b9f59bea9577488f26f4fb611f806`。该 release 的 bootstrap 不含初始市场；新市场必须从各自出生块动态发现并补采。
- 当前前端仍指向本节记录的旧 release，其只读 RPC 实测 `HolderRewardsDistributorV1.rewardMode()` 为 `TICKERGARDEN_HOLDER_STREAM_24H_V1`。V4 已另行部署为 Robinhood testnet release `0x6e743e8bf90c0e91cd7de52711a1a68976401c494187f1e015fc66ef17310f95` 并完成 Registry 激活，但尚未通过公开市场 E2E，因此不能把其 ABI 或领取入口混入当前前端 release。

## 正式 Read API caller

所有接口只允许 `GET`。生成契约的正常响应为下表 schema；错误码和完整字段以 baseline 锁定的 OpenAPI 为准。分页的 `revision`、`cursor`、`limit` 与筛选条件不可跨 publication 混用。

| 路径与 query | 响应 schema / 关键约束 | caller 与页面 | 任务 |
| --- | --- | --- | --- |
| `/health` | `HealthResponse`；`executionSpecId/status/sync` | `app.ts` 启动、重连、可见性恢复 | TS-01/05 |
| `/v1/config/{kind}?revision&limit&cursor` | `ConfigPage`；kind=`asset/quote/baseline/template`，`items/nextCursor/sync` | `app.ts:loadConfigDirectory`，全站/Create | TS-06 |
| `/v1/markets?assetUid&marketId&memeToken&launchPhase&search&createdFrom&createdTo&sort&revision&limit&cursor` | `MarketPage`；`items/nextCursor/sync` | `app.ts` 基础目录、Home、Explore | TS-06 |
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
| `GET /v1/protocol-statistics` | `chainId/displayOnly/coverage/marketCount/groups`；缺覆盖不得回退为零 | `app.ts:refreshExplorePrices` | TS-08/15 |
| `GET /v1/statistics-prices` | `chainId/displayOnly/prices/expiresAt`；缺价保持 unavailable | `app.ts:refreshExplorePrices` | TS-08/15 |
| `GET /v1/market-display-statistics?marketId` | `chainId/marketId/displayOnly/complete/totalRaw/participants` | `v1/stakeStatistics.ts`，Stake | TS-08/09/15 |
| `GET /v1/launch-recovery?marketId` | 必须绑定 marketId、交易/创建身份与恢复状态 | `app.ts`，Create 未决交易 | TS-11/15 |
| `GET /v1/holder-reward-history?marketId&account&throughBlock` | `chainId/marketId/account/throughBlock/displayOnly/complete/claimed` | `app.ts:loadHolderRewardHistory`，Claim | TS-10/15 |
| `GET /v1/staker-reward-history?marketId&account&throughBlock` | 同上，资产仅允许该市场 Quote/Meme | `app.ts:loadStakeRewardHistory`，Stake | TS-10/15 |
| `GET /v1/creator-markets?address&limit&cursor` | `chainId/address/displayOnly/complete/items/nextCursor`；每项 creator 必须等于 address | `v1/creatorMarkets.ts`，Claim/Creator | TS-10/15 |
| `GET /v1/holder-markets?q` | `chainId/complete/items`，最多 20 项，marketId/memeToken 唯一 | `v1/holderMarkets.ts`，Claim/Holder 搜索 | TS-10/15 |
| `GET /v1/wallet-holder-markets?account` | `chainId/account/displayOnly/items` | `app.ts`，Claim/Holder 最近市场 | TS-10/15 |
| `POST /v1/content/challenges` | body=`account,digest`；响应绑定 origin/chain/account/digest/nonce/expires/message | `create/upload-auth.ts`，Create | TS-12/15 |
| `POST /v1/content/uploads` | 签名 metadata JSON；返回幂等 session 与可选 S3 PUT | `create/metadata.ts`，Create | TS-12/15 |
| `POST /v1/content/uploads/{uploadId}/complete` | 固定对象 version 并入队；返回 202 | `create/metadata.ts`，Create | TS-12/15 |
| `GET /v1/content/uploads/{uploadId}` | Bearer session token；仅 ready 的 IPFS URI 可用于创建 | `create/metadata.ts`，Create | TS-12/15 |

## 条件、测试与排除

- `GET /v1/treasury/markets/{marketId}/epochs/{epochId}/claims/{account}` 仅在目标环境配置 proof origin 且旧 Treasury 市场确实开放时执行 TS-L01。当前 release 未配置该 origin或写入批准，因此不能将 DOM 或遗留 caller 当成已启用能力。
- `GET /v1/events`、`GET /v1/market-directory` 和 `/market-creation/{id}` 仅属于 `VITE_INTEGRATION_BOOTSTRAP` 测试模式，不进入正式 TypeScript Read API。
- `GET /v1/assets/{assetUid}/statistics` 与 `GET /v1/users/{address}/rewards` 只有生成方法，没有当前正式 caller，本轮排除。
- `getMarketStatistics()` 生成方法没有 caller，但相同 `/v1/market-statistics` 路径有正式手写 caller，所以该路由保留并在 TS-15 统一。
- Blockscout、Coinbase 等浏览器外部展示请求不属于本后端契约；TS-08/14 应由持久 Read API 替代页面关键统计依赖，链上交易和钱包 fresh read 仍由浏览器 `viem` 执行。

## TS-00 完成证据

1. baseline JSON 中的 source locks 固定当前 Go OpenAPI、规范 ABI、产品 artifact、部署 manifest 和前端 bootstrap；后续契约变化必须显式更新并说明原因。
2. 所有正式后台请求均归入 TS-01、05～13、15；测试路由、无 caller 路由和 TS-L01 已明确归类。
3. 当前链上 reward mode 已通过只读 RPC 核验；生产主网身份仍未配置，本清单只证明 test release 范围。
4. 响应字段由锁定 OpenAPI 或列明的 caller 校验冻结；TS-15 完成前 Go 仍是生成 DTO 的临时来源。

## Wallet snapshot rewards

`GET /v1/holder-snapshots?chainId&distributor&marketId&account&cursor` supplies finalized, display-only published round proofs and independent claimed-asset masks. It is generated in OpenAPI 4.6.0, uses no-store, and returns 503 for missing or corrupt proof archives. See [backend operations](../operations/HOLDER_SNAPSHOT_BACKEND.md).
