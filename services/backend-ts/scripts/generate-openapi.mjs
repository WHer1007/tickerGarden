import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSchemaVersionTransition } from "./openapi-versioning.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.join(root, "openapi/v1.json");
const lockPath = path.join(root, "openapi/v1.lock.json");
const clientPath = path.join(root, "openapi/generated/v1-client.ts");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema) => ({ oneOf: [schema, { type: "null" }] });
const object = (properties, required = Object.keys(properties), extra = {}) => ({ type: "object", additionalProperties: false, properties, required, ...extra });
const uintString = { type: "string", pattern: "^(0|[1-9][0-9]*)$" };
const address = { type: "string", pattern: "^0x[0-9a-f]{40}$" };
const bytes32 = { type: "string", pattern: "^0x[0-9a-f]{64}$" };
const source = object({ chainId: { type: "integer", enum: [4663, 46630, 421614] }, blockNumber: uintString, blockHash: bytes32, transactionHash: bytes32, transactionIndex: { type: "integer", minimum: 0 }, logIndex: { type: "integer", minimum: 0 } });
const sync = object({
  chainId: { type: "integer", enum: [4663, 46630, 421614] }, status: { type: "string", enum: ["synced", "lagging", "unavailable"] },
  blockNumber: nullable(uintString), blockHash: nullable(bytes32), finality: { type: "string", enum: ["finalized", "safe", "head", "unavailable"] },
  headBlockNumber: nullable(uintString), headBlockHash: nullable(bytes32), lagBlocks: nullable(uintString), revision: { type: "string", minLength: 1 },
});
const poolKey = object({ currency0: address, currency1: address, fee: { type: "integer", minimum: 0, maximum: 16777215 }, tickSpacing: { type: "integer", minimum: -8388608, maximum: 8388607 }, hooks: address });
const route = object({
  router: address, quoter: address, hook: address, launchLocker: address, graduationExecutor: address,
  curveTradingEnabled: { type: "boolean" }, poolTradingEnabled: { type: "boolean" }, sourceVersion: { type: "integer", minimum: 1 },
  launchPhase: { type: "integer", enum: [0, 1] },
});
const curve = object({ realQuoteReserve: uintString, sellableTokens: uintString, reservedTokens: uintString, accruedCurveFees: uintString, readyToGraduate: { type: "boolean" } });
const marketIdentity = object({ name: {type:"string",maxLength:4096}, symbol: {type:"string",maxLength:4096}, metadataURI: {type:"string",maxLength:16384}, deployedAt:uintString, blockNumber:uintString, blockHash:bytes32, runtimeCodeHash:bytes32 });
const lastBuy = object({blockNumber:uintString,transactionIndex:uintString,logIndex:uintString,timestamp:uintString});
const usdDecimal = {type:"string",pattern:"^(0|[1-9][0-9]{0,179})(\\.[0-9]{1,18})?$"};
const marketMetrics = object({status:{type:"string",enum:["available","unavailable"]},reason:{type:"string"},volume24hUsd:nullable(usdDecimal),marketCapUsd:nullable(usdDecimal),quoteUsdMidpoint:nullable(usdDecimal),windowFromTimestamp:uintString,asOfTimestamp:uintString,usdPriceAsOf:nullable({type:"string",format:"date-time"}),usdPriceSource:nullable({type:"string",enum:["robinhood_rest","coinbase_spot","testnet_pool_spot"]}),volumeBasis:{type:"string",const:"EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"},marketCapBasis:{type:"string",enum:["BASELINE_TOTAL_SUPPLY_X_LATEST_FINALIZED_24H_EXECUTION_PRICE","TOTAL_SUPPLY_X_POOL_SPOT_X_QUOTE_USD","TOTAL_SUPPLY_X_FINALIZED_SPOT_X_QUOTE_USD"]}});
const market = object({
  marketId: bytes32, assetUid: bytes32, memeToken: address, curve: address, gauge: address, quoteAsset: address,
  quoteAssetConfigId: bytes32, tickerGardenBaselineId: bytes32, sourceVersion: { type: "integer", minimum: 1 },
  launchPhase: { type: "integer", enum: [0, 1] },
  curveProgress: ref("CurveProgress"), poolId: nullable(bytes32), poolKey: nullable(ref("PoolKeyReadModel")),
  canonicalRoute: ref("CanonicalRoute"), source: ref("SourceBlock"),
}, undefined, { description: "poolId and poolKey are null or non-null together." });
market.properties.confirmation = object({status:{type:'string',const:'confirmed'},blockNumber:uintString,blockHash:bytes32,observedAt:{type:'string',format:'date-time'}});
market.properties.creator = address;
market.properties.creatorFeesToHolders = {type:'boolean'};
market.properties.burnMemeFees = {type:'boolean'};
market.properties.lpFeePips = {type:'integer',enum:[0,1000,2000,3000]};
market.properties.stakingEnabled = {type:'boolean'};
market.properties.display = object({priceQuote:nullable({type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]{1,36})?$"}),totalSupplyRaw:uintString,totalStakedRaw:uintString,activeStakeRaw:uintString,creatorTaxBps:{type:'integer',minimum:0,maximum:500},asOfTimestamp:uintString,blockNumber:uintString,blockHash:bytes32});
market.properties.identity = ref("MarketIdentityReadModel");
market.properties.metrics = ref("MarketMetricsReadModel");
market.properties.lastBuy = ref("LastBuyReadModel");
const configValue = { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };
const config = object({ kind: { type: "string", enum: ["asset", "quote", "baseline", "template"] }, id: bytes32, status: { type: "integer", minimum: 0, maximum: 255 }, values: { type: "object", additionalProperties: configValue }, source: ref("SourceBlock") });
const claimQuote = object({ kind: { type: "string", const: "quote" }, asset: address, amount: uintString });
const claimMeme = object({ kind: { type: "string", const: "meme" }, asset: address, amount: uintString });
const position = object({
  user: address, assetUid: bytes32, marketId: bytes32, free: uintString, allocated: uintString, pending: uintString, active: uintString,
  activationAt: nullable(uintString), unlockAt: nullable(uintString),
  claimable: { type: "array", prefixItems: [ref("QuoteClaimable"), ref("MemeClaimable")], minItems: 2, maxItems: 2 }, source: ref("SourceBlock"),
});
const page = (item) => object({ items: { type: "array", items: ref(item) }, nextCursor: nullable({ type: "string", minLength: 1 }), sync: ref("SyncStatus") });
const error = object({
  error: { type: "string", enum: ["invalid_request", "market_not_found", "not_found", "read_only", "identity_unavailable", "market_metrics_unavailable", "accounts_unavailable"] }, message: { type: "string" },
  allowedMethods: { type: "array", prefixItems: [{ type: "string", const: "GET" }], minItems: 1, maxItems: 1 }, sync: ref("SyncStatus"),
}, ["error", "message", "sync"]);

const recentParameter = {name:'includeRecent',in:'query',required:false,schema:{type:'boolean'},description:'Display only: merge independently verified creation records from the database before finalization. Per-market confirmation identifies these records; sync describes the finalized base only. Responses are not immutable and cursors expire when the recent set changes. Never use for settlement.'};
const revisionParameter = { name: "revision", in: "query", required: false, schema: { type: "string", pattern: "^[0-9]+:0x[0-9a-f]{64}$" } };
const queryParameters = [
  revisionParameter,
  { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", required: false, description: "Opaque cursor bound to endpoint, normalized filter and Indexer revision.", schema: { type: "string", minLength: 1 } },
];
const response = (schema, description = "Success") => ({ description, content: { "application/json": { schema } } });
const errors = { "400": response(ref("ApiErrorResponse"), "Invalid input or cursor snapshot"), "405": response(ref("ApiErrorResponse"), "Read-only API") };

const rewardValues = object({claimStatus:{description:"Observed reward and lock conditions only; candidate does not certify solvency, simulation or successful payment.",type:"string",enum:["candidate","no_rewards","rage_quit_pending","position_locked"]},claimCandidateAmount:{...uintString,description:"Original fee-asset unpaid amount only when claimStatus is candidate; otherwise zero."},positionUnlockAt:uintString,positionLockSatisfied:{type:"boolean",description:"Gauge principal lock condition only; true for Creator. Other claim conditions are reported separately."},conversionStatus:{type:"string",enum:["not_applicable","no_rewards","not_graduated","rage_quit_pending","position_locked","candidate"]},conversionCandidateAmount:uintString,marketId:bytes32,feeAsset:address,assetKind:{type:"string",enum:["quote","meme"]},beneficiaryType:{type:"string",enum:["0","1"]},beneficiary:address,beneficiaryEpoch:uintString,unpaidAmount:uintString,observedClaimedAmount:uintString,observedClaimCount:uintString,firstClaimEventKey:nullable({type:"string"}),observedAtTimestamp:uintString,historyComplete:{type:"boolean",const:false},publicationEligible:{type:"boolean",const:false}});
const rewardSource = object({observedClaimHistoryVerified:{type:"boolean",const:true},replayedInputCount:uintString,chainId:{type:"integer",enum:[4663,46630,421614]},blockNumber:uintString,blockHash:bytes32,revision:{type:"string"},finality:{type:"string",const:"finalized"},historyComplete:{type:"boolean",const:false},publicationEligible:{type:"boolean",const:false}});
const rewardError = object({error:{type:"string"},message:{type:"string"}});
const displayDecimal = {type:"string",pattern:"^(0|[1-9][0-9]{0,119})(\\.[0-9]{1,36})?$"};
const displayTime = {type:"string",format:"date-time"};
const displayReference = object({chainId:{type:"integer",enum:[4663,46630,421614]},token:address,assetUid:bytes32,symbol:{type:"string",pattern:"^[A-Z][A-Z0-9.\\-]{0,15}$"},source:{type:"string",enum:["robinhood_rest","coinbase_spot","testnet_pool_spot"]},unit:{type:"string",const:"USD_PER_WHOLE_TOKEN"},status:{type:"string",enum:["available","stale","unavailable"]},reason:{type:"string"},bidUsd:nullable(displayDecimal),askUsd:nullable(displayDecimal),multiplier:nullable(displayDecimal),asOf:nullable(displayTime),expiresAt:nullable(displayTime),retrievedAt:displayTime},["chainId","token","assetUid","symbol","source","unit","status","bidUsd","askUsd","multiplier","asOf","expiresAt","retrievedAt"]);
displayReference.allOf=[{if:{properties:{status:{const:"available"}}},then:{properties:{bidUsd:displayDecimal,askUsd:displayDecimal,multiplier:displayDecimal,asOf:displayTime,expiresAt:displayTime}},else:{properties:{bidUsd:{type:"null"},askUsd:{type:"null"}}}}];
const spec = {
  openapi: "3.1.0",
  info: { title: "TickerGarden V1 Read API", version: "5.2.0", description: "Non-custodial TypeScript Serverless read API for the routes consumed by the current frontend." },
  "x-execution-spec-id": "V1-EXEC-11",
  paths: {
    "/v1/users/{address}/activity":{get:{operationId:"listUserActivity",description:"Finalized address-referenced protocol events, newest first, from the configured indexing start. All canonical batches and stored receipt commitments must be complete. Roles are event references, not verified transaction initiators or trading volume. A changed history returns 409; restart pagination. No transaction submission.",parameters:[{name:"address",in:"path",required:true,schema:address},{name:"limit",in:"query",schema:{type:"integer",minimum:1,maximum:100,default:50}},{name:"cursor",in:"query",schema:{type:"string",minLength:1,maxLength:1024}}],responses:{"200":response(ref("UserActivityPage")),"400":response(ref("ActivityError")),"405":response(ref("ActivityError")),"409":response(ref("ActivityError")),"503":response(ref("ActivityError"))}}},
    "/v1/transactions/{txHash}":{get:{operationId:"getTransactionStatus",description:"Read-only transaction observations. Distinguishes unknown, pending, confirmed, finalized and reorged; execution success/revert is separate. Confirms against a bracketed RPC head with journal provenance and retained orphan history. Unknown does not prove non-submission. Conflicting, stale or missing observations return 503. No signing or transaction submission.",parameters:[{name:"txHash",in:"path",required:true,schema:bytes32}],responses:{"200":response(ref("TransactionStatusResponse")),"400":response(ref("TransactionError")),"405":response(ref("TransactionError")),"503":response(ref("TransactionError"))}}},
    "/v1/stats/holders":{get:{operationId:"getGlobalHolderCounts",description:"TypeScript backend. Incremental exact global and per-STOCK positive-address counts at a finalized shared coverage anchor. Adjusted counts exclude the union of known protocol addresses. Counts are addresses, not people or reward eligibility. Missing coverage returns 503.",responses:{"200":response(ref("GlobalHolderCountsResponse")),"400":response(ref("CandleError")),"405":response(ref("CandleError")),"503":response(ref("CandleError"))}}},
    "/v1/stats/series":{get:{operationId:"getGlobalFlowSeries",description:"Go backend. Verified execution flows grouped by STOCK/Quote in aligned [from,to) buckets. Empty buckets retain zero-flow groups; no synthetic trades, prices, balances or historical market counts. Maximum 2000 buckets and 100000 market-bucket cells, in addition to complete-history reader budgets. Incomplete/oversized history returns 503.",parameters:[{name:"interval",in:"query",required:true,schema:{type:"string",enum:["1m","5m","15m","1h","4h","1d"]}},{name:"from",in:"query",required:true,schema:uintString},{name:"to",in:"query",required:true,schema:uintString}],responses:{"200":response(ref("GlobalFlowSeriesResponse")),"400":response(ref("CandleError")),"405":response(ref("CandleError")),"503":response(ref("CandleError"))}}},
    "/v1/stats/overview":{get:{operationId:"getGlobalStatistics",description:"Go backend. Market and registered STOCK counts at the projection checkpoint (including retired registrations), execution flows within [from,to). Groups remain separated by STOCK and Quote; zero assetUid with binding=unbound explicitly means no STOCK binding. No implicit USD, reserve or holder total. One verified snapshot; maximum 1000 markets, 1000 registrations and 100000 executions, 10000 per market; incomplete or oversized history returns 503.",parameters:[{name:"from",in:"query",required:true,schema:uintString},{name:"to",in:"query",required:true,schema:uintString}],responses:{"200":response(ref("GlobalStatisticsResponse")),"400":response(ref("CandleError")),"405":response(ref("CandleError")),"503":response(ref("CandleError"))}}},
    "/v1/markets/{marketId}/holders":{get:{operationId:"listMarketHolders",description:"Go backend. Complete Meme Token Transfer replay from creation through the finalized projection checkpoint. Balances in ascending address order, including excluded protocol accounts with explicit flags. Counts are addresses, not users or reward eligibility. Keep limit unchanged; on 409 discard prior pages and restart. Each page currently rereads bounded complete history (at most one million blocks and 100000 receipts/logs, 64MiB range payload budget, 10-second deadline); incomplete or oversized history returns 503.",parameters:[{name:"marketId",in:"path",required:true,schema:bytes32},{name:"limit",in:"query",required:false,schema:{type:"integer",minimum:1,maximum:100,default:50}},{name:"cursor",in:"query",required:false,schema:{type:"string",minLength:1,maxLength:2048}}],responses:{"200":response(ref("MarketHoldersResponse")),"400":response(ref("HolderError")),"405":response(ref("HolderError")),"409":response(ref("HolderError")),"503":response(ref("HolderError"))}}},
    "/v1/holder-snapshots":{get:{operationId:"getHolderSnapshots",description:"Display-only finalized Holder wallet snapshot entitlements and Merkle proofs. Proof datasets are integrity-checked against their committed root and data hash. The opaque cursor is bound to the publication revision; a changed revision returns 409 and pagination must restart. Missing, incomplete, or corrupt proof data returns 503. This endpoint is cache disabled and never submits transactions.",parameters:[{name:"chainId",in:"query",required:true,schema:{type:"integer",enum:[4663,46630,421614]}},{name:"distributor",in:"query",required:true,schema:address},{name:"marketId",in:"query",required:true,schema:bytes32},{name:"account",in:"query",required:true,schema:address},{name:"cursor",in:"query",required:false,schema:{type:"string",minLength:1,maxLength:2048}}],responses:{"200":response(ref("HolderSnapshotPage")),"400":response(ref("HolderSnapshotError")),"405":response(ref("HolderSnapshotError")),"409":response(ref("HolderSnapshotError")),"503":response(ref("HolderSnapshotError"))}}},
    "/v1/markets/{marketId}/trades":{get:{operationId:"listMarketTrades",description:"Go backend. Newest-first canonical executions with explicit amount basis and caller identity confidence. Conversion summaries do not create extra executions. Keep market/from/to/limit unchanged across pages. HTTP 409 requires discarding previous pages and restarting without cursor. Currently revalidates the complete bounded interval per page (10000 executions maximum; database-side full-history coverage verification is subject to the request timeout).",parameters:[{name:"marketId",in:"path",required:true,schema:bytes32},{name:"from",in:"query",required:true,schema:uintString},{name:"to",in:"query",required:true,schema:uintString},{name:"limit",in:"query",required:false,schema:{type:"integer",minimum:1,maximum:100,default:50}},{name:"cursor",in:"query",required:false,schema:{type:"string",minLength:1,maxLength:2048}}],responses:{"200":response(ref("MarketTradesResponse")),"400":response(ref("TradeError")),"405":response(ref("TradeError")),"409":response(ref("TradeError")),"503":response(ref("TradeError"))}}},
    "/v1/markets/{marketId}/detail":{get:{operationId:"getTokenDetail",description:"Display-only approved token detail analytics. Prefers cached scheduled Dune results and falls back per section to finalized indexer coverage. Null means unavailable, never zero. Amounts are decimal strings; price and cap are Quote denominated. Protocol-balance exclusions define circulating supply. No execution or settlement authority.",parameters:[{name:"marketId",in:"path",required:true,schema:bytes32},{name:"period",in:"query",required:false,schema:{type:"string",enum:["1H","12H","1D"]}},{name:"section",in:"query",required:false,schema:{type:"string",enum:["activity"]},description:"Only finalized recent trades and fee totals; skips chart, volume and holders. Omit for full summary."}],responses:{"200":response(ref("TokenDetailResponse")),"400":response(ref("CandleError")),"405":response(ref("CandleError")),"503":response(ref("CandleError"))}}},
    "/v1/markets/{marketId}/candles":{get:{operationId:"getMarketCandles",description:"Go backend display-only canonical executions, including separately reported internal conversions. Aligned half-open Unix-second range; no synthetic trades or carry-forward prices. Missing coverage or configuration returns 503. At most 2000 buckets and 10000 trades. Database-side full-history coverage verification is subject to the request timeout. Independent coverage checkpoint, not a published snapshot revision.",parameters:[{name:"marketId",in:"path",required:true,schema:bytes32},{name:"interval",in:"query",required:true,schema:{type:"string",enum:["1m","5m","15m","1h","4h","1d"]}},{name:"from",in:"query",required:true,schema:uintString},{name:"to",in:"query",required:true,schema:uintString}],responses:{"200":response(ref("MarketCandlesResponse")),"400":response(ref("CandleError")),"405":response(ref("CandleError")),"503":response(ref("CandleError"))}}},
    "/v1/updates":{get:{operationId:"getSnapshotUpdates",description:"Go backend. Compare published finalized snapshots. Refetch invalidated endpoint families pinned to sync.revision, clearing their old cursors. Reset requires all four families to be reloaded. An unavailable response must not advance the client revision. Prices, rewards and treasury use independent freshness mechanisms.",parameters:[{name:"since",in:"query",required:false,schema:{type:"string",pattern:"^(0|[1-9][0-9]*):0x[0-9a-f]{64}$"}}],responses:{"200":response(ref("SnapshotUpdatesResponse")),"400":response(ref("SnapshotUpdatesError")),"405":response(ref("SnapshotUpdatesError")),"503":response(ref("SnapshotUpdatesError"))}}},
    "/v1/prices/references":{get:{operationId:"listDisplayPriceReferences",description:"Cached display estimates only, never an execution price or creation authorization. Testnet stock references may use a verified on-chain pool spot combined with native USD. No query parameters. Stale/unavailable prices are null.",responses:{"200":response(ref("DisplayPriceResponse")),"400":response(ref("DisplayPriceError"),"Query parameters unsupported"),"405":response(ref("DisplayPriceError"),"Read only")}}},
    "/health": { get: { operationId: "getHealth", responses: { "200": response(ref("HealthResponse")), ...errors } } },
    "/v1/market-statistics": {get:{operationId:"getMarketStatistics",description:"Display-only statistics for 1 to 100 explicit market IDs. Enumerate markets with the paginated market list; unbounded requests are rejected. Never performs RPC in the request. Unknown historical buys remain null.",parameters:[{name:"markets",in:"query",required:true,schema:{type:"string",maxLength:6699}}],responses:{"200":response(ref("MarketStatisticsResponse")),"400":{description:"Invalid market list"},"405":{description:"Read only"}}}},
    "/v1/markets": { get: { operationId: "listMarkets", parameters: [recentParameter,{ name: "assetUid", in: "query", required: false, schema: bytes32 },
      { name: "marketId", in: "query", required: false, schema: bytes32 },
      { name: "memeToken", in: "query", required: false, schema: address },
      { name: "launchPhase", in: "query", required: false, schema: { type: "integer", enum: [0, 1] } },
      { name:"search",in:"query",required:false,schema:{type:"string",minLength:1,maxLength:128},description:"Market name substring or complete canonical Meme Token contract address only. Name matching is ASCII case-insensitive with other Unicode exact. Symbol, marketId and assetUid are outside the V1 search contract." },
      { name:"createdFrom",in:"query",required:false,schema:uintString,description:"Inclusive Unix seconds, max signed bigint." },
      { name:"createdTo",in:"query",required:false,schema:uintString,description:"Inclusive Unix seconds, max signed bigint." },
      { name: "sort", in: "query", required: false, schema: { type: "string", enum: ["marketId_asc", "marketId_desc", "createdAt_asc", "createdAt_desc", "name_asc", "launchPhase_asc", "volume24hUsd_desc", "marketCapUsd_desc", "recentBuy_desc"] }, description: "ID, deployment-time, name, lifecycle-phase, 24-hour USD volume or USD market-cap order, with ascending marketId as tie-breaker. Market cap uses a shared 20-minute snapshot, missing valuations last; its cursor pins ranking for up to two hours. Recent buys lists projects with eligible finalized buys using event-updated positions, not historical scans. Ranked pages return current finalized details; revision pins only other sorts. Filters apply before pagination; cursors bind deployment, filters and ranking mode." }, ...queryParameters], responses: { "200": response(ref("MarketPage")), "503": response(ref("ApiErrorResponse"), "Market identity or ranking metrics unavailable"), ...errors } } },
    "/v1/markets/{marketId}": { get: { operationId: "getMarket", parameters: [recentParameter,{ name: "marketId", in: "path", required: true, schema: bytes32 }, revisionParameter], responses: { "200": response(ref("MarketDetailResponse")), "404": response(ref("ApiErrorResponse"), "Market not found"), ...errors } } },
    "/v1/config/{kind}": { get: { operationId: "listConfig", parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["asset", "quote", "baseline", "template"] } }, ...queryParameters], responses: { "200": response(ref("ConfigPage")), ...errors } } },
    "/v1/users/{address}/accounts": { get: { operationId: "listUserAccounts", description: "Vault principal once per wallet and asset, including accounts without market positions. Old snapshots without account coverage return 503.", parameters: [{ name: "address", in: "path", required: true, schema: address }, ...queryParameters], responses: { "200": response(ref("AccountPage")), "503": response(ref("ApiErrorResponse")), ...errors } } },
    "/v1/users/{address}/positions": { get: { operationId: "listUserPositions", parameters: [{ name: "address", in: "path", required: true, schema: address }, ...queryParameters], responses: { "200": response(ref("PositionPage")), ...errors } } },
  },
  components: { schemas: {
    AssetHolderCounts:object({assetUid:bytes32,binding:{type:"string",enum:["registered_stock","unbound"]},marketCount:{type:"integer",minimum:0},positiveMarketAddressPairs:{type:"integer",minimum:0},positiveAddressCount:{type:"integer",minimum:0},includedAddressCount:{type:"integer",minimum:0}}),
    UserActivityRecord:object({id:{type:"string",minLength:1,maxLength:256},chainId:{type:"integer",enum:[4663,46630,421614]},account:address,roles:{type:"array",minItems:1,maxItems:3,uniqueItems:true,items:{type:"string",minLength:1,maxLength:64}},identityBasis:{type:"string",const:"event_address_reference_not_verified_initiator"},module:{type:"string",minLength:1,maxLength:128},signature:{type:"string",minLength:1,maxLength:1024},emitter:address,blockNumber:uintString,blockHash:bytes32,transactionHash:bytes32,transactionIndex:uintString,logIndex:uintString,arguments:{type:"object",maxProperties:32,additionalProperties:{oneOf:[{type:"string",maxLength:1024},{type:"boolean"}]}}}),
    UserActivityPage:object({chainId:{type:"integer",enum:[4663,46630,421614]},account:address,items:{type:"array",maxItems:100,items:ref("UserActivityRecord")},nextCursor:nullable({type:"string",minLength:1,maxLength:1024}),indexedFrom:uintString,sourceBlockNumber:uintString,sourceBlockHash:bytes32,revision:{type:"string",pattern:"^sha256:[0-9a-f]{64}$"},finality:{type:"string",const:"finalized"},observedAt:{type:"string",format:"date-time"},displayOnly:{type:"boolean",const:true}}),
    ActivityError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","activity_unavailable","activity_page_changed","analytics_unavailable"]},message:{type:"string"},requestId:{type:"string"}}),
    TransactionReceiptStatus:object({blockNumber:uintString,blockHash:bytes32,transactionIndex:uintString,execution:{type:"string",enum:["succeeded","reverted"]}}),
    TransactionStatusResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},transactionHash:bytes32,state:{type:"string",enum:["unknown","pending","confirmed","finalized","reorged"]},confirmations:uintString,receipt:nullable(ref("TransactionReceiptStatus")),orphanedReceipts:{type:"array",maxItems:128,items:ref("TransactionReceiptStatus")},headNumber:uintString,headHash:bytes32,finalizedNumber:uintString,finalizedHash:bytes32,source:{type:"string",const:"indexed_journal_and_rpc"},indexedFrom:uintString,journalHeadNumber:uintString,journalHeadHash:bytes32,journalObservedAt:{type:"string",format:"date-time"},rpcObservedAt:{type:"string",format:"date-time"},displayOnly:{type:"boolean",const:true}}),
    HolderSnapshotRound:object({round:uintString,snapshotBlock:uintString,root:bytes32,quoteAmount:uintString,memeAmount:uintString,claimedAssets:{type:"integer",minimum:0,maximum:3},proof:{type:"array",maxItems:64,items:bytes32}}),
    HolderSnapshotPage:object({schema:{type:"string",const:"TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1"},chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},finality:{type:"string",const:"finalized"},distributor:address,marketId:bytes32,account:address,quote:address,meme:address,status:{type:"string",enum:["ready","awaiting_funding","awaiting_publication","publisher_unconfigured"]},sourceBlockNumber:uintString,sourceBlockHash:bytes32,rounds:{type:"array",maxItems:10,items:ref("HolderSnapshotRound")},nextCursor:nullable({type:"string",minLength:1,maxLength:2048})}),
    HolderSnapshotError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","snapshot_unavailable","snapshot_page_changed"]},message:{type:"string"},requestId:{type:"string"}}),
    TransactionError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","transaction_unavailable","analytics_unavailable"]},message:{type:"string"},requestId:{type:"string"}}),
    GlobalHolderCountsResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},finality:{type:"string",const:"finalized"},sourceBlockNumber:uintString,sourceBlockHash:bytes32,marketCount:{type:"integer",minimum:0,maximum:9007199254740991},positiveMarketAddressPairs:{type:"integer",minimum:0,maximum:9007199254740991},positiveAddressCount:{type:"integer",minimum:0},includedAddressCount:{type:"integer",minimum:0},exclusionPolicy:{type:"string",const:"UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1"},excludedAccounts:{type:"array",maxItems:1000000,items:address},groups:{type:"array",maxItems:1000,items:ref("AssetHolderCounts")}}),
    GlobalFlowSeriesResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},coverage:ref("CandleCoverage"),interval:{type:"integer",enum:[60,300,900,3600,14400,86400]},volumeBasis:{type:"string",const:"CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"},emptyPolicy:{type:"string",const:"ZERO_FLOW_NO_SYNTHETIC_EXECUTIONS"},points:{type:"array",maxItems:2000,items:ref("GlobalFlowPoint")}}),
    GlobalFlowPoint:object({timestamp:{type:"integer",minimum:0},groups:{type:"array",maxItems:1000,items:ref("GlobalFlowGroup")}}),
    StockIdentity:object({assetUid:bytes32,stockToken:address,stockDecimals:{type:"integer",minimum:0,maximum:18}}),
    GlobalStatisticsResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},coverage:ref("CandleCoverage"),marketCount:{type:"integer",minimum:0},registeredStockCount:{type:"integer",minimum:0},boundMarketCount:{type:"integer",minimum:0},unboundMarketCount:{type:"integer",minimum:0},stocks:{type:"array",maxItems:1000,items:ref("StockIdentity")},groups:{type:"array",maxItems:1000,items:ref("GlobalTradeGroup")}}),
    HolderBalance:object({account:address,balanceRaw:uintString,excluded:{type:"boolean"}}),
    MarketHoldersResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},marketId:bytes32,memeToken:address,creationBlockNumber:uintString,sourceBlockNumber:uintString,sourceBlockHash:bytes32,finality:{type:"string",const:"finalized"},exclusionPolicy:{type:"string",const:"KNOWN_PROTOCOL_ADDRESSES_V1"},totalSupplyRaw:uintString,positiveAddressCount:{type:"integer",minimum:0},includedAddressCount:{type:"integer",minimum:0},excludedAccounts:{type:"array",items:address},balances:{type:"array",maxItems:100,items:ref("HolderBalance")},revision:{type:"string",pattern:"^sha256:[0-9a-f]{64}$"},nextCursor:nullable({type:"string",minLength:1,maxLength:2048})}),
    HolderError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","analytics_unavailable","holder_page_changed"]},message:{type:"string"},requestId:{type:"string"}}),
    AssetFeeTotal:object({asset:address,decimals:{type:"integer",minimum:0,maximum:18},feeRaw:uintString,taxRaw:uintString}),
    AssetTradeStats:object({assetUid:bytes32,quoteAsset:address,quoteDecimals:{type:"integer",minimum:6,maximum:18},marketCount:{type:"integer",minimum:0},tradingMarketCount:{type:"integer",minimum:0},tradeCount:{type:"integer",minimum:0},internalTradeCount:{type:"integer",minimum:0},unclassifiedTradeCount:{type:"integer",minimum:0},quoteVolumeRaw:uintString,internalQuoteVolumeRaw:uintString,fees:{type:"array",items:ref("AssetFeeTotal")},unknownFeeTradeCount:{type:"integer",minimum:0},volumeBasis:{type:"string",const:"CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"}}),
    AssetStatisticsResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},assetUid:bytes32,stockToken:address,stockDecimals:{type:"integer",minimum:0,maximum:18},coverage:ref("CandleCoverage"),groups:{type:"array",maxItems:1000,items:ref("AssetTradeStats")}}),
    TradeSource:object({...source.properties,emitter:address,eventKey:{type:"string",pattern:"^[0-9]+:0x[0-9a-f]{64}:[0-9]+$"}}),
    TradeActivity:object({source:ref("TradeSource"),venue:{type:"string",enum:["curve","pool"]},marketId:bytes32,timestamp:uintString,side:{type:"string",enum:["buy","sell"]},classification:{type:"string",enum:["unclassified","internal_reward_conversion","internal_holder_conversion"]},actor:nullable(address),actorConfidence:{type:"string",enum:["contract_caller_not_verified_wallet","unavailable"]},recipient:nullable(address),memeAsset:address,quoteAsset:address,quoteDecimals:{type:"integer",minimum:6,maximum:18},memeRaw:uintString,quoteRaw:uintString,amountBasis:{type:"string",enum:["CURVE_EXCLUDING_FEE_TAX","POOL_CORE"]},price:ref("CandlePrice"),priceUnit:{type:"string",const:"QUOTE_PER_WHOLE_MEME"},feeRaw:nullable(uintString),feeAsset:nullable(address),taxRaw:nullable(uintString),feeStatus:{type:"string",enum:["event_reported","paired_event","not_provided"]}}),
    MarketTradesResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},marketId:bytes32,memeAsset:address,quoteAsset:address,quoteDecimals:{type:"integer",minimum:6,maximum:18},coverage:ref("CandleCoverage"),revision:{type:"string",pattern:"^sha256:[0-9a-f]{64}$"},items:{type:"array",maxItems:100,items:ref("TradeActivity")},nextCursor:nullable({type:"string",minLength:1,maxLength:2048})}),
    TradeError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","analytics_unavailable","trade_page_changed"]},message:{type:"string"},requestId:{type:"string"}}),
    CandlePrice:object({numerator:{type:"string",pattern:"^[1-9][0-9]*$"},denominator:{type:"string",pattern:"^[1-9][0-9]*$"}}),
    Candle:object({timestamp:{type:"integer",minimum:0},open:nullable(ref("CandlePrice")),high:nullable(ref("CandlePrice")),low:nullable(ref("CandlePrice")),close:nullable(ref("CandlePrice")),memeVolumeRaw:uintString,quoteVolumeRaw:uintString,internalMemeVolumeRaw:uintString,internalQuoteVolumeRaw:uintString,tradeCount:{type:"integer",minimum:0},internalTradeCount:{type:"integer",minimum:0},unclassifiedTradeCount:{type:"integer",minimum:0}}),
    CandleCoverage:object({from:{type:"integer",minimum:0},to:{type:"integer",minimum:0},anchorNumber:{type:"integer",minimum:0},anchorHash:bytes32,throughNumber:{type:"integer",minimum:0},throughHash:bytes32,projectionNumber:{type:"integer",minimum:0},projectionHash:bytes32}),
    CandleSeries:object({candles:{type:"array",maxItems:2000,items:ref("Candle")},priceUnit:{type:"string",const:"QUOTE_PER_WHOLE_MEME"},volumeBasis:{type:"string",const:"CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"},pricePopulation:{type:"string",const:"ALL_EXECUTIONS_INCLUDING_INTERNAL_CONVERSIONS"},emptyPolicy:{type:"string",const:"NULL_OHLC_ZERO_VOLUME"}}),
    TokenDetailSource:object({provider:{type:"string",enum:["dune","indexer"]},asOf:{type:"integer",minimum:1},blockNumber:uintString,blockHash:bytes32,queryId:{type:"string"},executionId:{type:"string"},cachedAt:{type:"integer",minimum:0}},["provider","asOf","blockNumber","blockHash"]),
    TokenDetailStatistics:object({price:nullable({type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]{1,36})?$"}),volume24h:nullable(usdDecimal),volumeFrom:{type:"integer",minimum:0},volumeTo:{type:"integer",minimum:0},volumeBasis:{type:"string",const:"EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE"}}),
    TokenDetailPoint:object({timestamp:{type:"integer",minimum:0},price:nullable({type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]{1,36})?$"})}),
    TokenDetailChart:object({from:{type:"integer",minimum:0},to:{type:"integer",minimum:0},interval:{type:"integer",enum:[60,300,900,3600,14400,86400]},points:{type:"array",maxItems:2000,items:ref("TokenDetailPoint")}}),
    TokenDetailTrade:object({timestamp:{type:"integer",minimum:0},side:{type:"string",enum:["buy","sell"]},price:{type:"string"},memeRaw:uintString,quoteRaw:uintString,actor:nullable(address),txHash:bytes32,eventKey:{type:"string"},classification:{type:"string",enum:["unclassified","internal_reward_conversion","internal_holder_conversion"]}}),
    TokenDetailHolder:object({account:address,balanceRaw:uintString}),
    TokenDetailHolders:object({totalSupplyRaw:uintString,circulatingSupplyRaw:uintString,count:{type:"integer",minimum:0},basis:{type:"string",const:"TOTAL_MINUS_KNOWN_PROTOCOL_BALANCES_V1"},items:{type:"array",maxItems:100,items:ref("TokenDetailHolder")}}),
    TokenDetailFee:object({recipient:{type:"string",enum:["creator","stakers","platform","holders"]},asset:address,amountRaw:uintString}),
    TokenDetailResponse:object({version:{type:"integer",const:1},chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},marketId:bytes32,memeToken:address,quoteAsset:address,quoteDecimals:{type:"integer",minimum:6,maximum:18},period:{type:"string",enum:["1H","12H","1D"]},statistics:nullable(ref("TokenDetailStatistics")),chart:nullable(ref("TokenDetailChart")),trades:nullable({type:"array",maxItems:100,items:ref("TokenDetailTrade")}),holders:nullable(ref("TokenDetailHolders")),fees:nullable({type:"array",maxItems:8,items:ref("TokenDetailFee")}),sources:{type:"object",additionalProperties:ref("TokenDetailSource")},reasons:{type:"object",additionalProperties:{type:"string"}}}),
    MarketCandlesResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},marketId:bytes32,memeAsset:address,quoteAsset:address,quoteDecimals:{type:"integer",minimum:6,maximum:18},interval:{type:"integer",enum:[60,300,900,3600,14400,86400]},coverage:ref("CandleCoverage"),series:ref("CandleSeries")}),
    CandleError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","analytics_unavailable"]},message:{type:"string"},requestId:{type:"string"}}),
    SnapshotUpdatesResponse:object({mode:{type:"string",enum:["unchanged","changed","reset"]},sync,invalidated:{type:"array",maxItems:4,uniqueItems:true,items:{type:"string",enum:["markets","configs","positions","accounts"]}},pollAfterMs:{type:"integer",const:5000},recentVersion:{type:"string",pattern:"^[0-9a-f]{32}$"}},["mode","sync","invalidated","pollAfterMs"]),
    SnapshotUpdatesError:object({error:{type:"string",enum:["invalid_query","method_not_allowed","snapshot_unavailable"]},message:{type:"string"},requestId:{type:"string"}}),
    DisplayPriceReference:displayReference,
    DisplayPriceResponse:object({chainId:{type:"integer",enum:[4663,46630,421614]},displayOnly:{type:"boolean",const:true},confidence:{type:"string",const:"provider_reported"},status:{type:"string",enum:["configured","not_configured"]},references:{type:"array",maxItems:64,items:ref("DisplayPriceReference")}}),
    DisplayPriceError:object({error:{type:"string",enum:["invalid_query","method_not_allowed"]},message:{type:"string"},requestId:{type:"string"}}),
    RewardValues:rewardValues, RewardSource:rewardSource, RewardError:rewardError,
    RewardObservation:object({kind:{type:"string",const:"rewardPosition"},key:{type:"string"},value:ref("RewardValues")}),
    RewardPage:object({items:{type:"array",items:ref("RewardObservation")},nextCursor:nullable({type:"string"}),source:ref("RewardSource")}),
    SourceBlock: source, SyncStatus: sync, PoolKeyReadModel: poolKey, CanonicalRoute: route, CurveProgress: curve,
    MarketStatisticsResponse: object({chainId:{type:"integer",minimum:1},registry:address,displayOnly:{type:"boolean",const:true},items:{type:"object",additionalProperties:object({marketId:bytes32,metrics:nullable(ref("MarketMetricsReadModel")),lastBuy:nullable(ref("LastBuyReadModel")),observedAt:{type:"integer",minimum:0},launchPhase:{type:"string",enum:["0","1"]}})}}),
    MarketReadModel: market, MarketIdentityReadModel: marketIdentity, LastBuyReadModel: lastBuy, MarketMetricsReadModel: marketMetrics, ConfigReadModel: config, QuoteClaimable: claimQuote, MemeClaimable: claimMeme,
    UserAccountReadModel: object({ user: address, assetUid: bytes32, vault: address, deposited: uintString, allocated: uintString, free: uintString, source: ref("SourceBlock") }),
    AccountPage: page("UserAccountReadModel"),
    UserPositionReadModel: position, MarketPage: page("MarketReadModel"), ConfigPage: page("ConfigReadModel"),
    PositionPage: page("UserPositionReadModel"), MarketDetailResponse: object({ market: ref("MarketReadModel"), sync: ref("SyncStatus") }),
    HealthResponse: object({
      executionSpecId: { type: "string", const: "V1-EXEC-11" }, status: { type: "string", const: "read-api" }, readApiImplemented: { type: "boolean", const: true },
      productRuntimeImplemented: { type: "boolean", const: true }, custody: { type: "boolean", const: false }, transactionSubmission: { type: "boolean", const: false }, sync: ref("SyncStatus"),
    }), ApiErrorResponse: error,
  } },
};

