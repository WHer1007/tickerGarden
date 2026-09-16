import type {ListMarketsParams,MarketReadModel} from './generated/read-api.ts';

const createdAt=(market:MarketReadModel)=>{
 try{return BigInt(market.identity?.deployedAt??market.source.blockNumber);}catch{return 0n;}
};
const compareText=(left:string,right:string)=>left.localeCompare(right,'en',{sensitivity:'base'});
const compareRecent=(left:MarketReadModel,right:MarketReadModel)=>{
 const time=createdAt(right)-createdAt(left);
 return time<0n?-1:time>0n?1:compareText(right.marketId,left.marketId);
};

/** Local integration directory. Production Explore remains Read API only. */
export function pageDirectExplore(
 markets:readonly MarketReadModel[],
 query:Omit<ListMarketsParams,'cursor'|'limit'>,
 cursor:string|undefined,
 limit:number,
):{items:readonly MarketReadModel[];nextCursor:string|null}{
 if(!Number.isSafeInteger(limit)||limit<=0)throw Error('Invalid local market page size');
 const match=query.search?.trim().toLocaleLowerCase('en-US');
 const rows=markets.filter(market=>
  (query.launchPhase===undefined||market.launchPhase===query.launchPhase)&&
  (!query.assetUid||market.assetUid===query.assetUid)&&
  (!query.marketId||market.marketId===query.marketId)&&
  (!query.memeToken||market.memeToken===query.memeToken)&&
  (!match||[market.identity?.name,market.identity?.symbol,market.memeToken].some(value=>value?.toLocaleLowerCase('en-US').includes(match)))
 );
 rows.sort((left,right)=>{
  switch(query.sort){
   case 'marketId_asc':return compareText(left.marketId,right.marketId);
   case 'marketId_desc':return compareText(right.marketId,left.marketId);
   case 'name_asc':return compareText(left.identity?.name??'',right.identity?.name??'')||compareRecent(left,right);
   case 'launchPhase_asc':return left.launchPhase-right.launchPhase||compareRecent(left,right);
   case 'createdAt_asc':return -compareRecent(left,right);
   default:return compareRecent(left,right);
  }
 });
 const parsed=cursor?.match(/^local:(\d+)$/);if(cursor&&!parsed)throw Error('Invalid local market cursor');
 const offset=parsed?Number(parsed[1]):0;if(!Number.isSafeInteger(offset)||offset<0||offset>rows.length)throw Error('Invalid local market cursor');
 const end=Math.min(offset+limit,rows.length);
 return {items:rows.slice(offset,end),nextCursor:end<rows.length?`local:${end}`:null};
}
