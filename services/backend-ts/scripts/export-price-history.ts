import {createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {createDatabasePool} from '../packages/db/src/index.ts';

// Explicit destination; never print price history or credentials to the terminal.
const output=process.argv[2],schema=process.env.TG_DATABASE_SCHEMA??'tickergarden_serverless';
if(!output?.endsWith('.ndjson.gz')||!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('Usage: export-price-history.ts <new-file.ndjson.gz>');
const connection=process.env.TG_MIGRATION_DATABASE_URL;
if(!connection)throw Error('TG_MIGRATION_DATABASE_URL is required');
const pool=createDatabasePool(connection,{max:1}).pool;
const client=await pool.connect();let rows=0,created=false;
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query(`DECLARE price_history_export NO SCROLL CURSOR FOR SELECT row_to_json(p) AS record FROM "${schema}".price_references p`);
 const file=createWriteStream(output,{flags:'wx',mode:0o600});file.on('open',()=>{created=true;});
 async function* records(){
  for(;;){const batch=await client.query('FETCH FORWARD 1000 FROM price_history_export');if(!batch.rows.length)break;
   for(const row of batch.rows){rows++;yield JSON.stringify({event:'price_reference_archive',...row.record})+'\n';}
  }
 }
 await pipeline(Readable.from(records()),createGzip(),file);
 await client.query('COMMIT');
 console.info(JSON.stringify({event:'price_history_export_complete',rows,output}));
}catch(error){
 await client.query('ROLLBACK').catch(()=>{});
 if(created)await unlink(output).catch(()=>{});
 throw error;
}finally{client.release();await pool.end();}
