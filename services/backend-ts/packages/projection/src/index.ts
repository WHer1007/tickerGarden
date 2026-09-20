import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { transaction } from '../../db/src/index.ts';

export type Json = null | boolean | string | number | readonly Json[] | { readonly [key: string]: Json };

export interface ProjectionRecord {
  readonly identity: string;
  readonly sortKey: string;
  readonly payload: Json;
}

export interface PublishProjectionInput {
  readonly pool: Pool;
  readonly deployment: DeploymentIdentity;
  readonly scope: string;
  readonly algorithmVersion: string;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly generation: bigint;
  readonly stream?: string;
  readonly records: readonly ProjectionRecord[];
  readonly incrementalMarketVersions?: boolean;
  readonly schemaName?: string;
}

export async function publishProjection(input: PublishProjectionInput): Promise<{ revision: string; duplicate: boolean; records: number }> {
  validateInput(input);
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  const revision = `${input.blockNumber}:${input.blockHash}`;
  const normalized = [...input.records].sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.identity.localeCompare(right.identity));
  const payloadDigest = digest(normalized.map((record) => ({ identity: record.identity, sortKey: record.sortKey, payload: record.payload })));

  return transaction(input.pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${input.deployment.environment}:${input.deployment.chainId}:${input.deployment.deploymentDigest}:${input.scope}:publish`]);
    await assertPublishableAnchor(client, schema, input);
    const publicationPayload = {
      algorithmVersion: input.algorithmVersion, coverage: { fromBlock: input.deployment.activationBlock.toString(), toBlock: input.blockNumber.toString() },
      recordCount: normalized.length, ...(input.incrementalMarketVersions?{storage:'market-versions-v1'}:{}),
    };
    const inserted = await client.query(
      `INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision,
        input.blockNumber.toString(), input.blockHash, input.generation.toString(), payloadDigest, publicationPayload],
    );
    const duplicate = inserted.rowCount === 0;
    if (duplicate) {
      const existing = await client.query<{ payload_digest: string; generation: string; payload: unknown }>(
        `SELECT payload_digest,generation,payload FROM ${schema}.publications
         WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND revision=$5`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision],
      );
      if (existing.rows[0]?.payload_digest !== payloadDigest || BigInt(existing.rows[0]?.generation ?? '-1') !== input.generation
        || stableStringify(existing.rows[0]?.payload) !== stableStringify(publicationPayload)) throw new Error('publication revision already exists with different evidence');
    }

    const expectedRecords=normalized.map(record=>({identity:record.identity,sort_key:record.sortKey,payload_digest:digest(record.payload),payload:record.payload}));
    let writes=expectedRecords;
    if(input.scope==='configs'){
      await publishConfigSet(client,schema,input,revision,payloadDigest,expectedRecords);
      writes=[];
    }
    if(input.incrementalMarketVersions){
      const currentVersions=(await client.query<{identity:string;sort_key:string;payload_digest:string}>(`SELECT identity,sort_key,payload_digest FROM ${schema}.market_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND valid_from<=$5 AND (valid_to IS NULL OR valid_to>$5)`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,input.generation.toString(),input.blockNumber.toString()])).rows;
      const currentById=new Map(currentVersions.map(row=>[row.identity,row]));
      writes=expectedRecords.filter(row=>{const prior=currentById.get(row.identity);return !prior || prior.sort_key!==row.sort_key || prior.payload_digest!==row.payload_digest;});
    }
    // Write only changed market versions. All records, including reused ones,
    // are compared against persisted payloads once before moving the pointer.
    for (let offset = 0; offset < writes.length; offset += 250) {
      const batch = writes.slice(offset,offset+250);
      const args = [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision, JSON.stringify(batch)];
      if(input.incrementalMarketVersions){
        await client.query(`UPDATE ${schema}.market_record_versions saved SET valid_to=$7
         FROM jsonb_to_recordset($6::jsonb) AS expected(identity text,sort_key text,payload_digest text,payload jsonb)
         WHERE $4::text='markets' AND $5::text IS NOT NULL AND saved.environment=$1 AND saved.chain_id=$2 AND saved.deployment_digest=$3 AND saved.generation=$8
         AND saved.identity=expected.identity AND saved.valid_to IS NULL AND saved.valid_from<$7
         AND (saved.sort_key<>expected.sort_key OR saved.payload_digest<>expected.payload_digest OR saved.payload<>expected.payload)`,[...args,input.blockNumber.toString(),input.generation.toString()]);
        await client.query(`INSERT INTO ${schema}.market_record_versions(environment,chain_id,deployment_digest,generation,identity,valid_from,sort_key,payload_digest,payload)
         SELECT $1,$2,$3,$8,r.identity,$7,r.sort_key,r.payload_digest,r.payload FROM jsonb_to_recordset($6::jsonb) AS r(identity text,sort_key text,payload_digest text,payload jsonb)
         WHERE $4::text='markets' AND $5::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${schema}.market_record_versions old WHERE old.environment=$1 AND old.chain_id=$2 AND old.deployment_digest=$3 AND old.generation=$8 AND old.identity=r.identity AND old.valid_from<=$7 AND (old.valid_to IS NULL OR old.valid_to>$7))`,[...args,input.blockNumber.toString(),input.generation.toString()]);
      }else await client.query(
        `INSERT INTO ${schema}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload)
         SELECT $1,$2,$3,$4,$5,r.identity,r.sort_key,r.payload_digest,r.payload
         FROM jsonb_to_recordset($6::jsonb) AS r(identity text,sort_key text,payload_digest text,payload jsonb) ON CONFLICT DO NOTHING`, args);
      if(!input.incrementalMarketVersions){
      const verified = await client.query<{count: string}>(
        `SELECT count(*)::text count FROM jsonb_to_recordset($6::jsonb) AS expected(identity text,sort_key text,payload_digest text,payload jsonb)
         JOIN ${schema}.projection_read_records saved ON saved.environment=$1 AND saved.chain_id=$2 AND saved.deployment_digest=$3
           AND saved.scope=$4 AND saved.revision=$5 AND saved.identity=expected.identity
           AND saved.sort_key=expected.sort_key AND saved.payload_digest=expected.payload_digest AND saved.payload=expected.payload`, args);
      if (Number(verified.rows[0]?.count) !== batch.length) throw new Error('projection record identity conflict');
      }
    }
    if(input.incrementalMarketVersions)await client.query(`UPDATE ${schema}.market_record_versions SET valid_to=$4 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$5 AND valid_to IS NULL AND valid_from<$4 AND identity NOT IN (SELECT unnest($6::text[]))`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,input.blockNumber.toString(),input.generation.toString(),normalized.map(record=>record.identity)]);

    if(input.incrementalMarketVersions){
      const versionArgs=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,input.generation.toString(),input.blockNumber.toString()];
      const population=(await client.query<{count:string}>(`SELECT count(*)::text count FROM ${schema}.market_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND valid_from<=$5 AND (valid_to IS NULL OR valid_to>$5)`,versionArgs)).rows[0];
      if(Number(population?.count)!==expectedRecords.length)throw new Error('projection record population conflict');
      // Bound returned JSON per statement too; a full-population payload fetch
      // can exceed the SQL deadline during bootstrap or on a cold database.
      for(let offset=0;offset<expectedRecords.length;offset+=250){
        const batch=expectedRecords.slice(offset,offset+250);
        const verified=(await client.query<{identity:string;sort_key:string;payload_digest:string;payload:Json}>(`SELECT identity,sort_key,payload_digest,payload FROM ${schema}.market_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND valid_from<=$5 AND (valid_to IS NULL OR valid_to>$5) AND identity=ANY($6::text[])`,[...versionArgs,batch.map(row=>row.identity)])).rows;
        const savedById=new Map(verified.map(row=>[row.identity,row]));
        if(verified.length!==batch.length || savedById.size!==batch.length)throw new Error('projection record population conflict');
        for(const row of batch){const saved=savedById.get(row.identity);if(!saved || saved.sort_key!==row.sort_key || saved.payload_digest!==row.payload_digest || stableStringify(saved.payload)!==stableStringify(row.payload))throw new Error('projection record identity conflict');}
      }
    }

    const current = await client.query<{ revision: string; block_number: string }>(
      `SELECT p.revision,p.block_number FROM ${schema}.publication_pointers pointer
       JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
       WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND pointer.scope=$4 FOR UPDATE OF pointer`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope],
    );
    if (current.rows[0] && (BigInt(current.rows[0].block_number) > input.blockNumber
      || (BigInt(current.rows[0].block_number) === input.blockNumber && current.rows[0].revision !== revision))) {
      throw new Error('publication pointer cannot move backwards or across a same-height fork');
    }
    await client.query(
      `INSERT INTO ${schema}.publication_pointers(environment,chain_id,deployment_digest,scope,revision)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET revision=excluded.revision,updated_at=now()`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, revision],
    );
    await client.query(
      `INSERT INTO ${schema}.projection_checkpoints(environment,chain_id,deployment_digest,scope,algorithm_version,next_block,generation,last_revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (environment,chain_id,deployment_digest,scope) DO UPDATE SET
         algorithm_version=excluded.algorithm_version,next_block=excluded.next_block,generation=excluded.generation,last_revision=excluded.last_revision,updated_at=now()`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.scope, input.algorithmVersion,
        (input.blockNumber + 1n).toString(), input.generation.toString(), revision],
    );
    return { revision, duplicate, records: normalized.length };
  });
}

