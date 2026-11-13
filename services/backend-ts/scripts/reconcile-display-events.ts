import {createDatabasePool} from '../packages/db/src/pool.ts';
import {reconcileRecordedEvents} from '../packages/confirmed-display/src/recovery.ts';
// One operator invocation, private database inputs on stdin; no configuration or RPC discovery.
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error('Recovery configuration too large');}
const config=JSON.parse(raw),args=process.argv.slice(2);
if(!['--plan','--apply'].includes(args[0]??'')||args.length!==(args[0]==='--apply'?2:1))throw Error('Use --plan or --apply <reviewed-plan-digest>');
const databaseEnv=Object.fromEntries(['TG_DB_CA_PEM','TG_DB_CLIENT_CERT_PEM','TG_DB_CLIENT_KEY_PEM'].filter(k=>config.databaseEnv?.[k]).map(k=>[k,config.databaseEnv[k]]));
const relay=createDatabasePool(config.relayDatabase,{max:1,connectionTimeoutMillis:3000},{role:'display-recovery-relay',env:databaseEnv}).pool;
const source=createDatabasePool(config.sourceDatabase,{max:1,connectionTimeoutMillis:3000},{role:'display-recovery-source',env:databaseEnv}).pool;
try{console.log(JSON.stringify(await reconcileRecordedEvents({relay,source,identity:config.identity,schema:config.schema,...(args[0]==='--apply'?{expectedPlanDigest:args[1]}:{})})));}
finally{await Promise.all([relay.end(),source.end()]);}
