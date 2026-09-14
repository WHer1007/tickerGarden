import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {evaluateConnectionBudget,validateDatabasePlacement,connectionRoleLimitsSql,type ConnectionBudgetInput} from '../packages/db/src/connection-budget.ts';
import {createDatabasePool} from '../packages/db/src/index.ts';
const file=process.argv[2];if(!file)throw Error('usage: check-database-runtime.ts <budget.json> [--database]');
if(process.argv[3]!==undefined&&process.argv[3]!=='--database')throw Error('unknown argument');
const budget=JSON.parse(fs.readFileSync(file,'utf8')) as ConnectionBudgetInput;
validateDatabasePlacement({applicationRegion:process.env.TG_APPLICATION_REGION??'',databaseRegion:process.env.TG_DATABASE_REGION??'',workerRegion:process.env.TG_WORKER_REGION??''});
const result:Record<string,unknown>={placement:'declared_singapore',placementEvidence:'operator declaration; verify cloud metadata separately',budget:evaluateConnectionBudget(budget),databaseVerified:false};
if(process.env.TG_DB_ROLE_MAP_JSON)result.roleConnectionLimitsSql=connectionRoleLimitsSql(budget,JSON.parse(process.env.TG_DB_ROLE_MAP_JSON));
if(process.argv[3]==='--database'){
 const url=process.env.TG_DATABASE_PREFLIGHT_URL;if(!url)throw Error('TG_DATABASE_PREFLIGHT_URL is required');
 const pool=createDatabasePool(url,{max:1}).pool;
 try{
  const settings=(await pool.query(`SELECT current_setting('max_connections')::int max_connections,current_setting('superuser_reserved_connections')::int superuser_reserved_connections,(SELECT count(*)::int FROM pg_stat_activity) connections,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) tls`)).rows[0];
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)&&settings.tls!==true)throw Error('remote database connection must use TLS');
  if(settings.max_connections!==budget.maxConnections)throw Error('configured maxConnections differs from PostgreSQL');
  if(budget.reservedConnections<settings.superuser_reserved_connections)throw Error('reserved budget is below PostgreSQL reserved connections');
  const times:number[]=[];for(let i=0;i<10;i++){const start=performance.now();await pool.query('SELECT 1');times.push(performance.now()-start);}times.sort((a,b)=>a-b);
  Object.assign(result,{databaseVerified:true,database:settings,rttMs:{p50:times[4],max:times[9]},note:'RTT measured from this command host, not automatically from Vercel; instance caps must be enforced separately'});
 }finally{await pool.end();}
}
console.log(JSON.stringify(result,null,2));
