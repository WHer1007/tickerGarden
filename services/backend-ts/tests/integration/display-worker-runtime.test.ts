import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:http';import {randomBytes} from 'node:crypto';
import {applyCoreMigration,createDatabasePool} from '../../packages/db/src/index.ts';
import {priceBatchChannel} from '../../packages/display-price/src/batch.ts';
import {changeChannel} from '../../packages/confirmed-display/src/changes.ts';
import {displayWakeChannel} from '../../packages/confirmed-display/src/wake.ts';
import {runtimeReleaseId,runtimeActivationBlock} from '../../packages/runtime-deployment/src/index.ts';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('real worker startup, 30-second idle timeout, price push, recovery hint and health checks make zero RPC requests',{timeout:60000},async()=>{
 const schemaName=`tg_idle_${process.pid}_${randomBytes(4).toString('hex')}`,pool=createDatabasePool('postgresql:///postgres?host=/tmp',{max:2}).pool;
 let calls=0;const upstream=createServer((_req,res)=>{calls++;res.writeHead(500).end();});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const d={environment:'test' as const,chainId:46630 as const,deploymentDigest:runtimeReleaseId,activationBlock:runtimeActivationBlock};
 let child:ReturnType<typeof spawn>|undefined;let output='';
 try{
  await applyCoreMigration(pool,schemaName);
  child=spawn(process.execPath,['--experimental-strip-types','scripts/confirmed-display-worker.ts'],{cwd:process.cwd(),env:{PATH:process.env.PATH,USER:process.env.USER,TG_ENVIRONMENT:'test',TG_CHAIN_ID:'46630',TG_PIPELINE_DATABASE_URL:'postgresql:///postgres?host=/tmp',TG_DATABASE_SCHEMA:schemaName,TG_RPC_URL:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`,TG_DISPLAY_HEALTH_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',v=>output+=v);child.stderr?.on('data',v=>output+=v);
  const health=()=>fetch(`http://127.0.0.1:${port}/healthz`);
  let ready=false;for(let i=0;i<100;i++){try{if((await health()).ok){ready=true;break;}}catch{}await delay(50);}
  assert.ok(ready,output);assert.equal(calls,0);
  assert.equal((await (await health()).json()).synchronized,false);
  const disconnected=await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query=$1 AND pid<>pg_backend_pid()',[`LISTEN ${changeChannel(d,schemaName)}`]);
  assert.equal(disconnected.rowCount,1,'terminate only this test worker listener');
  await delay(500);assert.equal((await health()).status,200,'listener reconnects without chain traffic');assert.equal(calls,0);
  await pool.query('SELECT pg_notify($1,$2)',[priceBatchChannel(d,schemaName),'1']);
  await pool.query('SELECT pg_notify($1,$2)',[displayWakeChannel(d,schemaName),'recover']);
  await delay(32000);
  const response=await health();assert.equal(response.status,200);const state=await response.json();assert.equal(state.mode,'push-only');assert.equal(state.coverage,'gap');assert.equal(calls,0,output);
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await Promise.race([exited,delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  await new Promise<void>(r=>upstream.close(()=>r()));await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);await pool.end();
 }
});
