import { bigint, bigserial, boolean, check, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const databaseSchema = pgSchema('tickergarden_serverless');
const uint256 = (name: string) => numeric(name, { precision: 78, scale: 0 });
const decimal = (name: string) => numeric(name, { precision: 78, scale: 18 });

export const deployments = databaseSchema.table('deployments', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  genesisHash: text('genesis_hash').notNull(),
  startBlock: bigint('start_block', { mode: 'bigint' }).notNull(),
  startBlockHash: text('start_block_hash').notNull(),
  abiDigest: text('abi_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest] }),
  check('deployments_chain', sql`${table.chainId} in (4663,46630)`),
  check('deployments_start', sql`${table.startBlock} >= 0`),
]);

export const contractSources = databaseSchema.table('contract_sources', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  module: text('module').notNull(),
  address: text('address').notNull(),
  birthBlock: bigint('birth_block', { mode: 'bigint' }).notNull(),
  runtimeCodeHash: text('runtime_code_hash').notNull(),
  active: boolean('active').default(true).notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.address] }),
  index('contract_sources_module').on(table.environment, table.chainId, table.deploymentDigest, table.module),
]);

export const chainBlocks = databaseSchema.table('chain_blocks', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  number: bigint('number', { mode: 'bigint' }).notNull(),
  hash: text('hash').notNull(),
  parentHash: text('parent_hash').notNull(),
  canonical: boolean('canonical').default(true).notNull(),
  finalized: boolean('finalized').default(false).notNull(),
  sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }),
  observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.hash] }),
  uniqueIndex('chain_blocks_canonical_height').on(table.environment, table.chainId, table.deploymentDigest, table.number).where(sql`${table.canonical}`),
]);

export const chainLogs = databaseSchema.table('chain_logs', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  blockHash: text('block_hash').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  transactionIndex: bigint('transaction_index', { mode: 'number' }).notNull(),
  logIndex: bigint('log_index', { mode: 'number' }).notNull(),
  address: text('address').notNull(),
  topic0: text('topic0'),
  payload: jsonb('payload').notNull(),
  canonical: boolean('canonical').default(true).notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.blockHash, table.transactionHash, table.logIndex] }),
  index('chain_logs_address').on(table.environment, table.chainId, table.deploymentDigest, table.address),
]);

export const coveredRanges = databaseSchema.table('covered_ranges', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  fromBlock: bigint('from_block', { mode: 'bigint' }).notNull(),
  toBlock: bigint('to_block', { mode: 'bigint' }).notNull(),
  generation: bigint('generation', { mode: 'bigint' }).default(0n).notNull(),
  filterDigest: text('filter_digest').notNull(),
  complete: boolean('complete').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex('covered_ranges_identity').on(table.environment, table.chainId, table.deploymentDigest, table.fromBlock, table.toBlock, table.generation),
  check('covered_ranges_order', sql`${table.toBlock} >= ${table.fromBlock}`),
]);

export const ingestionCheckpoints = databaseSchema.table('ingestion_checkpoints', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  stream: text('stream').notNull(), nextBlock: bigint('next_block', { mode: 'bigint' }).notNull(), lastBlockHash: text('last_block_hash'),
  generation: bigint('generation', { mode: 'bigint' }).default(0n).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.stream] })]);

export const webhookConfigs = databaseSchema.table('webhook_configs', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  provider: text('provider').notNull(), webhookId: text('webhook_id').notNull(), network: text('network').notNull(), queryDigest: text('query_digest').notNull(),
  query: text('query').notNull(), status: text('status').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.provider, table.webhookId] })]);

export const sourceConflicts = databaseSchema.table('source_conflicts', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(), environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(), blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(), primaryHash: text('primary_hash').notNull(),
  secondaryHash: text('secondary_hash').notNull(), detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(), resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [index('source_conflicts_open').on(table.environment, table.chainId, table.deploymentDigest, table.detectedAt).where(sql`${table.resolvedAt} is null`)]);

export const publications = databaseSchema.table('publications', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  scope: text('scope').notNull(),
  revision: text('revision').notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  blockHash: text('block_hash').notNull(),
  generation: bigint('generation', { mode: 'bigint' }).notNull(),
  payloadDigest: text('payload_digest').notNull(),
  payload: jsonb('payload').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.scope, table.revision] }),
  uniqueIndex('publications_one_revision').on(table.environment, table.chainId, table.deploymentDigest, table.revision, table.scope),
]);

export const publicationPointers = databaseSchema.table('publication_pointers', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  scope: text('scope').notNull(),
  revision: text('revision').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.scope] })]);

