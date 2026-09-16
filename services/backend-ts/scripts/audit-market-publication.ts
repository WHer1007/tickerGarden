import { createDatabasePool } from '../packages/db/src/index.ts';
import { auditMarketPublication } from '../packages/projection/src/audit.ts';
import { CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK } from '../packages/events/src/index.ts';
const url=process.env.TG_TEST_DATABASE_URL??process.env.TG_DATABASE_URL;if(!url)throw Error('local database URL required');
if(!['localhost','127.0.0.1','::1'].includes(new URL(url).hostname))throw Error('this audit CLI is local-only');
const revision=process.argv[2];if(!revision)throw Error('revision argument required');
const {pool}=createDatabasePool(url);try{console.log(JSON.stringify(await auditMarketPublication({pool,revision,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:CURRENT_ACTIVATION_BLOCK},...(process.env.TG_DATABASE_SCHEMA?{schemaName:process.env.TG_DATABASE_SCHEMA}:{})})));}finally{await pool.end();}
