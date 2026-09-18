import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStatsDisplayUpdater} from '../src/v1/statsUpdates.ts';
import type {StatsSection} from '../src/v1/statsDisplay.ts';

class FakeEvents {
  listeners=new Map<string,Array<(event:MessageEvent<string>)=>void>>();closed=false;
  addEventListener(type:string,listener:(event:MessageEvent<string>)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  close(){this.closed=true;}
  emit(type:string,data=''){for(const listener of this.listeners.get(type)??[])listener({data} as MessageEvent<string>);}
}
const overview=(revision:string,volume:string)=>({schemaVersion:4,chainId:4663,displayOnly:true,revision,sections:{overview:{volumeUsd:volume,feeRevenueUsd:'2',launches24h:1,bloomedMarkets:2,stakingValueUsd:'3',stakingWallets:4}}});
const allocations=(revision:string)=>({schemaVersion:4,chainId:4663,displayOnly:true,revision,sections:{allocations:{creator:'1',staker:'2',holder:'3',platform:'4'}}});
const wait=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
test('named ready reconciles the active sections and named changes union burst regions',async()=>{
 const events=new FakeEvents(),calls:StatsSection[]=[],changed:StatsSection[]=[];
 const updater=createStatsDisplayUpdater({chainId:4663,eventSource:()=>events,debounceMs:5,refreshMs:60_000,getSections:()=>['overview','allocations'],fetcher:async section=>{calls.push(section);return section==='overview'?overview('r1','10'):allocations('r1');},onSection:section=>changed.push(section)});
 updater.start();events.emit('ready');await wait(10);assert.deepEqual(calls,['overview','allocations']);
 await updater.refresh(['overview'],false);assert.deepEqual(calls,['overview','allocations']);
 events.emit('change',JSON.stringify({statsRegions:['overview']}));events.emit('change',JSON.stringify({statsRegions:['allocations']}));await wait();
 assert.deepEqual(calls,['overview','allocations','overview','allocations']);
 assert.deepEqual(changed,['overview','allocations','overview','allocations']);
 assert.equal(updater.snapshot.sections.overview?.volumeUsd,'10');assert.equal(updater.snapshot.sections.allocations?.platform,'4');
 updater.stop();assert.equal(events.closed,true);
});
test('section request during an active read gets one dirty follow-up and errors retain values',async()=>{
 let calls=0,release!:()=>void;
 const updater=createStatsDisplayUpdater({chainId:4663,getSections:()=>['overview'],refreshMs:60_000,fetcher:async()=>{calls++;if(calls===1)await new Promise<void>(resolve=>release=resolve);if(calls===2)throw Error('offline');return overview(`r${calls}`,String(calls));},onSection:()=>{}});
 const first=updater.refresh(['overview'],true);await wait(0);const joined=updater.refresh(['overview'],true);release();await Promise.all([first,joined]);
 assert.equal(calls,2);assert.equal(updater.snapshot.sections.overview?.volumeUsd,'1');updater.stop();
});
test('late response after stop cannot overwrite a newer mounted generation',async()=>{
 const events=new FakeEvents(),responses:Array<(value:unknown)=>void>=[];let calls=0;
 const updater=createStatsDisplayUpdater({chainId:4663,getSections:()=>['overview'],eventSource:()=>events,refreshMs:60_000,fetcher:async()=>{calls++;return new Promise(resolve=>responses.push(resolve));},onSection:()=>{}});
 updater.start();const old=updater.refresh(['overview'],true);await wait(0);updater.stop();updater.start();const fresh=updater.refresh(['overview'],true);await wait(0);
 responses[1]!(overview('new','20'));await fresh;responses[0]!(overview('old','10'));await old;
 assert.equal(calls,2);assert.equal(updater.snapshot.sections.overview?.volumeUsd,'20');updater.stop();
});
test('a timed-out late response cannot replace the last valid section',async()=>{
 let call=0,release!: (value:unknown)=>void;
 const updater=createStatsDisplayUpdater({chainId:4663,getSections:()=>['overview'],refreshMs:60_000,requestTimeoutMs:5,fetcher:async()=>{call++;if(call===1)return overview('r1','9');return new Promise(resolve=>release=resolve);},onSection:()=>{}});
 await updater.refresh(['overview'],true);const pending=updater.refresh(['overview'],true);await wait(10);release(overview('late','2'));await pending;
 assert.equal(call,2);assert.equal(updater.snapshot.sections.overview?.volumeUsd,'9');updater.stop();
});
