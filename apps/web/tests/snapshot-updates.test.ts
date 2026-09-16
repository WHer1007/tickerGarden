import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSnapshotPoller, validateSnapshotUpdate, SnapshotRefreshSuperseded } from '../src/v1/snapshotUpdates.ts';
const rev=(n:number)=>`${n}:0x${'1'.repeat(64)}`;
const update=(n=1)=>({mode:'reset',pollAfterMs:5000,invalidated:['markets','configs','positions','accounts'],sync:{chainId:4663,status:'synced',finality:'finalized',blockNumber:String(n),blockHash:`0x${'1'.repeat(64)}`,revision:rev(n),headBlockNumber:null,headBlockHash:null,lagBlocks:null}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('updates require finalized identity and coherent cache semantics',()=>{
 assert.equal(validateSnapshotUpdate(update(),4663).mode,'reset');
 for(const value of [{...update(),invalidated:[]},{...update(),mode:'unchanged',invalidated:[]},{...update(),mode:'changed'},{...update(),sync:{...update().sync,finality:'head'}},{...update(),sync:{...update().sync,revision:rev(2)}},{...update(),invalidated:['markets','markets','positions']}]) assert.throws(()=>validateSnapshotUpdate(value,4663));
});
test('reconnect rejects late prepared data and advances only after commit',async(t)=>{
 const pending:Array<(commit:()=>void)=>void>=[];let applied=0;let counter=0;
 const poller=createSnapshotPoller({chainId:4663,fetchUpdate:async()=>update(++counter),prepare:()=>new Promise(resolve=>pending.push(resolve)),unavailable:()=>assert.fail('unexpected failure')});
 t.after(()=>poller.stop());poller.start();await tick();assert.equal(poller.revision,undefined);
 poller.reconnect();await tick();pending[0]!(()=>{applied=1});await tick();assert.equal(applied,0);
 pending[1]!(()=>{applied=2});await tick();assert.equal(applied,2);assert.equal(poller.revision,rev(2));
});
test('failure retains revision and unchanged recovery refetches all caches',async(t)=>{
 let fail=false;let first=true;let failures=0;const modes:string[]=[];const requested:(string|undefined)[]=[];
 const poller=createSnapshotPoller({chainId:4663,fetchUpdate:async(since)=>{requested.push(since);if(fail)throw Error('offline');return first?update():{...update(),mode:'unchanged',invalidated:[]};},prepare:async(u)=>{modes.push(u.mode);return()=>{first=false}},unavailable:()=>{failures++}});
 t.after(()=>poller.stop());poller.start();await tick();fail=true;poller.reconnect();await tick();assert.equal(failures,1);assert.equal(poller.revision,rev(1));fail=false;poller.reconnect();await tick();assert.deepEqual(modes,['reset','reset']);assert.deepEqual(requested,[undefined,rev(1),rev(1)]);
});
test('adopting an already rendered revision polls without a recovery reset',async(t)=>{
 let prepares=0;const requested:(string|undefined)[]=[];
 const poller=createSnapshotPoller({chainId:4663,fetchUpdate:async(since)=>{requested.push(since);return {...update(),mode:'unchanged',invalidated:[]};},prepare:async()=>{prepares++;return()=>{}},unavailable:()=>assert.fail('unexpected failure')});
 t.after(()=>poller.stop());poller.adoptRevision(rev(1));await tick();
 assert.deepEqual(requested,[rev(1)]);assert.equal(prepares,0);assert.equal(poller.revision,rev(1));
});
test('a new revision with unchanged publication digests advances without refetching caches',async(t)=>{
 let prepares=0;
 const poller=createSnapshotPoller({chainId:4663,fetchUpdate:async()=>({...update(2),mode:'changed',invalidated:[]}),prepare:async()=>{prepares++;return()=>{}},unavailable:()=>assert.fail('unexpected failure')});
 t.after(()=>poller.stop());poller.adoptRevision(rev(1));await tick();
 assert.equal(prepares,0);assert.equal(poller.revision,rev(2));
});
test('timeout aborts an uncooperative fetch without committing',async(t)=>{
 let failures=0;
 const poller=createSnapshotPoller({chainId:4663,timeoutMs:5,fetchUpdate:()=>new Promise(()=>{}),prepare:async()=>()=>assert.fail('commit'),unavailable:()=>{failures++}});
 t.after(()=>poller.stop());poller.start();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(failures,1);assert.equal(poller.revision,undefined);
});
test('operation starting during preparation defers commit without clearing healthy state',async(t)=>{
 let allowed=true;let commit=0;let prepared:((f:()=>void)=>void)|undefined;let failures=0;
 const poller=createSnapshotPoller({chainId:4663,canPoll:()=>allowed,fetchUpdate:async()=>update(),prepare:()=>new Promise(resolve=>{prepared=resolve}),unavailable:()=>{failures++}});
 t.after(()=>poller.stop());poller.start();await tick();allowed=false;prepared!(()=>{commit++});await tick();
 assert.equal(commit,0);assert.equal(failures,0);assert.equal(poller.revision,undefined);
 allowed=true;poller.reconnect();await tick();prepared!(()=>{commit++});await tick();assert.equal(commit,1);assert.equal(poller.revision,rev(1));
});
test('operation starting during update fetch skips preparation',async(t)=>{
 let allowed=true;let resolveFetch:((v:unknown)=>void)|undefined;let prepares=0;
 const poller=createSnapshotPoller({chainId:4663,canPoll:()=>allowed,fetchUpdate:()=>new Promise(resolve=>{resolveFetch=resolve}),prepare:async()=>{prepares++;return()=>{}},unavailable:()=>assert.fail('unexpected failure')});
 t.after(()=>poller.stop());poller.start();allowed=false;resolveFetch!(update());await tick();assert.equal(prepares,0);assert.equal(poller.revision,undefined);
});

test('superseded wallet context retries without reporting an API outage',async(t)=>{
 let superseded=true;let failures=0;
 const poller=createSnapshotPoller({chainId:4663,fetchUpdate:async()=>update(),prepare:async()=>()=>{if(superseded)throw new SnapshotRefreshSuperseded('wallet changed')},unavailable:()=>{failures++}});
 t.after(()=>poller.stop());poller.start();await tick();assert.equal(failures,0);assert.equal(poller.revision,undefined);
 superseded=false;poller.reconnect();await tick();assert.equal(poller.revision,rev(1));
});

test('stop then start restores cleared views even when the revision is unchanged',async(t)=>{
 let first=true,visible=false,commits=0;
 const requested:(string|undefined)[]=[];
 const poller=createSnapshotPoller({chainId:4663,
  fetchUpdate:async(since)=>{requested.push(since);return first?update():{...update(),mode:'unchanged',invalidated:[]};},
  prepare:async(value)=>{
   assert.equal(value.mode,'reset');
   assert.deepEqual(value.invalidated,['markets','configs','positions','accounts']);
   return()=>{first=false;visible=true;commits++;};
  },unavailable:()=>assert.fail('unexpected outage')});
 t.after(()=>poller.stop());poller.start();await tick();
 assert.equal(visible,true);assert.equal(commits,1);
 poller.stop();visible=false;poller.start();poller.start();await tick();
 assert.equal(visible,true);assert.equal(commits,2);
 assert.deepEqual(requested,[undefined,rev(1)]);
 assert.equal(poller.revision,rev(1));
});

test('a fetch completed after stop cannot overwrite the restarted generation',async(t)=>{
 const responses:Array<(value:unknown)=>void>=[];const committed:string[]=[];
 const poller=createSnapshotPoller({chainId:4663,
  fetchUpdate:()=>new Promise(resolve=>responses.push(resolve)),
  prepare:async(value)=>()=>{committed.push(value.sync.revision);},
  unavailable:()=>assert.fail('cancelled generation reported an outage')});
 t.after(()=>poller.stop());poller.start();poller.stop();poller.start();
 responses[1]!(update(2));await tick();
 responses[0]!(update(1));await tick();
 assert.deepEqual(committed,[rev(2)]);assert.equal(poller.revision,rev(2));
});

// These values survive JSON transport; string coercion must not admit them.
test('update mode and scopes must be JSON strings, not coercible arrays',()=>{
 for(const value of [
  {...update(),mode:['reset']},
  {...update(),mode:['changed']},
  {...update(),mode:['unchanged']},
  {...update(),invalidated:[['markets'],'configs','positions']},
  {...update(),invalidated:['markets',['configs'],'positions']},
  {...update(),invalidated:['markets','configs',['positions']]},
 ]) assert.throws(()=>validateSnapshotUpdate(JSON.parse(JSON.stringify(value)),4663,rev(1)));
});

test('accounts are required on reset and accepted as the only changed family',()=>{
 assert.throws(()=>validateSnapshotUpdate({...update(),invalidated:['markets','configs','positions']},4663));
 assert.deepEqual(validateSnapshotUpdate({...update(2),mode:'changed',invalidated:['accounts']},4663,rev(1)).invalidated,['accounts']);
 assert.throws(()=>validateSnapshotUpdate({...update(),invalidated:['markets','configs','accounts','accounts']},4663));
});

test('first recent digest seeds the adopted snapshot without duplicate initialization',async(t)=>{
 let prepares=0;
 const poller=createSnapshotPoller({chainId:4663,fetchUpdate:async()=>({...update(),mode:'unchanged',invalidated:[],recentVersion:'a'.repeat(32)}),prepare:async()=>{prepares++;return()=>{}},unavailable:()=>assert.fail('unexpected failure')});
 t.after(()=>poller.stop());poller.adoptRevision(rev(1));await tick();assert.equal(prepares,0);
 poller.reconnect();await tick();assert.equal(prepares,1,'recovery still rebuilds the snapshot');
});
