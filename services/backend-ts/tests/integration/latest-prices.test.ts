import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool,migrationManifest,migrationSql} from '../../packages/db/src/index.ts';
import {latestPrices,preferredPrices} from '../../packages/display-price/src/read.ts';
import {storePriceReferences,type PriceReference} from '../../packages/display-price/src/index.ts';
const connectionString=process.env.TG_MIGRATION_DATABASE_URL;
const hash=`0x${'a'.repeat(64)}` as const,other=`0x${'b'.repeat(64)}` as const;
const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:hash,activationBlock:1n};
const token=`0x${'1'.repeat(40)}` as const;
const at=(seconds:number)=>new Date(Date.UTC(2026,8,20,12)+seconds*1000).toISOString();
function price(observed:number,asOf=observed,status:PriceReference['status']='available',expires=asOf+300):PriceReference{
 return {chainId:46630,token,assetUid:hash,symbol:'TEST',source:'robinhood_rest',unit:'USD_PER_WHOLE_TOKEN',status,bidUsd:status==='available'?'2':null,askUsd:status==='available'?'4':null,multiplier:'1',asOf:at(asOf),expiresAt:at(expires),retrievedAt:at(observed)};
}
test('current prices stay bounded, reject delayed writes, retain fresh values on failure and log each observation',async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const s='tg_current_prices_'+randomBytes(5).toString('hex');const pool=createDatabasePool(connectionString,{max:2}).pool;
 const logs:string[]=[];t.mock.method(console,'info',(line:string)=>logs.push(line));
 try{
 await applyCoreMigration(pool,s);
 for(const h of [hash,other])await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$1,1,$1,$1)`,[h]);
 const write=(p:PriceReference)=>storePriceReferences(pool,d,[p],s);
 await write(price(0));await write(price(10,10,'unavailable'));
 let rows=await latestPrices(pool,d,new Date(at(10)),s);assert.equal(rows.length,1);assert.equal(rows[0]!.payload.asOf,at(0));
 await write(price(5,5)); // delayed response must not overwrite the newer observation fence
 assert.equal((await latestPrices(pool,d,new Date(at(10)),s))[0]!.payload.asOf,at(0));
 await write(price(20));await write(price(20,20,'unavailable')); // duplicate observation is idempotent
 assert.equal((await latestPrices(pool,d,new Date(at(20)),s))[0]!.payload.asOf,at(20));
 await write(price(30,15)); // newer fetch of an older source quote must not regress price time
 assert.equal((await latestPrices(pool,d,new Date(at(30)),s))[0]!.payload.asOf,at(20));
 await write(price(320,320,'unavailable')); // exact expiry no longer protects prior success
 assert.equal((await latestPrices(pool,d,new Date(at(320)),s))[0]!.payload.status,'unavailable');
 await write(price(330));
 await Promise.all([write(price(340)),write(price(350))]);
 assert.equal((await latestPrices(pool,d,new Date(at(350)),s))[0]!.payload.asOf,at(350));
 for(let i=351;i<451;i++)await write(price(i));
 // A broken member must not partially publish the batch; observations still enter logs.
 const beforeBatch=(await latestPrices(pool,d,new Date(at(450)),s))[0]!.payload;
 await assert.rejects(storePriceReferences(pool,d,[price(500),{...price(500),token:`0x${'2'.repeat(40)}`,expiresAt:at(499)}],s),{code:'23514'});
 assert.deepEqual((await latestPrices(pool,d,new Date(at(450)),s))[0]!.payload,beforeBatch);
 assert.ok(logs.some(l=>JSON.parse(l).token===`0x${'2'.repeat(40)}`));
 await storePriceReferences(pool,{...d,deploymentDigest:other},[price(500)],s);
 await write({...price(450),source:'coinbase_spot'});
 rows=await latestPrices(pool,d,new Date(at(450)),s);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.payload.source),['coinbase_spot','robinhood_rest']);
 assert.equal(Number((await pool.query(`SELECT count(*) FROM ${s}.price_references`)).rows[0].count),3);
 assert.equal(preferredPrices(rows,new Date(at(750))).get(token)?.status,'stale');
 assert.ok(logs.length>100);assert.ok(logs.some(l=>JSON.parse(l).status==='unavailable'));assert.ok(logs.every(l=>JSON.parse(l).event==='price_reference'));
 await pool.query(`DELETE FROM ${s}.price_references WHERE deployment_digest=$1`,[hash]);assert.deepEqual(await latestPrices(pool,d,new Date(at(750)),s),[]);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
test('0028 compacts legacy history transactionally and migration rerun is a no-op',async t=>{
 if(!connectionString){t.skip('local PostgreSQL required');return;}
 const s='tg_price_migration_'+randomBytes(5).toString('hex');const pool=createDatabasePool(connectionString,{max:1}).pool;
 try{
 for(const m of migrationManifest().filter(m=>m.version<'0028_current_prices')){await pool.query(migrationSql(s,m.version));await pool.query(`UPDATE ${s}.schema_migrations SET digest=$1 WHERE version=$2`,[m.digest,m.version]);}
 await pool.query(`INSERT INTO ${s}.deployments(environment,chain_id,deployment_digest,genesis_hash,start_block,start_block_hash,abi_digest) VALUES('test',46630,$1,$1,1,$1,$1)`,[hash]);
 await pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,as_of,expires_at,payload) SELECT 'test',46630,$1,$2,'robinhood_rest','available',now()-n*interval '1 minute',now()-(n-5)*interval '1 minute',jsonb_build_object('n',n) FROM generate_series(1,20000)n`,[hash,token]);
 await pool.query(`INSERT INTO ${s}.price_references(environment,chain_id,deployment_digest,asset,source,status,as_of,expires_at,payload) VALUES('test',46630,$1,$2,'robinhood_rest','unavailable',now(),now()+interval '1 second','{"failed":true}')`,[hash,token]);
 assert.equal(await applyCoreMigration(pool,s),true);
 const rows=(await pool.query(`SELECT payload,observed_at,as_of FROM ${s}.price_references`)).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].payload.n,1);assert.ok(rows[0].observed_at>rows[0].as_of);
 assert.equal(await applyCoreMigration(pool,s),false);
 await assert.rejects(pool.query(`INSERT INTO ${s}.price_references SELECT * FROM ${s}.price_references`),{code:'23505'});
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);await pool.end();}
});
