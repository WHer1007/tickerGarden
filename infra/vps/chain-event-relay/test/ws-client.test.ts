import assert from 'node:assert/strict';
import test from 'node:test';
import {WsRpcClient} from '../src/ws-client.ts';

class Socket extends EventTarget {
 static OPEN = 1;
 static last: Socket;
 readyState = 1;
 sent: Array<{id:number;method:string}> = [];
 constructor() { super(); Socket.last=this; queueMicrotask(()=>this.dispatchEvent(new Event('open'))); }
 send(raw:string) { this.sent.push(JSON.parse(raw)); }
 close() { this.readyState=3; this.dispatchEvent(new Event('close')); }
 receive(data:unknown) { this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)})); }
}

test('quiet WS consumes no RPC; notifications, close and bounded request timeouts still work', async t=>{
 const original=globalThis.WebSocket;
 globalThis.WebSocket=Socket as unknown as typeof WebSocket;
 t.after(()=>{globalThis.WebSocket=original;});
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const events:unknown[]=[];
 const client=await WsRpcClient.connect('wss://fixture.quiknode.pro',async value=>{events.push(value);});
 const socket=Socket.last;
 t.mock.timers.tick(120_000);
 assert.deepEqual(socket.sent,[],'idle connection must not send eth_blockNumber or any JSON RPC');
 assert.equal(client.closed,false,'silence alone is not a failure');
 socket.receive({method:'eth_subscription',params:{result:{transactionHash:'event'}}});
 await Promise.resolve();
 assert.deepEqual(events,[{transactionHash:'event'}]);
 const request=client.request('eth_chainId',[]);
 await new Promise(resolve=>setImmediate(resolve));
 socket.receive({id:socket.sent[0]!.id,result:'0x1237'});
 assert.equal(await request,'0x1237');
 socket.close();
 assert.equal(client.closedSignal.signal.aborted,true);
 const next=await WsRpcClient.connect('wss://fixture.quiknode.pro',async()=>{});
 const timed=next.request('eth_subscribe',['logs',{}]);
 const rejection=assert.rejects(timed,/timeout/);
 await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(15_000);
 await rejection;
 assert.equal(next.closed,true);
 assert.equal(next.pending.size,0);
});
