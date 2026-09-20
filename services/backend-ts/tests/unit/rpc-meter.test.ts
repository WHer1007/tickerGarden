import assert from 'node:assert/strict';import test from 'node:test';
import {summarizeRpcUsage} from '../../packages/rpc-control/src/meter.ts';
test('usage separates wire attempts, retry, cache reuse, coalescing and WS delivered frames without double counting',()=>{
 const rows=summarizeRpcUsage([
  {event:'rpc_usage',service:'worker',provider:'quicknode',method:'eth_call',transport:'http',networkCalls:1,attempt:1,outcome:'failed'},
  {event:'rpc_usage',service:'worker',provider:'alchemy',method:'eth_call',transport:'http',networkCalls:1,attempt:2,outcome:'succeeded'},
  {event:'rpc_call',service:'worker',provider:'quicknode',method:'eth_call',reuse:'shared',attempt:0},
  {event:'rpc_usage',service:'worker',provider:'quicknode',method:'eth_call',networkCalls:0,outcome:'succeeded'},
  {event:'rpc_usage',service:'worker',provider:'quicknode',method:'eth_call',reuse:'coalesced',networkCalls:0},
  {event:'rpc_usage',service:'worker',provider:'quicknode',method:'eth_call',transport:'http',networkCalls:0,outcome:'budget_denied'},
  {event:'chain_relay_ws_request',service:'relay',provider:'quicknode',method:'eth_blockNumber',networkCalls:1},
  {event:'chain_relay_ws_frame',service:'relay',provider:'quicknode',wsMessages:1,receivedBytes:128},
  {event:'chain_relay_ws_notification',service:'relay',outcome:'received',deliveredBytes:128},
  {event:'chain_relay_ws_notification',service:'relay',outcome:'delivered',deliveredBytes:128},
 ]);
 assert.equal(rows.reduce((n,r)=>n+r.httpRequests,0),2);assert.equal(rows.reduce((n,r)=>n+r.retries,0),1);
 assert.equal(rows.reduce((n,r)=>n+r.cacheHits,0),1);assert.equal(rows.reduce((n,r)=>n+r.coalesced,0),1);
 assert.equal(rows.reduce((n,r)=>n+r.wsMessages,0),1);assert.equal(rows.reduce((n,r)=>n+r.wsRequests,0),1);
 assert.equal(rows.reduce((n,r)=>n+r.budgetDenied,0),1);
});
