import assert from 'node:assert/strict';
import {test} from 'node:test';
import {watchWalletAccount} from '../src/ui/wallet-account-sync.ts';
const a=`0x${'1'.repeat(40)}`,b=`0x${'2'.repeat(40)}`;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('wallet switching invalidates old data immediately and installs authorized new account',async()=>{
 const events=new Map();let account=a;const updates:string[]=[];let invalid=0,disconnected=0;
 const provider={request:async({method}:{method:string})=>method==='eth_chainId'?'0xb626':[account],on:(e:string,f:()=>void)=>events.set(e,f),removeListener:(e:string)=>{events.delete(e);}};
 const stop=watchWalletAccount(provider,46630,{invalidate(){invalid++;},update(v){updates.push(v);},disconnect(){disconnected++;}});
 account=b;events.get('accountsChanged')();assert.equal(invalid,1);await flush();assert.deepEqual(updates,[b]);assert.equal(disconnected,0);
 stop();assert.equal(events.size,0);
});
test('older account responses cannot replace latest account or survive disposal',async()=>{
 const events=new Map();const pending:Array<(v:unknown)=>void>=[];const updates:string[]=[];
 const provider={request:({method}:{method:string})=>method==='eth_chainId'?Promise.resolve('0xb626'):new Promise(resolve=>pending.push(resolve)),on:(e:string,f:()=>void)=>events.set(e,f),removeListener:(e:string)=>{events.delete(e);}};
 const stop=watchWalletAccount(provider,46630,{invalidate(){},update(v){updates.push(v);},disconnect(){assert.fail('Unexpected disconnect');}});
 events.get('accountsChanged')();events.get('accountsChanged')();pending[1]!([b]);await flush();pending[0]!([a]);await flush();assert.deepEqual(updates,[b]);
 events.get('accountsChanged')();stop();pending[2]!([a]);await flush();assert.deepEqual(updates,[b]);
});
test('revoked accounts and wrong networks remain disconnected',async()=>{
 for(const [chain,accounts] of [['0xb626',[]],['0x1',[a]]] as const){
 const events=new Map();let disconnected=false;
 const provider={request:async({method}:{method:string})=>method==='eth_chainId'?chain:accounts,on:(e:string,f:()=>void)=>events.set(e,f)};
 const stop=watchWalletAccount(provider,46630,{invalidate(){},update(){assert.fail('Must not connect');},disconnect(){disconnected=true;}});
 events.get('accountsChanged')();await flush();assert.equal(disconnected,true);stop();
 }
});
