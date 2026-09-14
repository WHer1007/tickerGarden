import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabasePool} from '../../packages/db/src/index.ts';
const url=process.env.TG_TEST_DATABASE_URL;
test('terminated owned idle database connection is discarded and the pool reconnects',{timeout:10000},async ctx=>{
 if(!url){ctx.skip('local PostgreSQL required');return;}
 const {pool}=createDatabasePool(url,{max:1}),admin=createDatabasePool(url,{max:1}).pool;
 try{
  const client=await pool.connect();const pid=Number((await client.query('SELECT pg_backend_pid() pid')).rows[0].pid);client.release();
  const disconnected=new Promise<void>(resolve=>pool.once('error',()=>resolve()));
  assert.equal((await admin.query('SELECT pg_terminate_backend($1) terminated',[pid])).rows[0].terminated,true);
  await disconnected;
  const next=(await pool.query('SELECT pg_backend_pid() pid,1 value')).rows[0];assert.notEqual(Number(next.pid),pid);assert.equal(next.value,1);
 }finally{await pool.end();await admin.end();}
});