const directoryMarket = object({ marketId: bytes32, memeToken: address, name: { type: 'string' }, symbol: { type: 'string' } });
spec.components.schemas.CreatorMarket = object({ marketId: bytes32, memeToken: address, creator: address, creationBlockNumber: uintString });
spec.components.schemas.MarketPage.properties.ranking = object({mode:{type:'string',enum:['market-cap-snapshot','recent-buys']},version:{type:'string'},updatedAt:nullable({type:'string',format:'date-time'}),refreshSeconds:{type:'integer',minimum:1},stale:{type:'boolean'}});
spec.components.schemas.CreatorMarketPage = object({ chainId: { type: 'integer' }, address, displayOnly: { type: 'boolean', const: true }, complete: { type: 'boolean', const: true }, items: { type: 'array', items: ref('CreatorMarket') }, nextCursor: nullable({ type: 'string' }) });
spec.components.schemas.HolderMarketPage = object({ chainId: { type: 'integer' }, complete: { type: 'boolean', const: true }, items: { type: 'array', items: directoryMarket } });
spec.components.schemas.WalletHolderMarketPage = object({ chainId: { type: 'integer' }, account: address, displayOnly: { type: 'boolean', const: true }, complete: { type: 'boolean', const: true }, items: { type: 'array', items: directoryMarket } });
spec.components.schemas.RewardHistoryResponse = object({ chainId: { type: 'integer' }, displayOnly: { type: 'boolean', const: true }, marketId: bytes32, account: address, throughBlock: uintString, complete: { type: 'boolean' }, claimed: { type: 'object', additionalProperties: uintString } });
spec.components.schemas.LaunchRecoveryResponse = object({ chainId: { type: 'integer' }, displayOnly: { type: 'boolean', const: true }, marketId: bytes32, transactionHash: bytes32, blockNumber: uintString, blockHash: bytes32, finality: { type: 'string', const: 'finalized' } });
spec.paths['/v1/creator-markets'] = { get: { operationId: 'listCreatorMarkets', parameters: [{ name: 'address', in: 'query', required: true, schema: address }, { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } }, { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } }], responses: { '200': response(ref('CreatorMarketPage')), '400': response(ref('ActivityError')), '503': response(ref('ActivityError')) } } };
spec.paths['/v1/holder-markets'] = { get: { operationId: 'searchHolderMarkets', parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string', maxLength: 200 } }], responses: { '200': response(ref('HolderMarketPage')), '400': response(ref('ActivityError')), '503': response(ref('ActivityError')) } } };
spec.paths['/v1/wallet-holder-markets'] = { get: { operationId: 'listWalletHolderMarkets', parameters: [{ name: 'account', in: 'query', required: true, schema: address }], responses: { '200': response(ref('WalletHolderMarketPage')), '400': response(ref('ActivityError')), '503': response(ref('ActivityError')) } } };
for (const kind of ['holder', 'staker']) spec.paths[`/v1/${kind}-reward-history`] = { get: { operationId: `get${kind[0].toUpperCase()}${kind.slice(1)}RewardHistory`, parameters: [{ name: 'marketId', in: 'query', required: true, schema: bytes32 }, { name: 'account', in: 'query', required: true, schema: address }, { name: 'throughBlock', in: 'query', required: true, schema: uintString }], responses: { '200': response(ref('RewardHistoryResponse')), '400': response(ref('ActivityError')), '503': response(ref('ActivityError')) } } };
spec.components.schemas.MemeFeeBurnsResponse = object({chainId:{type:'integer',enum:[4663,46630]},displayOnly:{type:'boolean',const:true},finality:{type:'string',const:'finalized'},revision:{type:'string'},throughBlock:uintString,burns:object({marketId:bytes32,token:address,enabled:{type:'boolean'},creatorRaw:uintString,stakerRaw:uintString,holderRaw:uintString,totalRaw:uintString})});
spec.paths['/v1/meme-fee-burns'] = {get:{operationId:'getMemeFeeBurns',parameters:[{name:'marketId',in:'query',required:true,schema:bytes32}],responses:{'200':response(ref('MemeFeeBurnsResponse')),'400':response(ref('ActivityError')),'503':response(ref('ActivityError'))}}};
spec.paths['/v1/launch-recovery'] = { get: { operationId: 'getLaunchRecovery', parameters: [{ name: 'marketId', in: 'query', required: true, schema: bytes32 }], responses: { '200': response(ref('LaunchRecoveryResponse')), '400': response(ref('ActivityError')), '503': response(ref('ActivityError')) } } };

spec.components.schemas.GlobalTradeGroup=object({...spec.components.schemas.AssetTradeStats.properties,binding:{type:"string",enum:["registered_stock","unbound"]}});

const {marketCount: ignoredMarketCount, tradingMarketCount: ignoredTradingMarketCount, volumeBasis: ignoredVolumeBasis, ...flowFields}=spec.components.schemas.GlobalTradeGroup.properties;
spec.components.schemas.GlobalFlowGroup=object(flowFields);

const schemaToType = (schema) => {
  if (schema.$ref) return schema.$ref.split("/").at(-1);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.oneOf) return schema.oneOf.map(schemaToType).join(" | ");
  if (schema.type === "null") return "null";
  if (schema.type === "string") return schema.pattern?.startsWith("^0x") ? "`0x${string}`" : "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array") {
    if (schema.prefixItems) return `readonly [${schema.prefixItems.map(schemaToType).join(", ")}]`;
    const itemType = schemaToType(schema.items);
    return `readonly ${itemType.includes(" | ") ? `(${itemType})` : itemType}[]`;
  }
  if (schema.type === "object") {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties ?? {}).map(([name, child]) => `readonly ${name}${required.has(name) ? "" : "?"}: ${schemaToType(child)};`);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") fields.push(`readonly [key: string]: ${schemaToType(schema.additionalProperties)};`);
    return `{ ${fields.join(" ")} }`;
  }
  throw new Error(`unsupported OpenAPI schema node: ${JSON.stringify(schema)}`);
};