export const projectionRecords = databaseSchema.table('projection_records', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  scope: text('scope').notNull(), revision: text('revision').notNull(), identity: text('identity').notNull(), sortKey: text('sort_key').notNull(),
  payloadDigest: text('payload_digest').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.scope, table.revision, table.identity] }),
  index('projection_records_page').on(table.environment, table.chainId, table.deploymentDigest, table.scope, table.revision, table.sortKey, table.identity),
]);

export const projectionCheckpoints = databaseSchema.table('projection_checkpoints', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  scope: text('scope').notNull(), algorithmVersion: text('algorithm_version').notNull(), nextBlock: bigint('next_block', { mode: 'bigint' }).notNull(),
  generation: bigint('generation', { mode: 'bigint' }).notNull(), lastRevision: text('last_revision'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.scope] })]);

export const markets = databaseSchema.table('markets', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  marketId: text('market_id').notNull(),
  assetUid: text('asset_uid').notNull(),
  memeToken: text('meme_token').notNull(),
  quoteAsset: text('quote_asset').notNull(),
  curve: text('curve').notNull(),
  gauge: text('gauge').notNull(),
  creator: text('creator').notNull(),
  creationBlock: bigint('creation_block', { mode: 'bigint' }).notNull(),
  metadataUri: text('metadata_uri').notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.marketId] }),
  uniqueIndex('markets_meme_token').on(table.environment, table.chainId, table.deploymentDigest, table.memeToken),
  index('markets_creator').on(table.environment, table.chainId, table.deploymentDigest, table.creator, table.marketId),
]);

export const accountFacts = databaseSchema.table('account_facts', {
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  account: text('account').notNull(),
  marketId: text('market_id').notNull(),
  assetUid: text('asset_uid').notNull(),
  freeRaw: uint256('free_raw').notNull(),
  allocatedRaw: uint256('allocated_raw').notNull(),
  pendingRaw: uint256('pending_raw').notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.account, table.marketId, table.assetUid] }),
  index('account_facts_wallet').on(table.environment, table.chainId, table.deploymentDigest, table.account),
]);

export const displayRecords = databaseSchema.table('display_records', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  environment: text('environment').notNull(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(),
  scope: text('scope').notNull(),
  identity: text('identity').notNull(),
  blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
  blockHash: text('block_hash').notNull(),
  payload: jsonb('payload').notNull(),
}, (table) => [
  uniqueIndex('display_records_identity').on(table.environment, table.chainId, table.deploymentDigest, table.scope, table.identity),
  index('display_records_scope').on(table.environment, table.chainId, table.deploymentDigest, table.scope, table.id),
]);

export const contentObjects = databaseSchema.table('content_objects', {
  digest: text('digest').primaryKey(),
  owner: text('owner').notNull(),
  mediaType: text('media_type').notNull(),
  byteLength: integer('byte_length').notNull(),
  objectVersion: text('object_version').notNull(),
  cid: text('cid'),
  status: text('status').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [check('content_objects_size', sql`${table.byteLength} > 0 and ${table.byteLength} <= 3145728`)]);

export const contentChallenges = databaseSchema.table('content_challenges', {
  nonce: text('nonce').primaryKey(),
  account: text('account').notNull(),
  contentDigest: text('content_digest').notNull(),
  origin: text('origin').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('content_challenges_account').on(table.account, table.createdAt),
]);

export const contentUploads = databaseSchema.table('content_uploads', {
  uploadId: uuid('upload_id').primaryKey(),
  operationDigest: text('operation_digest').notNull().unique(),
  owner: text('owner').notNull(),
  origin: text('origin').notNull(),
  contentDigest: text('content_digest').notNull(),
  accessTokenDigest: text('access_token_digest').notNull(),
  imageDigest: text('image_digest'),
  imageMediaType: text('image_media_type'),
  imageByteLength: integer('image_byte_length'),
  imageObjectKey: text('image_object_key'),
  imageObjectVersion: text('image_object_version'),
  metadataDigest: text('metadata_digest'),
  metadataCid: text('metadata_cid'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('content_uploads_owner').on(table.owner, table.createdAt),
]);

export const configRecords = databaseSchema.table('config_records', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(), kind: text('kind').notNull(), configId: text('config_id').notNull(),
  status: bigint('status', { mode: 'bigint' }).notNull(), blockHash: text('block_hash').notNull(), values: jsonb('values').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.kind, table.configId] }),
  index('config_records_page').on(table.environment, table.chainId, table.deploymentDigest, table.kind, table.configId),
]);

export const marketTrades = databaseSchema.table('market_trades', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(), marketId: text('market_id').notNull(), blockHash: text('block_hash').notNull(),
  transactionHash: text('transaction_hash').notNull(), logIndex: bigint('log_index', { mode: 'bigint' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(), classification: text('classification').notNull(),
  baseRaw: uint256('base_raw').notNull(), quoteRaw: uint256('quote_raw').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.blockHash, table.transactionHash, table.logIndex] }),
  index('market_trades_page').on(table.environment, table.chainId, table.deploymentDigest, table.marketId, table.occurredAt, table.transactionHash, table.logIndex),
]);