/** Retry acknowledgement reads only an already committed immutable publication. */
export async function acknowledgeMarketPublication(input:PublishProjectionInput){
  const schema=identifier(input.schemaName??'tickergarden_serverless');
  return transaction(input.pool,async client=>{
    await assertPublishableAnchor(client,schema,input);
    const revision=`${input.blockNumber}:${input.blockHash}`;
    const row=(await client.query<{generation:string;payload:{algorithmVersion:string;recordCount:number}}>(`SELECT p.generation,p.payload FROM ${schema}.publications p JOIN ${schema}.publication_pointers ptr USING(environment,chain_id,deployment_digest,scope,revision) WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='markets' AND p.revision=$4`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,revision])).rows[0];
    if(!row||BigInt(row.generation)!==input.generation||row.payload.algorithmVersion!==input.algorithmVersion||!Number.isSafeInteger(row.payload.recordCount))throw Error('market retry publication unavailable');
    return{revision,duplicate:true,records:row.payload.recordCount};
  });
}

/** A delta commits to an immutable, previously verified base and every changed identity. */
export async function publishMarketDelta(input: PublishProjectionInput & { readonly baseRevision:string; readonly removed?:readonly string[]; readonly expectedPopulation:number }) {
  validateInput(input);
  if(input.scope!=='markets'||!input.incrementalMarketVersions||!Number.isSafeInteger(input.expectedPopulation)||input.expectedPopulation<0)throw Error('invalid market delta');
  const removed=[...(input.removed??[])].sort();
  if(new Set(removed).size!==removed.length||removed.some(id=>input.records.some(r=>r.identity===id)))throw Error('overlapping market delta');
  const schema=identifier(input.schemaName??'tickergarden_serverless'),revision=`${input.blockNumber}:${input.blockHash}`;
  const records=[...input.records].sort((a,b)=>a.identity.localeCompare(b.identity));
  const recordById=new Map(records.map(r=>[r.identity,r]));
  const entries=[...records.map(r=>({identity:r.identity,sortKey:r.sortKey,payloadDigest:digest(r.payload)})),...removed.map(identity=>({identity,removed:true}))].sort((a,b)=>a.identity.localeCompare(b.identity));
  return transaction(input.pool,async client=>{
    const id=[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest];
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${id.join(':')}:markets:publish`]);
    await assertPublishableAnchor(client,schema,input);
    const base=(await client.query<{payload_digest:string;block_number:string;generation:string;payload:{storage?:string;recordCount?:number;deltaDepth?:number}}>(`SELECT p.* FROM ${schema}.publications p JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3 AND p.scope='markets' AND p.revision=$4 AND b.canonical AND b.finalized`,[...id,input.baseRevision])).rows[0];
    if(!base||base.payload.storage!=='market-versions-v1'||BigInt(base.generation)!==input.generation||BigInt(base.block_number)>=input.blockNumber||!Number.isSafeInteger(base.payload.recordCount))throw Error('market delta base is unavailable');
    if((base.payload.deltaDepth??0)>=256)throw Error('market delta requires a full checkpoint');
    const payload={deltaDepth:(base.payload.deltaDepth??0)+1,algorithmVersion:input.algorithmVersion,coverage:{fromBlock:input.deployment.activationBlock.toString(),toBlock:input.blockNumber.toString()},storage:'market-versions-v1',recordCount:input.expectedPopulation,commitment:'base-delta-v1',baseRevision:input.baseRevision,baseDigest:base.payload_digest,entries};
    const root=digest(payload);
    const existing=(await client.query<{payload_digest:string;payload:unknown}>(`SELECT payload_digest,payload FROM ${schema}.publications WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4`,[...id,revision])).rows[0];
    if(existing){if(existing.payload_digest!==root||stableStringify(existing.payload)!==stableStringify(payload))throw Error('publication revision already exists with different evidence');return{revision,duplicate:true,records:input.expectedPopulation};}
    const pointer=(await client.query<{revision:string}>(`SELECT revision FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' FOR UPDATE`,id)).rows[0];
    if(pointer?.revision!==input.baseRevision)throw Error('market delta base was superseded');
    let population=base.payload.recordCount!;
    for(let offset=0;offset<entries.length;offset+=250){
      const batch=entries.slice(offset,offset+250),ids=batch.map(r=>r.identity);
      const old=(await client.query<{identity:string;sort_key:string;payload_digest:string;payload:Json}>(`SELECT identity,sort_key,payload_digest,payload FROM ${schema}.market_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND identity=ANY($5::text[]) AND valid_from<=$6 AND (valid_to IS NULL OR valid_to>$6)`,[...id,input.generation.toString(),ids,base.block_number])).rows;
      const prior=new Map(old.map(r=>[r.identity,r]));
      const changed:ProjectionRecord[]=[];const closing:string[]=[];
      for(const entry of batch){const previous=prior.get(entry.identity);
        if('removed' in entry){if(!previous)throw Error('removed market is absent from base');population--;closing.push(entry.identity);continue;}
        const value=recordById.get(entry.identity)!;
        if(!previous){population++;changed.push(value);}else if(previous.payload_digest!==entry.payloadDigest||previous.sort_key!==entry.sortKey||stableStringify(previous.payload)!==stableStringify(value.payload)){closing.push(entry.identity);changed.push(value);}
      }
      if(closing.length){const closed=await client.query(`UPDATE ${schema}.market_record_versions SET valid_to=$6 WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND identity=ANY($5::text[]) AND valid_from<=$7 AND valid_to IS NULL`,[...id,input.generation.toString(),closing,input.blockNumber.toString(),base.block_number]);if(closed.rowCount!==closing.length)throw Error('market delta closing conflict');}
      if(changed.length){const values=changed.map(r=>({identity:r.identity,sort_key:r.sortKey,payload_digest:digest(r.payload),payload:r.payload}));const written=await client.query(`INSERT INTO ${schema}.market_record_versions(environment,chain_id,deployment_digest,generation,identity,valid_from,sort_key,payload_digest,payload) SELECT $1,$2,$3,$4,r.identity,$5,r.sort_key,r.payload_digest,r.payload FROM jsonb_to_recordset($6::jsonb) r(identity text,sort_key text,payload_digest text,payload jsonb) RETURNING identity,sort_key,payload_digest,payload`,[...id,input.generation.toString(),input.blockNumber.toString(),JSON.stringify(values)]);if(stableStringify(written.rows.sort((a,b)=>a.identity.localeCompare(b.identity)))!==stableStringify(values.sort((a,b)=>a.identity.localeCompare(b.identity))))throw Error('market delta write verification failed');}
    }
    if(population!==input.expectedPopulation)throw Error('market delta population mismatch');
    const count=(await client.query<{n:string}>(`SELECT count(*)::text n FROM ${schema}.market_record_versions WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND valid_from<=$5 AND (valid_to IS NULL OR valid_to>$5)`,[...id,input.generation.toString(),input.blockNumber.toString()])).rows[0];
    if(Number(count?.n)!==population)throw Error('market delta stored population conflict');
    await client.query(`INSERT INTO ${schema}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES($1,$2,$3,'markets',$4,$5,$6,$7,$8,$9)`,[...id,revision,input.blockNumber.toString(),input.blockHash,input.generation.toString(),root,payload]);
    await client.query(`UPDATE ${schema}.publication_pointers SET revision=$4,updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets'`,[...id,revision]);
    await client.query(`UPDATE ${schema}.projection_checkpoints SET algorithm_version=$4,next_block=$5,generation=$6,last_revision=$7,updated_at=now() WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets'`,[...id,input.algorithmVersion,(input.blockNumber+1n).toString(),input.generation.toString(),revision]);
    return{revision,duplicate:false,records:population};
  });
}

