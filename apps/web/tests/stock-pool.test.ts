import assert from 'node:assert/strict';
import test from 'node:test';
import {stockPurchasePool} from '../src/trade/stock-pool.ts';
import {routes} from '../../../services/backend-ts/packages/chain/src/quote-purchase/routes.ts';
test('every reviewed Stock links to its recorded pool and correct version',()=>{
 for(const [token,route] of Object.entries(routes)){
  const link=stockPurchasePool(4663,token.toUpperCase().replace('0X','0x'));
  assert.ok(link);assert.equal(link.version,route.version.toUpperCase());
  const url=new URL(link.url);assert.equal(url.origin,'https://app.uniswap.org');assert.equal(url.pathname,`/explore/pools/robinhood/${route.pool}`);
 }
});
test('unknown assets and testnet never receive invented mainnet pool links',()=>{
 const token=Object.keys(routes)[0]!;
 assert.equal(stockPurchasePool(46630,token),null);
 for(const value of ['ETH','<script>',`0x${'0'.repeat(40)}`,`0x${'f'.repeat(40)}`])assert.equal(stockPurchasePool(4663,value),null);
});
