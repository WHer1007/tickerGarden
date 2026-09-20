import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import test from 'node:test';
import {applyCoreMigration,createDatabasePool,migrationManifest,migrationSql} from '../../packages/db/src/index.ts';
import {invalidateOrphanedPublications,publishProjection} from '../../packages/projection/src/index.ts';
import {readPublishedConfigPage} from '../../packages/read-store/src/index.ts';

const connectionString=process.env.TG_TEST_DATABASE_URL??process.env.TG_MIGRATION_DATABASE_URL??process.env.TG_DATABASE_URL;
const hash=(c:string):`0x${string}`=>`0x${c.repeat(64)}`;
const ident=(v:string)=>`"${v}"`;
const stable=(value:any):string=>value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
const digest=(value:unknown)=>`0x${createHash('sha256').update(stable(value)).digest('hex')}`;
const secret='config-set-integration-cursor-secret';
const configRecord=(kind:string,id:string,status:number)=>({identity:`${kind}:${id}`,sortKey:`${kind}:${id}`,payload:{kind,id,status}});

test('config publications share immutable contents while preserving each revision and generation',{timeout:60000},async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const schemaName=`tg_config_sets_${process.pid}_${randomBytes(4).toString('hex')}`,s=ident(schemaName),pool=createDatabasePool(connectionString,{max:2}).pool;
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash('1'),activationBlock:1n};
 const blocks=[[1,hash('a'),hash('0')],[2,hash('b'),hash('a')],[3,hash('c'),hash('b')],[4,hash('d'),hash('c')]] as const;
 const base={pool,deployment,scope:'configs',algorithmVersion:'configs-test-v1',generation:0n,schemaName};
 try{
  await applyCoreMigration(pool,schemaName);
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`,[deployment.deploymentDigest,hash('9'),hash('0'),hash('8')]);
  for(const [n,b,parent]of blocks)await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',46630,$1,$2,$3,$4,true,true)`,[deployment.deploymentDigest,n,b,parent]);
  await pool.query(`INSERT INTO ${s}.ingestion_checkpoints(environment,chain_id,deployment_digest,stream,next_block,last_block_hash,generation) VALUES('test',46630,$1,'frontend-events',2,$2,0)`,[deployment.deploymentDigest,hash('a')]);
  await pool.query(`INSERT INTO ${s}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES('test',46630,$1,1,4,0,$2,true,now())`,[deployment.deploymentDigest,hash('9')]);
  const original=[configRecord('asset',hash('2'),1),configRecord('quote',hash('3'),1)];
  assert.deepEqual(await publishProjection({...base,blockNumber:1n,blockHash:hash('a'),records:original}),{revision:`1:${hash('a')}`,duplicate:false,records:2});
  const set1=(await pool.query(`SELECT set_id::text FROM ${s}.config_publication_sets WHERE revision=$1`,[`1:${hash('a')}`])).rows[0].set_id;
  await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=3,last_block_hash=$1`,[hash('b')]);
  assert.deepEqual(await publishProjection({...base,blockNumber:2n,blockHash:hash('b'),records:original}),{revision:`2:${hash('b')}`,duplicate:false,records:2});
  const reused=(await pool.query(`SELECT set_id::text FROM ${s}.config_publication_sets WHERE revision=$1`,[`2:${hash('b')}`])).rows[0].set_id;
  assert.equal(reused,set1,'unchanged content set is reused across publication anchors');
  assert.deepEqual((await pool.query(`SELECT (SELECT count(*) FROM ${s}.config_contents)::int contents,(SELECT count(*) FROM ${s}.config_set_records)::int members,(SELECT count(*) FROM ${s}.config_publication_sets)::int anchors`)).rows[0],{contents:2,members:2,anchors:2});
  assert.deepEqual(await publishProjection({...base,blockNumber:2n,blockHash:hash('b'),records:original}),{revision:`2:${hash('b')}`,duplicate:true,records:2});
  await assert.rejects(publishProjection({...base,blockNumber:2n,blockHash:hash('b'),records:[configRecord('asset',hash('2'),999),original[1]!]}),/different evidence/);

  const changed=[configRecord('asset',hash('2'),2),original[1]!];
  await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=4,last_block_hash=$1`,[hash('c')]);
  await publishProjection({...base,blockNumber:3n,blockHash:hash('c'),records:changed});
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.config_contents`)).rows[0].count),3,'changed payload adds content while reusing unchanged quote content');
  assert.deepEqual((await readPublishedConfigPage({pool,deployment,kind:'asset',revision:`1:${hash('a')}`,secret,schemaName})).items,[original[0]!.payload]);
  assert.deepEqual((await readPublishedConfigPage({pool,deployment,kind:'asset',revision:`3:${hash('c')}`,secret,schemaName})).items,[changed[0]!.payload]);

  // Publish on the old fork, then publish the same records at a replacement
  // anchor in a new generation. Content is reused while anchor identity changes.
  await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=5,last_block_hash=$1`,[hash('d')]);
  await publishProjection({...base,blockNumber:4n,blockHash:hash('d'),records:changed});
  const oldForkSet=(await pool.query(`SELECT set_id::text FROM ${s}.config_publication_sets WHERE revision=$1`,[`4:${hash('d')}`])).rows[0].set_id;
  await pool.query(`UPDATE ${s}.chain_blocks SET canonical=false WHERE number=4`);
  await invalidateOrphanedPublications({pool,deployment,generation:1n,schemaName});
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',46630,$1,4,$2,$3,true,true)`,[deployment.deploymentDigest,hash('e'),hash('c')]);
  await pool.query(`UPDATE ${s}.ingestion_checkpoints SET next_block=5,last_block_hash=$1,generation=1`,[hash('e')]);
  await pool.query(`INSERT INTO ${s}.covered_ranges(environment,chain_id,deployment_digest,from_block,to_block,generation,filter_digest,complete,verified_at) VALUES('test',46630,$1,1,4,1,$2,true,now())`,[deployment.deploymentDigest,hash('a')]);
  const generationOne={...base,generation:1n,algorithmVersion:'configs-test-v2'};
  await publishProjection({...generationOne,blockNumber:4n,blockHash:hash('e'),records:changed});
  const currentSet=(await pool.query(`SELECT set_id::text FROM ${s}.config_publication_sets WHERE revision=$1`,[`3:${hash('c')}`])).rows[0].set_id;
  const reanchoredSet=(await pool.query(`SELECT set_id::text FROM ${s}.config_publication_sets WHERE revision=$1`,[`4:${hash('e')}`])).rows[0].set_id;
  assert.equal(oldForkSet,currentSet);
  assert.equal(reanchoredSet,currentSet);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.config_contents`)).rows[0].count),3);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.config_publication_sets`)).rows[0].count),5);
  assert.deepEqual((await readPublishedConfigPage({pool,deployment,kind:'asset',revision:`4:${hash('e')}`,secret,schemaName})).items,[changed[0]!.payload]);
  await assert.rejects(readPublishedConfigPage({pool,deployment,kind:'asset',revision:`4:${hash('d')}`,secret,schemaName}),/requested publication is unavailable/);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(()=>undefined);await pool.end();}
});

