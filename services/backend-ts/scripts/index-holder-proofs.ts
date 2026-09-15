import {createDatabasePool} from '../packages/db/src/index.ts';
import {backfillHolderProofIndexes} from '../packages/chain/src/holder-proof-index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../packages/events/src/index.ts';
if(process.env.TG_ENVIRONMENT!=='test')throw Error('This release upgrade targets test only');
const {pool}=createDatabasePool(process.env.TG_PIPELINE_DATABASE_URL??'');
try{const indexed=await backfillHolderProofIndexes(pool,{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},process.env.TG_DATABASE_SCHEMA);console.log(JSON.stringify({indexed}));}finally{await pool.end();}
