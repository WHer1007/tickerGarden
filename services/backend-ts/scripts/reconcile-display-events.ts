import pg from 'pg';
import {reconcileRecordedEvents} from '../packages/confirmed-display/src/recovery.ts';
// One operator invocation, private database inputs on stdin; no configuration or RPC discovery.
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)throw Error('Recovery configuration too large');}
const config=JSON.parse(raw),args=process.argv.slice(2);
if(!['--plan','--apply'].includes(args[0]??'')||args.length!==(args[0]==='--apply'?2:1))throw Error('Use --plan or --apply <reviewed-plan-digest>');
const relay=new pg.Pool({connectionString:config.relayDatabase,max:1,connectionTimeoutMillis:3000});
const source=new pg.Pool({connectionString:config.sourceDatabase,max:1,connectionTimeoutMillis:3000});
try{console.log(JSON.stringify(await reconcileRecordedEvents({relay,source,identity:config.identity,schema:config.schema,...(args[0]==='--apply'?{expectedPlanDigest:args[1]}:{})})));}
finally{await Promise.all([relay.end(),source.end()]);}
