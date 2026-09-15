import {open,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {Pool} from 'pg';
// Export first; no destructive pruning until an off-host copy and restore receipt exist.
const [directory,kind]=process.argv.slice(2);
if(!directory||!['projections','attempts'].includes(kind??''))throw Error('usage: export-retention-archive.ts directory projections|attempts');
const schema=process.env.TG_DATABASE_SCHEMA??'tickergarden_serverless';if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('invalid schema');
const url=process.env.TG_MIGRATION_DATABASE_URL;if(!url)throw Error('TG_MIGRATION_DATABASE_URL required');
const days=Number(process.env.TG_ARCHIVE_AFTER_DAYS??90),reorgBlocks=Number(process.env.TG_ARCHIVE_REORG_BLOCKS??1000);
if(!Number.isSafeInteger(days)||days<30||!Number.isSafeInteger(reorgBlocks)||reorgBlocks<1000)throw Error('archive retention shorter than protected floor');
const pool=new Pool({connectionString:url,max:1});await mkdir(directory,{recursive:true,mode:0o700});
const output=resolve(directory,`${kind}.jsonl`),file=await open(output,'wx',0o600),hash=createHash('sha256');let cursor='',count=0;
try{
 // Hold an MVCC read snapshot so the archive has reproducible membership.
 const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 while(true){
 const source=kind==='projections'?`
 SELECT jsonb_build_array(r.environment,r.chain_id,r.deployment_digest,r.scope,r.revision,r.identity)::text key,to_jsonb(r) payload
 FROM "${schema}".projection_records r JOIN "${schema}".publications p USING(environment,chain_id,deployment_digest,scope,revision)
 WHERE p.published_at<now()-($1*interval '1 day') AND p.block_number<(SELECT max(b.number)-$2 FROM "${schema}".chain_blocks b WHERE b.environment=p.environment AND b.chain_id=p.chain_id AND b.deployment_digest=p.deployment_digest AND b.canonical AND b.finalized)
 AND NOT EXISTS(SELECT 1 FROM "${schema}".publication_pointers x WHERE x.environment=r.environment AND x.chain_id=r.chain_id AND x.deployment_digest=r.deployment_digest AND x.scope=r.scope AND x.revision=r.revision)
 AND (r.environment,r.chain_id,r.deployment_digest,r.scope,r.revision,r.identity)>($3::text,$4::bigint,$5::text,$6::text,$7::text,$8::text) ORDER BY r.environment,r.chain_id,r.deployment_digest,r.scope,r.revision,r.identity LIMIT 250`:`
 SELECT a.id::text key,to_jsonb(a) payload FROM "${schema}".job_attempts a JOIN "${schema}".jobs j ON j.id=a.job_id
 WHERE j.state='succeeded' AND a.finished_at<now()-($1*interval '1 day') AND $2::bigint>=1000 AND a.id>$3::bigint ORDER BY a.id LIMIT 250`;
 const pageArgs=kind==='projections'?[days,reorgBlocks,...(cursor?JSON.parse(cursor):['',0,'','','',''])]:[days,reorgBlocks,cursor||'0'];
 const rows=(await client.query<{key:string;payload:unknown}>(source,pageArgs)).rows;
 if(!rows.length)break;
 const text=rows.map(r=>JSON.stringify(r)+'\n').join('');await file.write(text);hash.update(text);count+=rows.length;cursor=rows.at(-1)!.key;
 }
 await client.query('COMMIT');}finally{client.release();}
 await file.sync();await file.close();
 await writeFile(resolve(directory,`${kind}.manifest.json`),JSON.stringify({schemaVersion:1,kind,records:count,sha256:hash.digest('hex'),afterDays:days,reorgBlocks,createdAt:new Date().toISOString(),pruned:false,offHostVerified:false,restoreVerified:false},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({exported:count,kind,pruned:false}));
}catch(e){await file.close().catch(()=>{});throw e;}finally{await pool.end();}