export async function invalidateOrphanedPublications(input: {
  readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly generation: bigint; readonly schemaName?: string;
}): Promise<number> {
  const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
  return transaction(input.pool, async (client) => {
    const orphaned = await client.query<{ scope: string; revision: string; block_number: string }>(
      `SELECT pointer.scope,pointer.revision,p.block_number FROM ${schema}.publication_pointers pointer
       JOIN ${schema}.publications p USING(environment,chain_id,deployment_digest,scope,revision)
       LEFT JOIN ${schema}.chain_blocks b ON b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.hash=p.block_hash
       WHERE pointer.environment=$1 AND pointer.chain_id=$2 AND pointer.deployment_digest=$3 AND (b.hash IS NULL OR NOT b.canonical OR NOT b.finalized)
       FOR UPDATE OF pointer`,
      [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest],
    );
    for (const row of orphaned.rows) {
      await client.query(
        `DELETE FROM ${schema}.publication_pointers WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope=$4 AND revision=$5`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, row.scope, row.revision],
      );
      await client.query(
        `INSERT INTO ${schema}.invalidations(environment,chain_id,deployment_digest,scope,identity,revision,reason)
         VALUES ($1,$2,$3,$4,$5,$6,'anchor_orphaned')`,
        [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, row.scope, row.scope, row.revision],
      );
      await client.query(
        `UPDATE ${schema}.projection_checkpoints SET next_block=$1,generation=$2,last_revision=NULL,updated_at=now()
         WHERE environment=$3 AND chain_id=$4 AND deployment_digest=$5 AND scope=$6`,
        [input.deployment.activationBlock.toString(), input.generation.toString(), input.deployment.environment,
          input.deployment.chainId, input.deployment.deploymentDigest, row.scope],
      );
    }
    return orphaned.rows.length;
  });
}

