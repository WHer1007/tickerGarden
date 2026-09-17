import {createHash} from 'node:crypto';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {DisplayState} from './state.ts';
export const regions=['market','statistics','chart','trades','holders','fees','staking'] as const;
export type DisplayRegion=typeof regions[number];
export function changeChannel(d:DeploymentIdentity,schema='tickergarden_serverless'){
 return 'tg_display_'+createHash('sha256').update(JSON.stringify([schema,d.environment,d.chainId,d.deploymentDigest])).digest('hex').slice(0,32);
}
export function changedRegions(before:DisplayState|null,after:DisplayState):DisplayRegion[]{
 if(!before)return [...regions];
 const changed=(a:unknown,b:unknown)=>JSON.stringify(a)!==JSON.stringify(b);
 const result=new Set<DisplayRegion>();
 if(changed(before.trades,after.trades)){result.add('trades');result.add('chart');result.add('statistics');}
 if(changed(before.balances,after.balances)||before.supply!==after.supply){result.add('holders');result.add('statistics');}
 if(changed(before.fees,after.fees))result.add('fees');
 const a=before.market,b=after.market;
 if(a.display?.totalStakedRaw!==b.display?.totalStakedRaw||a.display?.activeStakeRaw!==b.display?.activeStakeRaw||changed(before.nextRefreshAt,after.nextRefreshAt)){result.add('staking');result.add('fees');}
 // Source stamps alone are not a market change.
 const fields=(m:DisplayState['market'])=>({...m,source:undefined,sourceVersion:undefined,confirmation:undefined,display:m.display?{...m.display,blockNumber:undefined,blockHash:undefined,asOfTimestamp:undefined}:undefined});
 if(changed(fields(a),fields(b)))result.add('market');
 if(a.display?.priceQuote!==b.display?.priceQuote)result.add('statistics');
 return [...result];
}