spec.components.schemas.TokenDetailResponse.properties.confirmation={type:'string',const:'confirmed'};
spec.paths['/v1/markets/{marketId}/detail'].get.description+=' New launches may return a confirmed creation-transaction seed from the database; confirmation marks this provisional scope. Subsequent history comes from the independent indexer.';
const typeLines = Object.entries(spec.components.schemas).map(([name, schema]) => `export type ${name} = ${schemaToType(schema)};`);
const operations = Object.entries(spec.paths).map(([routePath, pathItem]) => {
  const operation = pathItem.get;
  const parameters = operation.parameters ?? [];
  const parameterFields = parameters.map((parameter) => `readonly ${parameter.name}${parameter.required ? "" : "?"}: ${schemaToType(parameter.schema)};`).join(" ");
  const paramsType = `${operation.operationId[0].toUpperCase()}${operation.operationId.slice(1)}Params`;
  const responseSchema = operation.responses["200"].content["application/json"].schema.$ref.split("/").at(-1);
  typeLines.push(`export type ${paramsType} = { ${parameterFields} };`);
  const required = parameters.some((parameter) => parameter.required);
  const signature = parameters.length === 0 ? "" : `params: ${paramsType}${required ? "" : " = {}"}`;
  let urlExpression = `\`${routePath.replaceAll(/\{([^}]+)\}/g, "${encodeURIComponent(params.$1)}")}\``;
  const validations = parameters.map((parameter) => {
    const checks = [];
    if (parameter.schema.enum) checks.push(`!${JSON.stringify(parameter.schema.enum)}.includes(params.${parameter.name} as never)`);
    if (parameter.schema.type === "integer") checks.push(`!Number.isSafeInteger(params.${parameter.name})`);
    if (parameter.schema.pattern) checks.push(`!new RegExp(${JSON.stringify(parameter.schema.pattern)}).test(String(params.${parameter.name}))`);
    if (parameter.schema.minimum !== undefined) checks.push(`Number(params.${parameter.name}) < ${parameter.schema.minimum}`);
    if (parameter.schema.maximum !== undefined) checks.push(`Number(params.${parameter.name}) > ${parameter.schema.maximum}`);
    if (checks.length === 0) return "";
    const statement = `if (${checks.join(" || ")}) throw new TypeError("invalid ${parameter.name}");`;
    return parameter.required ? statement : `if (params.${parameter.name} !== undefined) { ${statement} }`;
  }).join(" ");
  const query = parameters.filter((parameter) => parameter.in === "query").map((parameter) =>
    `if (params.${parameter.name} !== undefined) url.searchParams.set("${parameter.name}", String(params.${parameter.name}));`,
  ).join(" ");
  return `  async ${operation.operationId}(${signature}): Promise<${responseSchema}> { ${validations} const url = new URL(${urlExpression}, this.baseUrl); ${query} return this.request<${responseSchema}>(url); }`;
});
const client = `// Generated from openapi/v1.json by scripts/generate-openapi.mjs. Do not edit.\n\n${typeLines.join("\n")}\n\nexport class TickerGardenApiError extends Error { readonly status: number; readonly body: ApiErrorResponse | RewardError | DisplayPriceError | SnapshotUpdatesError | HolderSnapshotError | CandleError | TradeError | HolderError | TransactionError | ActivityError; constructor(status: number, body: ApiErrorResponse | RewardError | DisplayPriceError | SnapshotUpdatesError | HolderSnapshotError | CandleError | TradeError | HolderError | TransactionError | ActivityError) { super(body.message); this.name = "TickerGardenApiError"; this.status = status; this.body = body; } }\n\nexport class TickerGardenV1Client { readonly baseUrl: string; readonly fetcher: typeof fetch; constructor(baseUrl: string, fetcher: typeof fetch = fetch) { this.baseUrl = baseUrl; this.fetcher = (input, init) => fetcher(input, init); } private async request<T>(url: URL): Promise<T> { const response = await this.fetcher(url, { method: "GET", headers: { accept: "application/json" } }); const body: unknown = await response.json(); if (!response.ok) throw new TickerGardenApiError(response.status, body as ApiErrorResponse | RewardError | DisplayPriceError | SnapshotUpdatesError | HolderSnapshotError | CandleError | TradeError | HolderError | TransactionError | ActivityError); return body as T; }\n${operations.join("\n")}\n}\n`;
for (const route of ["/v1/users/{address}/activity", "/v1/transactions/{txHash}", "/v1/markets/{marketId}/trades", "/v1/markets/{marketId}/holders", "/v1/markets/{marketId}/candles", "/v1/stats/overview", "/v1/stats/holders", "/v1/stats/series"]) {
  spec.paths[route].get.description += " These nine history/transaction observation routes share a limit of four active requests per API instance. Excess requests return 503 analytics_unavailable with Retry-After: 5, without queueing.";
}

