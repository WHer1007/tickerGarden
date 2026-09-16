import v1Abis_TickerGardenFactoryV1 from '../v1/generated/contracts/legacy/TickerGardenFactoryV1.ts';
import {decodeEventLog,type TransactionReceipt} from 'viem';

import type {LaunchState} from './launch-state.ts';
/** Receipt-only confirmation: never scans blocks or sends a wallet request. */
export function assertRecoveredLaunchReceipt(state:LaunchState,receipt:Pick<TransactionReceipt,'status'|'from'|'to'|'logs'>):void{
 const e=state.expected;
 const target=state.intent?JSON.parse(state.intent)[0]:null;
 if(!e||receipt.status!=='success'||receipt.from.toLowerCase()!==state.account.toLowerCase()||!target||receipt.to?.toLowerCase()!==target)throw Error('Receipt does not match this launch');
 for(const log of receipt.logs){
  if(log.address.toLowerCase()!==e.factory.toLowerCase())continue;
  try{
   const decoded=decodeEventLog({abi:v1Abis_TickerGardenFactoryV1,data:log.data,topics:log.topics});
   if(decoded.eventName!=='MarketCreated')continue;
   const args=decoded.args as Record<string,unknown>;
   if(['marketId','curve','gauge'].every(k=>String(args[k]).toLowerCase()===e[k as 'marketId'].toLowerCase())&&String(args.memeToken).toLowerCase()===e.token.toLowerCase())return;
  }catch{/* Ignore unrelated logs; require the expected factory event below. */}
 }
 throw Error('Expected Factory MarketCreated event was not found');
}