export const marketCandles = databaseSchema.table('market_candles', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  marketId: text('market_id').notNull(), interval: text('interval').notNull(), startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  open: decimal('open').notNull(), high: decimal('high').notNull(), low: decimal('low').notNull(), close: decimal('close').notNull(),
  volumeRaw: uint256('volume_raw').notNull(), tradeCount: bigint('trade_count', { mode: 'bigint' }).notNull(), complete: boolean('complete').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.marketId, table.interval, table.startsAt] })]);

export const holderBalances = databaseSchema.table('holder_balances', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  marketId: text('market_id').notNull(), account: text('account').notNull(), balanceRaw: uint256('balance_raw').notNull(), excluded: boolean('excluded').default(false).notNull(),
  blockHash: text('block_hash').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.marketId, table.account] }),
  index('holder_balances_page').on(table.environment, table.chainId, table.deploymentDigest, table.marketId, table.excluded, table.balanceRaw, table.account),
]);

export const holderSnapshots = databaseSchema.table('holder_snapshots', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  marketId: text('market_id').notNull(), creationBlock: bigint('creation_block', { mode: 'bigint' }).notNull(), totalSupplyRaw: uint256('total_supply_raw').notNull(),
  positiveAddressCount: bigint('positive_address_count', { mode: 'bigint' }).notNull(), includedAddressCount: bigint('included_address_count', { mode: 'bigint' }).notNull(),
  excludedAccounts: jsonb('excluded_accounts').notNull(), blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(), blockHash: text('block_hash').notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.marketId] })]);

export const detailFeeTotals = databaseSchema.table('detail_fee_totals', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  marketId: text('market_id').notNull(), recipient: text('recipient').notNull(), asset: text('asset').notNull(), amountRaw: uint256('amount_raw').notNull(), blockHash: text('block_hash').notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.marketId, table.recipient, table.asset] })]);

export const detailFeeEvents = databaseSchema.table('detail_fee_events', {
  environment:text('environment').notNull(),chainId:bigint('chain_id',{mode:'number'}).notNull(),deploymentDigest:text('deployment_digest').notNull(),marketId:text('market_id').notNull(),recipient:text('recipient').notNull(),asset:text('asset').notNull(),amountRaw:uint256('amount_raw').notNull(),blockHash:text('block_hash').notNull(),transactionHash:text('transaction_hash').notNull(),logIndex:bigint('log_index',{mode:'bigint'}).notNull(),
},table=>[primaryKey({columns:[table.environment,table.chainId,table.deploymentDigest,table.blockHash,table.transactionHash,table.logIndex,table.recipient,table.asset]}),index('detail_fee_events_window').on(table.environment,table.chainId,table.deploymentDigest,table.marketId,table.blockHash)]);

export const userActivity = databaseSchema.table('user_activity', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  account: text('account').notNull(), blockHash: text('block_hash').notNull(), transactionHash: text('transaction_hash').notNull(),
  logIndex: bigint('log_index', { mode: 'bigint' }).notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  displayOnly: boolean('display_only').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.account, table.blockHash, table.transactionHash, table.logIndex] }),
  index('user_activity_page').on(table.environment, table.chainId, table.deploymentDigest, table.account, table.occurredAt, table.transactionHash, table.logIndex),
]);

export const transactionReceipts = databaseSchema.table('transaction_receipts', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  transactionHash: text('transaction_hash').notNull(), blockHash: text('block_hash').notNull(), canonical: boolean('canonical').notNull(),
  finalized: boolean('finalized').notNull(), status: text('status').notNull(), observedAt: timestamp('observed_at', { withTimezone: true }).notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.transactionHash, table.blockHash] }),
  index('transaction_receipts_lookup').on(table.environment, table.chainId, table.deploymentDigest, table.transactionHash, table.canonical, table.observedAt),
]);

export const aggregateRecords = databaseSchema.table('aggregate_records', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  scope: text('scope').notNull(), identity: text('identity').notNull(), windowFrom: timestamp('window_from', { withTimezone: true }), windowTo: timestamp('window_to', { withTimezone: true }),
  blockHash: text('block_hash').notNull(), complete: boolean('complete').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.scope, table.identity] }),
  index('aggregate_records_scope').on(table.environment, table.chainId, table.deploymentDigest, table.scope, table.windowFrom, table.identity),
]);

