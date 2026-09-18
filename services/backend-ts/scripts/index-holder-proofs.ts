import {createDatabasePool} from '../packages/db/src/index.ts';
import {backfillHolderProofIndexes} from '../packages/chain/src/holder-proof-index.ts';
import {CURRENT_CHAIN_ID} from '../packages/runtime-deployment/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK} from '../packages/events/src/index.ts';
if(!['test','production'].includes(process.env.TG_ENVIRONMENT??''))throw Error('Explicit runtime environment required');
const {pool}=createDatabasePool(process.env.TG_PIPELINE_DATABASE_URL??'');
try{const indexed=await backfillHolderProofIndexes(pool,{environment:process.env.TG_ENVIRONMENT as 'test'|'production',chainId:CURRENT_CHAIN_ID,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},process.env.TG_DATABASE_SCHEMA);console.log(JSON.stringify({indexed}));}finally{await pool.end();}
