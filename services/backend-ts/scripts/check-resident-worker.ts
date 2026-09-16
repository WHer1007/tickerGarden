import {Pool} from 'pg';
import {migrationManifest} from '../packages/db/src/migrations.ts';
const url=process.env.TG_PIPELINE_DATABASE_URL,schema=process.env.TG_DATABASE_SCHEMA??'tickergarden_serverless';
if(!url||!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('valid database connection/schema required');
const expected=process.env.TG_PIPELINE_GENERATION;if(!expected||!/^\d+$/.test(expected))throw Error('TG_PIPELINE_GENERATION required');
const pool=new Pool({connectionString:url,max:1});
try{
 const migrations=(await pool.query(`SELECT version,digest FROM "${schema}".schema_migrations`)).rows;
 for(const item of migrationManifest())if(!migrations.some(r=>r.version===item.version&&r.digest===item.digest))throw Error(`migration mismatch: ${item.version}`);
 const mode=(await pool.query(`SELECT active_generation,execution_mode FROM "${schema}".queue_generations WHERE queue='chain'`)).rows[0];
 if(mode?.execution_mode!=='resident'||String(mode.active_generation)!==expected)throw Error('resident mode/generation not active');
 const healthUrl=process.env.TG_WORKER_HEALTH_URL??'http://127.0.0.1:8082/healthz';
 const health=await fetch(healthUrl,{signal:AbortSignal.timeout(5000)});const state=await health.json() as Record<string,unknown>;
 if(!health.ok||state.ready!==true||state.stopping!==false)throw Error('worker unhealthy');
 const jobs=(await pool.query(`SELECT state,count(*)::int n,min(created_at) oldest FROM "${schema}".jobs WHERE queue='chain' AND generation=$1 GROUP BY state`,[expected])).rows;
 if(jobs.some(r=>r.state==='dead'&&r.n>0))throw Error('dead chain jobs require reconciliation');
 console.log(JSON.stringify({ok:true,mode,jobs,state}));
}finally{await pool.end();}