export const priceReferences = databaseSchema.table('price_references', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(),
  asset: text('asset').notNull(), source: text('source').notNull(), status: text('status').notNull(), value: decimal('value'),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.asset, table.source, table.asOf] }),
  index('price_references_current').on(table.environment, table.chainId, table.deploymentDigest, table.asset, table.expiresAt),
]);

export const rewardHistory = databaseSchema.table('reward_history', {
  environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(), deploymentDigest: text('deployment_digest').notNull(), kind: text('kind').notNull(),
  marketId: text('market_id').notNull(), account: text('account').notNull(), asset: text('asset').notNull(), transactionHash: text('transaction_hash').notNull(),
  logIndex: bigint('log_index', { mode: 'bigint' }).notNull(), throughBlock: bigint('through_block', { mode: 'bigint' }).notNull(), amountRaw: uint256('amount_raw').notNull(),
  displayOnly: boolean('display_only').notNull(), payload: jsonb('payload').notNull(),
}, (table) => [
  primaryKey({ columns: [table.environment, table.chainId, table.deploymentDigest, table.kind, table.marketId, table.account, table.asset, table.transactionHash, table.logIndex] }),
  index('reward_history_page').on(table.environment, table.chainId, table.deploymentDigest, table.kind, table.marketId, table.account, table.throughBlock, table.transactionHash, table.logIndex),
]);

export const invalidations = databaseSchema.table('invalidations', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(), environment: text('environment').notNull(), chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  deploymentDigest: text('deployment_digest').notNull(), scope: text('scope').notNull(), identity: text('identity').notNull(), revision: text('revision').notNull(),
  reason: text('reason').notNull(), invalidatedAt: timestamp('invalidated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('invalidations_since').on(table.environment, table.chainId, table.deploymentDigest, table.id)]);

export const inboxMessages = databaseSchema.table('inbox_messages', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(), queue: text('queue').notNull(), externalId: text('external_id').notNull(),
  payloadDigest: text('payload_digest').notNull(), rawBody: text('raw_body').notNull(), state: text('state').default('pending').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(), processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('inbox_messages_identity').on(table.queue, table.externalId),
  index('inbox_messages_pending').on(table.queue, table.state, table.id).where(sql`${table.state} = 'pending'`),
]);

export const jobs = databaseSchema.table('jobs', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(), operationId: text('operation_id').notNull(), queue: text('queue').notNull(), kind: text('kind').notNull(),
  payloadDigest: text('payload_digest').notNull(), payload: jsonb('payload').notNull(), state: text('state').default('pending').notNull(),
  generation: bigint('generation', { mode: 'bigint' }).default(0n).notNull(), fencing: bigint('fencing', { mode: 'bigint' }).default(0n).notNull(),
  attempt: integer('attempt').default(0).notNull(), maxAttempts: integer('max_attempts').default(8).notNull(), nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  leaseOwner: text('lease_owner'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }), resultDigest: text('result_digest'), lastErrorCode: text('last_error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('jobs_operation').on(table.operationId),
  index('jobs_due').on(table.queue, table.nextAttemptAt, table.id).where(sql`${table.state} in ('pending','retry')`),
  index('jobs_expired_lease').on(table.queue, table.leaseExpiresAt, table.id).where(sql`${table.state} = 'leased'`),
]);

export const outboxMessages = databaseSchema.table('outbox_messages', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(), operationId: text('operation_id').notNull(), queue: text('queue').notNull(), destinationKey: text('destination_key').notNull(),
  payloadDigest: text('payload_digest').notNull(), payload: jsonb('payload').notNull(), state: text('state').default('pending').notNull(),
  fencing: bigint('fencing', { mode: 'bigint' }).default(0n).notNull(), attempt: integer('attempt').default(0).notNull(), maxAttempts: integer('max_attempts').default(8).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(), leaseOwner: text('lease_owner'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  providerMessageId: text('provider_message_id'), lastErrorCode: text('last_error_code'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('outbox_identity').on(table.operationId, table.destinationKey, table.payloadDigest),
  index('outbox_due').on(table.queue, table.nextAttemptAt, table.id).where(sql`${table.state} in ('pending','retry')`),
  index('outbox_expired_lease').on(table.queue, table.leaseExpiresAt, table.id).where(sql`${table.state} = 'leased'`),
]);

export const jobAttempts = databaseSchema.table('job_attempts', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(), jobId: bigint('job_id', { mode: 'bigint' }).notNull(), queue: text('queue').notNull(),
  fencing: bigint('fencing', { mode: 'bigint' }).notNull(), attempt: integer('attempt').notNull(), outcome: text('outcome').notNull(), errorCode: text('error_code'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(), finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('job_attempts_identity').on(table.jobId, table.fencing, table.outcome),
  index('job_attempts_job').on(table.queue, table.jobId, table.fencing),
]);