for (const pathItem of Object.values(spec.paths)) {
  if (pathItem.get?.description) pathItem.get.description = pathItem.get.description.replaceAll('Go backend', 'TypeScript Serverless backend');
}
const authoritativeClient = client.replace(
  '// Generated from openapi/v1.json by scripts/generate-openapi.mjs. Do not edit.',
  '// Generated from the TypeScript Serverless OpenAPI contract. Do not edit.',
);

const specText = `${JSON.stringify(spec, null, 2)}\n`;
const fingerprint = `sha256:${createHash("sha256").update(specText).digest("hex")}`;
const nextLock = { schemaVersion: 1, openapiVersion: spec.info.version, executionSpecId: "V1-EXEC-11", fingerprint };
const lockText = `${JSON.stringify(nextLock, null, 2)}\n`;
const previousLock = await readFile(lockPath, "utf8").then(JSON.parse).catch(() => null);

if (process.argv.includes("--check")) {
  const [currentSpec, currentClient, currentLock] = await Promise.all([
    readFile(specPath, "utf8").catch(() => ""), readFile(clientPath, "utf8").catch(() => ""), readFile(lockPath, "utf8").catch(() => ""),
  ]);
  if (currentSpec !== specText || currentClient !== authoritativeClient || currentLock !== lockText) {
    throw new Error("generated OpenAPI, client, or version lock is stale");
  }
} else {
  if (previousLock) assertSchemaVersionTransition(previousLock.openapiVersion, spec.info.version, previousLock.fingerprint !== fingerprint);
  await Promise.all([mkdir(path.dirname(specPath), { recursive: true }), mkdir(path.dirname(clientPath), { recursive: true })]);
  await Promise.all([writeFile(specPath, specText), writeFile(clientPath, authoritativeClient), writeFile(lockPath, lockText)]);
}