export async function assertPublishableAnchor(client: PoolClient, schema: string, input: PublishProjectionInput): Promise<void> {
  const anchor = await client.query<{ canonical: boolean; finalized: boolean }>(
    `SELECT canonical,finalized FROM ${schema}.chain_blocks WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND number=$4 AND hash=$5`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.blockNumber.toString(), input.blockHash],
  );
  if (!anchor.rows[0]?.canonical || !anchor.rows[0].finalized) throw new Error('publication anchor is not canonical and finalized');
  const checkpoint = await client.query<{ next_block: string; generation: string }>(
    `SELECT next_block,generation FROM ${schema}.ingestion_checkpoints
     WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND stream=$4 FOR SHARE`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.stream ?? 'frontend-events'],
  );
  if (!checkpoint.rows[0] || BigInt(checkpoint.rows[0].next_block) <= input.blockNumber || BigInt(checkpoint.rows[0].generation) !== input.generation) {
    throw new Error('ingestion checkpoint does not cover publication anchor and generation');
  }
  const ranges = await client.query<{ from_block: string; to_block: string }>(
    `SELECT from_block,to_block FROM ${schema}.covered_ranges
     WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND generation=$4 AND complete AND to_block>=$5 AND from_block<=$6
     ORDER BY from_block,to_block FOR SHARE`,
    [input.deployment.environment, input.deployment.chainId, input.deployment.deploymentDigest, input.generation.toString(),
      input.deployment.activationBlock.toString(), input.blockNumber.toString()],
  );
  let cursor = input.deployment.activationBlock;
  for (const range of ranges.rows) {
    const from = BigInt(range.from_block);
    const to = BigInt(range.to_block);
    if (from > cursor) break;
    if (to >= cursor) cursor = to + 1n;
    if (cursor > input.blockNumber) return;
  }
  throw new Error('publication scope has an incomplete covered range');
}

