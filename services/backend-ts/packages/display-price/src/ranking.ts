import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {PriceBatch} from './batch.ts';
import {publishExploreRanking} from '../../confirmed-display/src/explore-ranking.ts';
export const CAP_INTERVAL_MS=20*60*1000;
/** Compatibility entry point; consumes persisted cards, never recalculates prices. */
export async function publishMarketCapRanking(pool:Pool,d:DeploymentIdentity,schemaName='tickergarden_serverless',now=new Date(),_batch?:PriceBatch){
 const client=await pool.connect();try{return {published:await publishExploreRanking(client,d,schemaName,now)};}finally{client.release();}
}
