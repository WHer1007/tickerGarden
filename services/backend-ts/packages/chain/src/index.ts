import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { keccak256 } from 'viem';
import { transaction } from '../../db/src/index.ts';

const ALLOWED_METHODS = new Set([
  'eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_call', 'eth_getCode',
]);
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class RpcError extends Error {
  override readonly name = 'RpcError';
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export interface RpcBlock {
  readonly number: bigint;
  readonly hash: `0x${string}`;
  readonly parentHash: `0x${string}`;
  readonly timestamp: bigint;
}

export interface RpcLog {
  readonly address: `0x${string}`;
  readonly blockHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly transactionHash: `0x${string}`;
  readonly transactionIndex: bigint;
  readonly logIndex: bigint;
  readonly data: `0x${string}`;
  readonly topics: readonly `0x${string}`[];
  readonly removed: boolean;
}

export interface RpcTransportOptions {
  readonly url: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly provider?: string;
  readonly nominalComputeUnits?: (method: string) => number | null;
  readonly computeUnitSchedule?: string;
  readonly observe?: (metric: RpcCallMetric) => void;
}

export interface RpcCallMetric {
  readonly event: 'rpc_call';
  readonly provider: string;
  readonly method: string;
  readonly attempt: number;
  readonly outcome: 'succeeded' | 'failed';
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly retryable: boolean;
  readonly nominalComputeUnits: number | null;
  readonly computeUnitSchedule: string | null;
}

export class RpcTransport {
  readonly #url: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #provider: string;
  readonly #nominalComputeUnits: ((method: string) => number | null) | undefined;
  readonly #computeUnitSchedule: string | undefined;
  readonly #observe: ((metric: RpcCallMetric) => void) | undefined;
  #requestId = 0;

  constructor(options: RpcTransportOptions) {
    const url = new URL(options.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
      throw new Error('RPC endpoint must use HTTPS or local HTTP');
    }
    this.#url = url.toString();
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.#provider = options.provider ?? 'unspecified';
    this.#nominalComputeUnits = options.nominalComputeUnits;
    this.#computeUnitSchedule = options.computeUnitSchedule;
    this.#observe = options.observe;
  }

  async call<TResult>(method: string, params: readonly unknown[]): Promise<TResult> {
    if (!ALLOWED_METHODS.has(method)) throw new Error('RPC method is not allowed');
    const requestId = ++this.#requestId;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = performance.now();
      const requestBody = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
      let responseBytes = 0;
      try {
        const response = await this.#fetch(this.#url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: requestBody,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        const declaredLength = Number(response.headers.get('content-length') ?? '0');
        if (declaredLength > this.#maxResponseBytes) throw new RpcError('RPC response exceeds size limit');
        const bytes = Buffer.from(await response.arrayBuffer());
        responseBytes = bytes.byteLength;
        if (bytes.byteLength > this.#maxResponseBytes) throw new RpcError('RPC response exceeds size limit');
        if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`, response.status === 429 || response.status >= 500);
        const body = JSON.parse(bytes.toString('utf8')) as { jsonrpc?: unknown; id?: unknown; result?: TResult; error?: { code?: unknown } };
        if (body.jsonrpc !== '2.0' || body.id !== requestId) throw new RpcError('RPC response identity mismatch');
        if (body.error) throw new RpcError(`RPC returned error code ${String(body.error.code ?? 'unknown')}`);
        if (!Object.hasOwn(body, 'result')) throw new RpcError('RPC response has no result');
        this.#emit({ event: 'rpc_call', provider: this.#provider, method, attempt: attempt + 1, outcome: 'succeeded',
          durationMs: elapsed(started), requestBytes: Buffer.byteLength(requestBody), responseBytes, retryable: false,
          nominalComputeUnits: this.#nominalComputeUnits?.(method) ?? null, computeUnitSchedule: this.#computeUnitSchedule ?? null });
        return body.result as TResult;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof RpcError ? error.retryable : true;
        this.#emit({ event: 'rpc_call', provider: this.#provider, method, attempt: attempt + 1, outcome: 'failed',
          durationMs: elapsed(started), requestBytes: Buffer.byteLength(requestBody), responseBytes, retryable,
          nominalComputeUnits: this.#nominalComputeUnits?.(method) ?? null, computeUnitSchedule: this.#computeUnitSchedule ?? null });
        if (!retryable || attempt === 1) break;
      }
    }
    if (lastError instanceof RpcError) throw lastError;
    throw new RpcError('RPC request failed', true);
  }

  #emit(metric: RpcCallMetric): void {
    try { this.#observe?.(metric); } catch { /* telemetry must not alter RPC correctness */ }
  }

  async chainId(): Promise<bigint> {
    return hexQuantity(await this.call<string>('eth_chainId', []));
  }

  async block(number: bigint): Promise<RpcBlock> {
    const raw = await this.call<Record<string, unknown> | null>('eth_getBlockByNumber', [toHexQuantity(number), false]);
    if (!raw) throw new RpcError('RPC block was not found');
    return parseBlock(raw, number);
  }

  async latestBlock(): Promise<RpcBlock> {
    const raw = await this.call<Record<string, unknown> | null>('eth_getBlockByNumber', ['latest', false]);
    if (!raw || typeof raw.number !== 'string') throw new RpcError('latest RPC block was not found');
    return parseBlock(raw, hexQuantity(raw.number));
  }

  async logs(input: { readonly fromBlock: bigint; readonly toBlock: bigint; readonly addresses: readonly string[]; readonly topics?: readonly (string | readonly string[] | null)[] }): Promise<RpcLog[]> {
    if (input.toBlock < input.fromBlock || input.toBlock - input.fromBlock >= 10n) throw new Error('RPC log range must contain 1 to 10 blocks');
    if (input.addresses.length < 1 || input.addresses.length > 100 || input.addresses.some((value) => !ADDRESS.test(value))) throw new Error('RPC log addresses are invalid');
    const raw = await this.call<Record<string, unknown>[]>('eth_getLogs', [{
      fromBlock: toHexQuantity(input.fromBlock), toBlock: toHexQuantity(input.toBlock), address: input.addresses,
      ...(input.topics ? { topics: input.topics } : {}),
    }]);
    return raw.map(parseLog);
  }

  async code(address: `0x${string}`, blockNumber: bigint): Promise<`0x${string}`> {
    if (!ADDRESS.test(address) || blockNumber < 0n) throw new Error('RPC code request is invalid');
    const code = await this.call<string>('eth_getCode', [address, toHexQuantity(blockNumber)]);
    if (!/^0x(?:[0-9a-f]{2})*$/.test(code)) throw new RpcError('RPC code shape is invalid');
    if (code === '0x') throw new RpcError('RPC address has no code at requested block');
    return code as `0x${string}`;
  }

  async codeHash(address: `0x${string}`, blockNumber: bigint): Promise<`0x${string}`> {
    return keccak256(await this.code(address, blockNumber));
  }

  async callAt(address: `0x${string}`, data: `0x${string}`, blockNumber: bigint): Promise<`0x${string}`> {
    if (!ADDRESS.test(address) || !/^0x(?:[0-9a-f]{2})+$/.test(data) || blockNumber < 0n) throw new Error('RPC fixed-block call is invalid');
    const result = await this.call<string>('eth_call', [{ to: address, data }, toHexQuantity(blockNumber)]);
    if (!/^0x(?:[0-9a-f]{2})*$/.test(result)) throw new RpcError('RPC call result shape is invalid');
    return result as `0x${string}`;
  }
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

export async function verifyChainIdentity(transport: RpcTransport, expectedChainId: bigint, expectedGenesisHash: string): Promise<void> {
  const [chainId, genesis] = await Promise.all([transport.chainId(), transport.block(0n)]);
  if (chainId !== expectedChainId) throw new RpcError('RPC chain ID mismatch');
  if (genesis.hash !== expectedGenesisHash) throw new RpcError('RPC genesis hash mismatch');
}

export async function consensusBlock(primary: RpcTransport, secondary: RpcTransport | undefined, number: bigint): Promise<RpcBlock> {
  const first = await primary.block(number);
  if (!secondary) return first;
  const second = await secondary.block(number);
  if (first.hash !== second.hash || first.parentHash !== second.parentHash || first.timestamp !== second.timestamp) {
    throw new RpcError('RPC providers disagree on block identity');
  }
  return first;
}

export function isFinalized(candidate: RpcBlock, observedHead: RpcBlock, delayBlocks: bigint, delaySeconds: bigint): boolean {
  if (candidate.number > observedHead.number || delayBlocks < 0n || delaySeconds < 0n) return false;
  return candidate.number + delayBlocks <= observedHead.number && candidate.timestamp + delaySeconds <= observedHead.timestamp;
}

export function hexQuantity(value: string): bigint {
  if (!QUANTITY.test(value)) throw new RpcError('invalid RPC quantity');
  return BigInt(value);
}

export function toHexQuantity(value: bigint): `0x${string}` {
  if (value < 0n) throw new Error('RPC quantity cannot be negative');
  return `0x${value.toString(16)}`;
}

function parseBlock(raw: Record<string, unknown>, expectedNumber: bigint): RpcBlock {
  if (typeof raw.number !== 'string' || typeof raw.hash !== 'string' || typeof raw.parentHash !== 'string' || typeof raw.timestamp !== 'string') {
    throw new RpcError('RPC block shape is invalid');
  }
  const number = hexQuantity(raw.number);
  if (number !== expectedNumber || !HASH.test(raw.hash) || !HASH.test(raw.parentHash)) throw new RpcError('RPC block identity is invalid');
  return { number, hash: raw.hash as `0x${string}`, parentHash: raw.parentHash as `0x${string}`, timestamp: hexQuantity(raw.timestamp) };
}

function parseLog(raw: Record<string, unknown>): RpcLog {
  if (typeof raw.address !== 'string' || !ADDRESS.test(raw.address) || typeof raw.blockHash !== 'string' || !HASH.test(raw.blockHash)
    || typeof raw.transactionHash !== 'string' || !HASH.test(raw.transactionHash) || typeof raw.data !== 'string' || !/^0x[0-9a-f]*$/.test(raw.data)
    || !Array.isArray(raw.topics) || raw.topics.some((topic) => typeof topic !== 'string' || !HASH.test(topic))) {
    throw new RpcError('RPC log shape is invalid');
  }
  return {
    address: raw.address as `0x${string}`, blockHash: raw.blockHash as `0x${string}`,
    blockNumber: hexQuantity(String(raw.blockNumber)), transactionHash: raw.transactionHash as `0x${string}`,
    transactionIndex: hexQuantity(String(raw.transactionIndex)), logIndex: hexQuantity(String(raw.logIndex)),
    data: raw.data as `0x${string}`, topics: raw.topics as `0x${string}`[], removed: raw.removed === true,
  };
}

export interface DeploymentIdentity {
  readonly environment: 'preview' | 'test' | 'production';
  readonly chainId: 4663 | 46630;
  readonly deploymentDigest: `0x${string}`;
  readonly activationBlock: bigint;
}

export interface ContractSource {
  readonly module: string;
  readonly address: `0x${string}`;
  readonly birthBlock: bigint;
  readonly runtimeCodeHash: `0x${string}`;
}

export interface IngestRangeInput {
  readonly pool: Pool;
  readonly deployment: DeploymentIdentity;
  readonly stream: string;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly observedHead: RpcBlock;
  readonly finalityDelayBlocks: bigint;
  readonly finalityDelaySeconds: bigint;
  readonly primary: RpcTransport;
  readonly secondary?: RpcTransport;
  readonly sources: readonly ContractSource[];
  readonly discover?: (logs: readonly RpcLog[], block: RpcBlock) => readonly ContractSource[] | Promise<readonly ContractSource[]>;
  readonly schemaName?: string;
}

export async function loadIngestionState(input: {
  readonly pool: Pool;
  readonly deployment: DeploymentIdentity;
  readonly stream: string;
  readonly schemaName?: string;
  readonly initialNextBlock?: bigint;
}): Promise<{ nextBlock: bigint; generation: bigint; sources: ContractSource[] }> {
  validateDeployment(input.deployment);
  if (!TOKEN_NAME.test(input.stream)) throw new Error('invalid ingestion stream');
  const schema = sqlIdentifier(input.schemaName ?? 'tickergarden_serverless');
  const [checkpoint, sources] = await Promise.all([
    input.pool.query<{ next_block: string; generation: string }>(
      `SELECT next_block,generation FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream=$4`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream],
    ),
    input.pool.query<{ module: string; address: `0x${string}`; birth_block: string; runtime_code_hash: `0x${string}` }>(
      `SELECT module,address,birth_block,runtime_code_hash FROM ${schema}.contract_sources
       WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND active ORDER BY birth_block,address`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest],
    ),
  ]);
  return {
    nextBlock: BigInt(checkpoint.rows[0]?.next_block ?? input.initialNextBlock ?? input.deployment.activationBlock),
    generation: BigInt(checkpoint.rows[0]?.generation ?? '0'),
    sources: sources.rows.map((row) => ({ module: row.module, address: row.address, birthBlock: BigInt(row.birth_block), runtimeCodeHash: row.runtime_code_hash })),
  };
}

export class ReorgDetectedError extends Error {
  override readonly name = 'ReorgDetectedError';
}

export async function ingestCanonicalRange(input: IngestRangeInput): Promise<{ blocks: number; logs: number; sources: number; generation: string; filterDigest: string }> {
  if (input.toBlock < input.fromBlock || input.toBlock - input.fromBlock >= 10n) throw new Error('ingestion range must contain 1 to 10 blocks');
  if (!TOKEN_NAME.test(input.stream)) throw new Error('invalid ingestion stream');
  validateDeployment(input.deployment);
  const schema = sqlIdentifier(input.schemaName ?? 'tickergarden_serverless');
  const known = new Map(input.sources.map((source) => {
    validateSource(source);
    return [source.address, source] as const;
  }));
  const blocks: RpcBlock[] = [];
  const blockLogs = new Map<bigint, Map<string, RpcLog>>();

  for (let number = input.fromBlock; number <= input.toBlock; number += 1n) {
    const block = await consensusBlock(input.primary, input.secondary, number);
    if (!isFinalized(block, input.observedHead, input.finalityDelayBlocks, input.finalityDelaySeconds)) throw new RpcError('range includes a non-finalized block');
    if (blocks.length && block.parentHash !== blocks.at(-1)?.hash) throw new ReorgDetectedError('RPC range parent hash mismatch');
    blocks.push(block);
    blockLogs.set(number, new Map());
  }

  const blockByNumber = new Map(blocks.map((block) => [block.number, block]));
  const queried = new Set<string>();
  const initialGroups = new Map<bigint, string[]>();
  for (const source of known.values()) {
    if (source.birthBlock > input.toBlock) continue;
    const start = source.birthBlock > input.fromBlock ? source.birthBlock : input.fromBlock;
    const addresses = initialGroups.get(start) ?? [];
    addresses.push(source.address);
    initialGroups.set(start, addresses);
    queried.add(source.address);
  }
  for (const [start, addresses] of initialGroups) {
    await fetchAndMergeLogs(input, start, input.toBlock, addresses, blockByNumber, blockLogs);
  }

  for (const block of blocks) {
    for (let discoveryRound = 0; discoveryRound < 8; discoveryRound += 1) {
      const discovered: ContractSource[] = [];
      for (const source of await input.discover?.([...(blockLogs.get(block.number)?.values() ?? [])], block) ?? []) {
        validateSource(source);
        if (source.birthBlock !== block.number) throw new Error('new contract source must use its discovery block as birth block');
        const existing = known.get(source.address);
        if (existing && (existing.module !== source.module || existing.runtimeCodeHash !== source.runtimeCodeHash || existing.birthBlock !== source.birthBlock)) {
          throw new Error('contract source identity conflict');
        }
        known.set(source.address, source);
        if (!queried.has(source.address)) discovered.push(source);
      }
      if (!discovered.length) break;
      discovered.forEach((source) => queried.add(source.address));
      await fetchAndMergeLogs(input, block.number, input.toBlock, discovered.map((source) => source.address), blockByNumber, blockLogs);
    }
  }
  const logs = [...blockLogs.values()].flatMap((logsAtBlock) => [...logsAtBlock.values()])
    .sort((left, right) => left.blockNumber === right.blockNumber ? Number(left.logIndex - right.logIndex) : Number(left.blockNumber - right.blockNumber));

  const filterDigest = digest([...known.values()].filter((source) => source.birthBlock <= input.toBlock).sort((a, b) => a.address.localeCompare(b.address)).map((source) => ({
    address: source.address, birthBlock: source.birthBlock.toString(), runtimeCodeHash: source.runtimeCodeHash,
  })));
  const result = await transaction(input.pool, async (client) => {
    await client.query(
      `INSERT INTO ${schema}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream, input.fromBlock.toString()],
    );
    const checkpoint = await client.query<{ next_block: string; last_block_hash: string | null; generation: string }>(
      `SELECT next_block,last_block_hash,generation FROM ${schema}.ingestion_checkpoints
       WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream=$4 FOR UPDATE`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream],
    );
    const current = checkpoint.rows[0];
    if (!current || BigInt(current.next_block) !== input.fromBlock) throw new Error('ingestion checkpoint does not match requested range');
    if (current.last_block_hash && blocks[0]?.parentHash !== current.last_block_hash) throw new ReorgDetectedError('stored checkpoint parent hash mismatch');
    let generation = BigInt(current.generation);

    for (const block of blocks) {
      const orphaned = await client.query<{ hash: string }>(
        `UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false
         WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical AND hash<>$5 RETURNING hash`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, block.number.toString(), block.hash],
      );
      if (orphaned.rowCount) {
        generation += 1n;
        await client.query(
          `UPDATE ${schema}.chain_logs SET canonical=false WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash=ANY($4::text[])`,
          [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, orphaned.rows.map((row) => row.hash)],
        );
      }
      await client.query(
        `INSERT INTO ${schema}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized,source_timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,true,true,to_timestamp($7))
         ON CONFLICT (environment,chain_id,deployment_digest,hash) DO UPDATE SET canonical=true,finalized=true,source_timestamp=excluded.source_timestamp`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, block.number.toString(), block.hash, block.parentHash, block.timestamp.toString()],
      );
    }
    for (const source of known.values()) {
      await client.query(
        `INSERT INTO ${schema}.contract_sources(environment,chain_id,deployment_digest,module,address,birth_block,runtime_code_hash,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT DO NOTHING`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, source.module, source.address, source.birthBlock.toString(), source.runtimeCodeHash],
      );
    }
    for (const log of logs) {
      await client.query(
        `INSERT INTO ${schema}.chain_logs(environment,chain_id,deployment_digest,block_hash,transaction_hash,transaction_index,log_index,address,topic0,payload,canonical)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
         ON CONFLICT (environment,chain_id,deployment_digest,block_hash,transaction_hash,log_index) DO UPDATE SET canonical=true,payload=excluded.payload`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, log.blockHash, log.transactionHash,
          log.transactionIndex.toString(), log.logIndex.toString(), log.address, log.topics[0] ?? null, serializeLog(log)],
      );
    }
    await client.query(
      `INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,now())`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.fromBlock.toString(), input.toBlock.toString(), generation.toString(), filterDigest],
    );
    await client.query(
      `UPDATE ${schema}.ingestion_checkpoints SET next_block=$1,last_block_hash=$2,generation=$3,updated_at=now()
       WHERE environment=$4 AND chain_id=$5 AND deployment_digest=$6 AND stream=$7`,
      [(input.toBlock + 1n).toString(), blocks.at(-1)?.hash, generation.toString(), input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream],
    );
    return generation.toString();
  });
  return { blocks: blocks.length, logs: logs.length, sources: known.size, generation: result, filterDigest };
}

