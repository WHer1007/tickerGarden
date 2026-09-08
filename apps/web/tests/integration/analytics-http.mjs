import {loadWalletAccounts} from '../../src/v1/accounts.ts';
import {validateTradePage} from '../../src/v1/trades.ts';
import {validateCandles} from '../../src/v1/candles.ts';
import {validateSnapshotUpdate} from '../../src/v1/snapshotUpdates.ts';
import {validateUserActivity} from '../../src/v1/userActivity.ts';
import {validateTransactionObservation} from '../../src/v1/transactionObservation.ts';
// Invoked by the Go PostgreSQL integration fixture; all fetches use a real local server.
import assert from 'node:assert/strict';
import {TickerGardenV1Client,TickerGardenApiError} from '../../src/v1/generated/read-api.ts';
import {validateGlobalHolders} from '../../src/v1/globalHolders.ts';
import {validateHolderPage} from '../../src/v1/holders.ts';
import {validateGlobalSeries} from '../../src/v1/globalSeries.ts';
import {validateGlobalStatistics} from '../../src/v1/globalStats.ts';
const [base,mode,market,token]=process.argv.slice(2);
assert.equal(new URL(base).hostname,'127.0.0.1');
const api=new TickerGardenV1Client(base,async(input,init)=>{
 const response=await fetch(input,{...init,signal:AbortSignal.timeout(10000)});
 assert.equal(response.headers.get('cache-control'),'no-store');return response;
});
if(mode==='accounts'||mode==='accounts-unavailable'){
 const expected=JSON.parse(market);
 for(const account of expected.wallets){
  const read=()=>loadWalletAccounts({wallet:account.wallet,sync:expected.sync,assets:expected.assets,signal:AbortSignal.timeout(10000),
   fetchPage:cursor=>api.listUserAccounts({address:account.wallet,revision:expected.sync.revision,limit:1,...(cursor?{cursor}:{})})});
  if(mode==='accounts-unavailable')await assert.rejects(read,e=>e instanceof TickerGardenApiError&&e.status===400&&e.body.error==='invalid_request'&&e.body.sync?.status==='unavailable');
  else assert.deepEqual(await read(),account.items);
 }
}else if(mode==='market-history'||mode==='market-history-unavailable'){
 const identities=JSON.parse(market);
 assert.equal(identities.length,2);
 for(const [index,id] of identities.entries()){
  const other=identities[1-index];
  const trades=()=>api.listMarketTrades({marketId:id.marketId,from:'3600',to:'90000',limit:50});
  const candles=()=>api.getMarketCandles({marketId:id.marketId,interval:'1h',from:'3600',to:'90000'});
  if(mode==='market-history-unavailable'){
   for(const read of [trades,candles])await assert.rejects(read,e=>e instanceof TickerGardenApiError&&e.status===503);
   continue;
  }
  const raw=await trades();
  const p=validateTradePage(raw,4663,id,3600,90000,50);
  assert.equal(p.items.length,1);assert.equal(p.nextCursor,null);
  const trade=p.items[0];assert.equal(trade.actorConfidence,'contract_caller_not_verified_wallet');
  assert.equal(trade.venue,index===0?'curve':'pool');
  assert.equal(trade.classification,index===0?'unclassified':'internal_reward_conversion');
  assert.equal(trade.quoteRaw,index===0?'970000':'10000');
  if(index===0){assert.equal(trade.feeRaw,'10000');assert.equal(trade.taxRaw,'20000');}
  assert.throws(()=>validateTradePage(raw,4663,other,3600,90000,50));
  const rawCandles=await candles();
  const c=validateCandles(rawCandles,4663,id,3600,90000);
  assert.throws(()=>validateCandles(rawCandles,4663,other,3600,90000));
  assert.equal(c.series.candles.length,24);
  assert.equal(c.series.candles[0].tradeCount,1);
  assert.equal(c.series.candles[0].internalTradeCount,index);
  assert.equal(c.series.candles[0].quoteVolumeRaw,trade.quoteRaw);
  for(const empty of c.series.candles.slice(1)){
   assert.equal(empty.tradeCount,0);assert.equal(empty.quoteVolumeRaw,'0');assert.equal(empty.memeVolumeRaw,'0');
   assert.deepEqual([empty.open,empty.high,empty.low,empty.close],[null,null,null,null]);
  }
 }
}else if(mode==='updates'){
 const expected=JSON.parse(market);
 if(expected.code===503){
  await assert.rejects(()=>api.getSnapshotUpdates(expected.since?{since:expected.since}:{}),error=>error instanceof TickerGardenApiError&&error.status===503);
 }else{
  const p=validateSnapshotUpdate(await api.getSnapshotUpdates(expected.since?{since:expected.since}:{}),46630,expected.since||undefined);
  assert.equal(p.mode,expected.mode);assert.equal(p.sync.revision,expected.revision);
  if(p.mode==='reset')assert.deepEqual([...p.invalidated].sort(),['accounts','configs','markets','positions']);
  if(p.mode==='unchanged')assert.deepEqual(p.invalidated,[]);
 }
}else if(mode==='activity'){
 const first=validateUserActivity(await api.listUserActivity({address:market,limit:1}),421614,market,1);
 assert.equal(first.chainId,421614);assert.equal(first.account,market);assert.equal(first.finality,'finalized');assert.equal(first.displayOnly,true);assert.equal(first.items.length,1);assert.equal(first.items[0].arguments.amount,'9');assert.ok(first.nextCursor);
 const second=validateUserActivity(await api.listUserActivity({address:market,limit:1,cursor:first.nextCursor}),421614,market,1,first);
 assert.equal(second.items[0].arguments.amount,'8');assert.equal(second.revision,first.revision);assert.notEqual(second.items[0].id,first.items[0].id);
}else if(mode==='activity-changed'){
 await assert.rejects(()=>api.listUserActivity({address:market,limit:1,cursor:token}),e=>e instanceof TickerGardenApiError&&e.status===409&&e.body.error==='activity_page_changed');
}else if(mode==='holders'){
 const global=validateGlobalHolders(await api.getGlobalHolderCounts(),4663);
 assert.equal(global.positiveAddressCount,1);assert.equal(global.includedAddressCount,1);assert.equal(global.groups[0].binding,'unbound');
 const page=validateHolderPage(await api.listMarketHolders({marketId:market,limit:1}),4663,{marketId:market,memeToken:token},1);
 assert.equal(page.totalSupplyRaw,'100');assert.equal(page.balances[0].balanceRaw,'100');assert.equal(page.nextCursor,null);
 assert.equal(page.sourceBlockHash,global.sourceBlockHash);assert.equal(page.sourceBlockNumber,global.sourceBlockNumber);
}else if(mode==='overview'){
 const p=validateGlobalStatistics(await api.getGlobalStatistics({from:'60',to:'120'}),4663,60,120);
 assert.equal(p.marketCount,2);assert.equal(p.registeredStockCount,1);assert.equal(p.groups.length,2);
 assert.equal(p.groups.find(g=>g.quoteDecimals===6).quoteVolumeRaw,'970000');
 assert.equal(p.groups.find(g=>g.quoteDecimals===18).internalQuoteVolumeRaw,'10000');
 }else if(mode==='series'){
 const p=validateGlobalSeries(await api.getGlobalFlowSeries({interval:'1h',from:'3600',to:'90000'}),4663,3600,90000);
 assert.equal(p.points.length,24);assert.equal(p.points[0].groups.length,2);
 const curve=p.points[0].groups.find(g=>g.quoteDecimals===6),pool=p.points[0].groups.find(g=>g.quoteDecimals===18);
 assert.equal(curve.quoteVolumeRaw,'970000');assert.equal(curve.fees[0].feeRaw,'10000');assert.equal(curve.fees[0].taxRaw,'20000');
 assert.equal(pool.internalQuoteVolumeRaw,'10000');assert.equal(pool.unknownFeeTradeCount,1);
 for(const [index,point] of p.points.entries()){
  assert.equal(point.timestamp,3600+index*3600);assert.equal(point.groups.length,2);
  if(index>0)for(const group of point.groups){assert.equal(group.tradeCount,0);assert.equal(group.quoteVolumeRaw,'0');assert.equal(group.internalQuoteVolumeRaw,'0');assert.deepEqual(group.fees,[]);}
 }
}else if(mode==='series-unavailable'){
 await assert.rejects(()=>api.getGlobalFlowSeries({interval:'1h',from:'3600',to:'90000'}),error=>error instanceof TickerGardenApiError&&error.status===503);
 }else if(mode==='transaction'){
 const p=validateTransactionObservation(await api.getTransactionStatus({txHash:market}),421614,market);
 assert.equal(p.chainId,421614);assert.equal(p.transactionHash,market);assert.equal(p.state,'confirmed');assert.equal(p.confirmations,'1');assert.equal(p.receipt.execution,'reverted');assert.equal(p.orphanedReceipts.length,1);assert.equal(p.receipt.blockHash,'0x'+(503).toString(16).padStart(64,'0'));assert.equal(p.source,'indexed_journal_and_rpc');assert.equal(p.displayOnly,true);
}else if(mode==='transaction-unavailable'){
 await assert.rejects(()=>api.getTransactionStatus({txHash:market}),error=>error instanceof TickerGardenApiError&&error.status===503);
}else if(mode==='unavailable'){
 await assert.rejects(()=>api.getGlobalHolderCounts(),error=>error instanceof TickerGardenApiError&&error.status===503);
}else throw new Error('Unknown integration mode');
console.log(`PASS real Go HTTP + SDK + frontend validation: ${mode}`);