test('0030 compacts actual legacy config records and preserves their publications and other scopes',{timeout:60000},async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const schemaName=`tg_config_migrate_${process.pid}_${randomBytes(4).toString('hex')}`,s=ident(schemaName),pool=createDatabasePool(connectionString,{max:1}).pool;
 const deployment={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash('4'),activationBlock:1n};
 const first=hash('a'),second=hash('b'),parent=hash('0'),asset=configRecord('asset',hash('2'),7),quote=configRecord('quote',hash('3'),8);
 try{
  for(const migration of migrationManifest().filter(m=>m.version<'0030_config_sets')){await pool.query(migrationSql(schemaName,migration.version));await pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`,[migration.digest,migration.version]);}
  await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$2,1,$3,$4)`,[deployment.deploymentDigest,hash('9'),parent,hash('8')]);
  await pool.query(`INSERT INTO ${s}.chain_blocks(environment,chain_id,deployment_digest,number,hash,parent_hash,canonical,finalized) VALUES('test',46630,$1,1,$2,$4,true,true),('test',46630,$1,2,$3,$2,true,true)`,[deployment.deploymentDigest,first,second,parent]);
  const records=[asset,quote],recordDigest=(r:any)=>digest(r.payload),recordsDigest=digest(records.map(r=>({identity:r.identity,sortKey:r.sortKey,payload:r.payload})));
  for(const [revision,n,b]of [[`1:${first}`,1,first],[`2:${second}`,2,second]] as const){
   await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'configs',$2,$3,$4,0,$5,$6)`,[deployment.deploymentDigest,revision,n,b,recordsDigest,{recordCount:2,algorithmVersion:'legacy-configs'}]);
   await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES('test',46630,$1,'configs',$2,$3,$4,$5,$6),('test',46630,$1,'configs',$2,$7,$8,$9,$10)`,[deployment.deploymentDigest,revision,asset.identity,asset.sortKey,recordDigest(asset),asset.payload,quote.identity,quote.sortKey,recordDigest(quote),quote.payload]);
  }
  await pool.query(`INSERT INTO ${s}.publications(environment,chain_id,deployment_digest,scope,revision,block_number,block_hash,generation,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,2,$3,0,$4,$5)`,[deployment.deploymentDigest,`2:${second}`,second,hash('5'),{recordCount:1}]);
  await pool.query(`INSERT INTO ${s}.projection_records(environment,chain_id,deployment_digest,scope,revision,identity,sort_key,payload_digest,payload) VALUES('test',46630,$1,'markets',$2,'market-1','1',$3,'{}')`,[deployment.deploymentDigest,`2:${second}`,hash('6')]);
  assert.equal(await applyCoreMigration(pool,schemaName),true);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.projection_records WHERE scope='configs'`)).rows[0].count),0,'legacy config rows are removed from the old heap');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.projection_records WHERE scope='markets'`)).rows[0].count),1,'other scopes remain in projection_records');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.config_contents`)).rows[0].count),2);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.config_publication_sets`)).rows[0].count),2);
  for(const revision of [`1:${first}`,`2:${second}`]){
   const page=await readPublishedConfigPage({pool,deployment,kind:'asset',revision,secret,schemaName});
   assert.deepEqual(page.items,[asset.payload],`legacy data remains queryable at ${revision}`);
  }
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.projection_read_records WHERE scope='markets' AND identity='market-1'`)).rows[0].count),1);
  assert.equal(await applyCoreMigration(pool,schemaName),false,'migration rerun is a no-op');
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`).catch(()=>undefined);await pool.end();}
});