function validateInput(input: PublishProjectionInput): void {
  if(input.incrementalMarketVersions&&input.scope!=='markets')throw Error('incremental storage is market-only');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.scope) || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.algorithmVersion)) throw new Error('projection scope or algorithm version is invalid');
  if (input.blockNumber < input.deployment.activationBlock || input.generation < 0n) throw new Error('projection bounds are invalid');
  const identities = new Set<string>();
  for (const record of input.records) {
    if (!record.identity || record.identity.length > 512 || !record.sortKey || record.sortKey.length > 512 || identities.has(record.identity)) throw new Error('projection record identity is invalid or duplicated');
    identities.add(record.identity);
    if (Buffer.byteLength(stableStringify(record.payload)) > 262_144) throw new Error('projection record payload is too large');
  }
}

function digest(value: unknown): `0x${string}` {
  return `0x${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  throw new Error('value is not canonical JSON');
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name');
  return `"${value}"`;
}

export class ProjectionPending extends Error {
  readonly scope:string; readonly block:bigint; readonly completed:number;
  constructor(scope:string,block:bigint,completed:number){super(`${scope} projection continuation required`);this.scope=scope;this.block=block;this.completed=completed;}
}

/** Compact numeric keys are internal; revision/address/hash API identities do not change. */
async function publishConfigSet(client:PoolClient,schema:string,input:PublishProjectionInput,revision:string,payloadDigest:string,records:readonly {identity:string;sort_key:string;payload_digest:string;payload:Json}[]){
 let set=(await client.query<{id:string}>(`SELECT id::text FROM ${schema}.config_sets WHERE payload_digest=$1`,[payloadDigest])).rows[0];
 if(!set){
  const inserted=(await client.query<{id:string}>(`INSERT INTO ${schema}.config_sets(payload_digest) VALUES($1) ON CONFLICT DO NOTHING RETURNING id::text`,[payloadDigest])).rows[0];
  set=inserted??(await client.query<{id:string}>(`SELECT id::text FROM ${schema}.config_sets WHERE payload_digest=$1`,[payloadDigest])).rows[0];
  if(!set)throw Error('config set missing');
  if(inserted){
   for(let i=0;i<records.length;i+=250){const batch=JSON.stringify(records.slice(i,i+250));
    await client.query(`INSERT INTO ${schema}.config_contents(payload_digest,payload) SELECT r.payload_digest,r.payload FROM jsonb_to_recordset($1::jsonb) r(payload_digest text,payload jsonb) ON CONFLICT DO NOTHING`,[batch]);
    await client.query(`INSERT INTO ${schema}.config_set_records(set_id,identity,sort_key,content_id) SELECT $1,r.identity,r.sort_key,c.id FROM jsonb_to_recordset($2::jsonb) r(identity text,sort_key text,payload_digest text,payload jsonb) JOIN ${schema}.config_contents c ON c.payload_digest=r.payload_digest AND c.payload=r.payload`,[set.id,batch]);
   }
  }
 }
 const saved=(await client.query<{identity:string;sort_key:string;payload_digest:string;payload:Json}>(`SELECT r.identity,r.sort_key,c.payload_digest,c.payload FROM ${schema}.config_set_records r JOIN ${schema}.config_contents c ON c.id=r.content_id WHERE r.set_id=$1 ORDER BY r.sort_key,r.identity`,[set.id])).rows;
 if(stableStringify(saved)!==stableStringify(records))throw Error('config set evidence conflict');
 await client.query(`INSERT INTO ${schema}.config_publication_sets(environment,chain_id,deployment_digest,scope,revision,set_id) VALUES($1,$2,$3,'configs',$4,$5) ON CONFLICT DO NOTHING`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,revision,set.id]);
 const linked=(await client.query<{set_id:string}>(`SELECT set_id::text FROM ${schema}.config_publication_sets WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='configs' AND revision=$4`,[input.deployment.environment,input.deployment.chainId,input.deployment.deploymentDigest,revision])).rows[0];
 if(linked?.set_id!==set.id)throw Error('config publication set conflict');
}
