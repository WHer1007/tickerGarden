import test from 'node:test';import assert from 'node:assert/strict';import{randomBytes}from'node:crypto';
import{applyCoreMigration,createDatabasePool}from'../../packages/db/src/index.ts';
import{latestPrices}from'../../packages/display-price/src/read.ts';
const connectionString=process.env.TG_MIGRATION_DATABASE_URL;
test('indexed latest prices preserve fresh-first selection, source order and deployment isolation',async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const s='tg_price_seek_'+randomBytes(5).toString('hex');const pool=createDatabasePool(connectionString,{max:1}).pool;
 const hash='0x'+'a'.repeat(64),other='0x'+'b'.repeat(64),d={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash as `0x${string}`,activationBlock:1n};
 const now=new Date('2026-09-20T12:00:00Z');
 try{
 await applyCoreMigration(pool,s);
 for(const h of [hash,other])await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$1,1,$1,$1)`,[h]);
 const insert=async(asset:string,source:string,status:string,age:number,expiry:number,label:string,release=hash)=>pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,as_of,expires_at,payload) VALUES('test',46630,$1,$2,$3,$4,$5,$6,$7)`,[release,asset,source,status,new Date(+now+age*1000),new Date(+now+expiry*1000),{label}]);
 await insert('a','source-a','available',-120,60,'older-fresh');await insert('a','source-a','unavailable',-30,60,'newer-failure');
 await insert('a','source-b','available',-10,60,'second-source');
 await insert('b','source-a','available',-120,-60,'expired');await insert('b','source-a','unavailable',-30,60,'latest-unavailable');
 await insert('c','source-a','available',-120,-60,'latest-stale');
 await insert('d','source-a','available',-120,0,'expires-exactly-now');await insert('d','source-a','unavailable',-30,60,'expiry-boundary');
 await insert('a','source-a','available',-1,60,'foreign',other);
 await pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,as_of,expires_at,payload) SELECT 'test',46630,$1,'a','source-a','available',$2::timestamptz-n*interval '1 minute',$2::timestamptz-(n-1)*interval '1 minute',jsonb_build_object('history',n) FROM generate_series(100,20100)n`,[hash,now]);
 const rows=await latestPrices(pool,d,now,s);
 const original=(await pool.query(`SELECT DISTINCT ON (asset,source) asset,payload FROM ${s}.price_references WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 ORDER BY asset,source,(status='available' AND expires_at>$4) DESC,as_of DESC`,[d.environment,d.chainId,hash,now])).rows;
 assert.deepEqual(rows,original);assert.deepEqual(rows.map(r=>(r.payload as unknown as {label:string}).label),['older-fresh','second-source','latest-unavailable','latest-stale','expiry-boundary']);
 await pool.query(`DELETE FROM ${s}.price_references WHERE deployment_digest=$1`,[hash]);assert.deepEqual(await latestPrices(pool,d,now,s),[]);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