export async function rewindCanonicalChain(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly stream: string; readonly ancestor: RpcBlock; readonly expectedNextBlock: bigint; readonly schemaName?: string;
}): Promise<string> {
  validateDeployment(input.deployment);
  if (input.ancestor.number < input.deployment.activationBlock) {
    throw new Error('common ancestor is before deployment activation');
  }
  const schema = sqlIdentifier(input.schemaName ?? 'tickergarden_serverless');
  return transaction(input.pool, async (client) => {
    const checkpoint = await client.query<{ next_block: string; generation: string }>(
      `SELECT next_block,generation FROM ${schema}.ingestion_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream=$4 FOR UPDATE`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream],
    );
    if (BigInt(checkpoint.rows[0]?.next_block ?? '-1') !== input.expectedNextBlock) throw new Error('checkpoint changed before reorg rewind');
    const stored = await client.query<{ hash: string }>(
      `SELECT hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.ancestor.number.toString()],
    );
    if (stored.rows[0]?.hash !== input.ancestor.hash) throw new Error('common ancestor is not canonical in storage');
    const generation = BigInt(checkpoint.rows[0]!.generation) + 1n;
    const priorCoverage = await client.query<{ from_block: string; to_block: string; filter_digest: string }>(
      `SELECT from_block,to_block,filter_digest FROM ${schema}.covered_ranges
       WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND complete AND from_block<=$5
       ORDER BY from_block,to_block`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest,
        checkpoint.rows[0]!.generation, input.ancestor.number.toString()],
    );
    let coverageCursor = input.deployment.activationBlock;
    let ancestorFilterDigest: string | undefined;
    for (const range of priorCoverage.rows) {
      const from = BigInt(range.from_block);
      const to = BigInt(range.to_block) > input.ancestor.number ? input.ancestor.number : BigInt(range.to_block);
      if (from > coverageCursor) break;
      if (to >= coverageCursor) {
        coverageCursor = to + 1n;
        ancestorFilterDigest = range.filter_digest;
      }
      if (coverageCursor > input.ancestor.number) break;
    }
    await client.query(
      `UPDATE ${schema}.chain_logs SET canonical=false WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND block_hash IN
       (SELECT hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number>$4 AND canonical)`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.ancestor.number.toString()],
    );
    await client.query(
      `UPDATE ${schema}.chain_blocks SET canonical=false,finalized=false WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number>$4 AND canonical`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.ancestor.number.toString()],
    );
    await client.query(
      `UPDATE ${schema}.ingestion_checkpoints SET next_block=$1,last_block_hash=$2,generation=$3,updated_at=now()
       WHERE environment=$4 AND chain_id=$5 AND deployment_digest=$6 AND stream=$7`,
      [(input.ancestor.number + 1n).toString(), input.ancestor.hash, generation.toString(), input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream],
    );
    if (coverageCursor > input.ancestor.number && ancestorFilterDigest) {
      await client.query(
        `INSERT INTO ${schema}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT DO NOTHING`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest,
          input.deployment.activationBlock.toString(), input.ancestor.number.toString(), generation.toString(), ancestorFilterDigest],
      );
    }
    return generation.toString();
  });
}

export async function findCommonAncestor(input: {
  readonly pool: Pool;
  readonly deployment: DeploymentIdentity;
  readonly primary: RpcTransport;
  readonly secondary?: RpcTransport;
  readonly fromBlock: bigint;
  readonly maxDepth: bigint;
  readonly schemaName?: string;
}): Promise<RpcBlock> {
  validateDeployment(input.deployment);
  if (input.fromBlock < 0n || input.maxDepth < 0n || input.maxDepth > 1_000n) throw new Error('common ancestor search bounds are invalid');
  const schema = sqlIdentifier(input.schemaName ?? 'tickergarden_serverless');
  const floor = input.fromBlock > input.maxDepth ? input.fromBlock - input.maxDepth : 0n;
  for (let number = input.fromBlock; number >= floor; number -= 1n) {
    const candidate = await consensusBlock(input.primary, input.secondary, number);
    const stored = await input.pool.query<{ hash: string }>(
      `SELECT hash FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND canonical`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, number.toString()],
    );
    if (stored.rows[0]?.hash === candidate.hash) return candidate;
    if (number === 0n) break;
  }
  throw new ReorgDetectedError('common ancestor was not found within bounded depth');
}

const TOKEN_NAME = /^[A-Za-z0-9._:-]{1,160}$/;

function sqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name');
  return `"${value}"`;
}

function validateDeployment(value: DeploymentIdentity): void {
  if (!HASH.test(value.deploymentDigest) || value.activationBlock < 0n) throw new Error('invalid deployment identity');
}

function validateSource(value: ContractSource): void {
  if (!TOKEN_NAME.test(value.module) || !ADDRESS.test(value.address) || !HASH.test(value.runtimeCodeHash) || value.birthBlock < 0n) throw new Error('invalid contract source');
}

function logIdentity(log: RpcLog): string {
  return `${log.blockHash}:${log.transactionHash}:${log.logIndex}`;
}

function logSetDigest(logs: readonly RpcLog[]): string {
  return digest(logs.map(serializeLog).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function digest(value: unknown): `0x${string}` {
  return `0x${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function serializeLog(log: RpcLog): Record<string, unknown> {
  return {
    address: log.address, blockHash: log.blockHash, blockNumber: log.blockNumber.toString(), transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex.toString(), logIndex: log.logIndex.toString(), data: log.data, topics: [...log.topics], removed: log.removed,
  };
}

async function fetchAndMergeLogs(
  input: IngestRangeInput,
  fromBlock: bigint,
  toBlock: bigint,
  addresses: readonly string[],
  blockByNumber: ReadonlyMap<bigint, RpcBlock>,
  blockLogs: Map<bigint, Map<string, RpcLog>>,
): Promise<void> {
  for (const addressBatch of chunks(addresses, 100)) {
    const request = { fromBlock, toBlock, addresses: addressBatch } as const;
    const primaryLogs = await input.primary.logs(request);
    if (input.secondary) {
      const secondaryLogs = await input.secondary.logs(request);
      if (logSetDigest(primaryLogs) !== logSetDigest(secondaryLogs)) throw new RpcError('RPC providers disagree on range logs');
    }
    for (const log of primaryLogs) {
      const block = blockByNumber.get(log.blockNumber);
      if (!block || log.blockHash !== block.hash || log.removed) throw new RpcError('RPC log is not canonical for requested range');
      blockLogs.get(log.blockNumber)?.set(logIdentity(log), log);
    }
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
