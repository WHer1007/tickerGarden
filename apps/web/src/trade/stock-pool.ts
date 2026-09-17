import {routes} from '../../../../services/backend-ts/packages/chain/src/quote-purchase/routes.ts';

// Use only pools recorded by the mainnet route review. Never construct a pool
// from a ticker, and never send a testnet asset to a mainnet trading screen.
export function stockPurchasePool(chainId:number,token:string){
 if(chainId!==4663||!/^0x[0-9a-f]{40}$/i.test(token))return null;
 const route=routes[token.toLowerCase() as keyof typeof routes];
 if(!route||route.output.toLowerCase()!==token.toLowerCase())return null;
 if(!new RegExp(route.version==='v3'?'^0x[0-9a-f]{40}$':'^0x[0-9a-f]{64}$','i').test(route.pool))return null;
 return {version:route.version.toUpperCase(),url:`https://app.uniswap.org/explore/pools/robinhood/${route.pool}`};
}
