import assert from 'node:assert/strict';
import {test} from 'node:test';
import {detailRegions,parseMarketChange,watchMarketChanges} from '../src/v1/marketChanges.ts';

const market='0x'+'1'.repeat(64);

test('market change parsing validates identity and regions, and watcher coalesces and recovers',async t=>{
 assert.deepEqual(parseMarketChange(JSON.stringify({marketId:market,regions:['market','chart','market']}),market),['market','chart']);
 assert.deepEqual(parseMarketChange(JSON.stringify({marketId:'0x'+'2'.repeat(64),regions:['market']}),market),[]);
 assert.deepEqual(parseMarketChange('{malformed',market),[]);
 assert.deepEqual(parseMarketChange(JSON.stringify({marketId:market,regions:['market','not-a-region',3,null]}),market),['market']);
 assert.deepEqual(parseMarketChange(JSON.stringify({marketId:market,regions:Array(8).fill('market')}),market),[]);

 const descriptors=new Map<string,PropertyDescriptor|undefined>();
 const remember=(key:string)=>descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of ['document','navigator','window','EventSource','setTimeout','clearTimeout','setInterval','clearInterval'])remember(key);
 const timers:{id:number;delay:number;run:()=>void;cancelled:boolean;interval:boolean}[]=[];
 let timerId=0;
 const schedule=(delay:number,run:()=>void,interval=false)=>{const item={id:++timerId,delay,run,cancelled:false,interval};timers.push(item);return item.id;};
 const runDelay=(delay:number)=>{for(const item of timers.filter(item=>item.delay===delay&&!item.cancelled)){if(!item.interval)item.cancelled=true;item.run();}};
 const clear=(id:number)=>{const item=timers.find(item=>item.id===id);if(item)item.cancelled=true;};
 class FakeSource extends EventTarget {
  static instances:FakeSource[]=[];
  closed=false;
  readonly url:string;
  constructor(url:string){super();this.url=url;FakeSource.instances.push(this);}
  close(){this.closed=true;}
  change(data:string){this.dispatchEvent(Object.assign(new Event('change'),{data}));}
 }
 class FakeDocument extends EventTarget {hidden=false;}
 const doc=new FakeDocument(),win=new EventTarget();
 Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 Object.defineProperty(globalThis,'window',{value:win,configurable:true});
 Object.defineProperty(globalThis,'EventSource',{value:FakeSource,configurable:true});
 Object.defineProperty(globalThis,'setTimeout',{value:(fn:()=>void,delay=0)=>schedule(delay,fn),configurable:true});
 Object.defineProperty(globalThis,'clearTimeout',{value:clear,configurable:true});
 Object.defineProperty(globalThis,'setInterval',{value:(fn:()=>void,delay=0)=>schedule(delay,fn,true),configurable:true});
 Object.defineProperty(globalThis,'clearInterval',{value:clear,configurable:true});
 t.after(()=>{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});

 const observed:string[][]=[];
 const watcher=watchMarketChanges('/api/',market,async regions=>{observed.push([...regions]);});
 assert.equal(FakeSource.instances[0]?.url,`/api/v1/markets/${market}/events`);
 const source=FakeSource.instances[0]!;
 source.change(JSON.stringify({marketId:market,regions:['market','chart']}));
 source.change(JSON.stringify({marketId:market,regions:['chart','trades']}));
 runDelay(120);await Promise.resolve();await Promise.resolve();
 assert.deepEqual(observed,[['market','chart','trades']]);
 assert.ok(timers.some(item=>item.interval&&item.delay===60_000));

 // The bounded fallback invalidates all regions even if the stream was quiet.
 runDelay(60_000);runDelay(120);await Promise.resolve();await Promise.resolve();
 assert.deepEqual(observed[1],detailRegions);

 source.change(JSON.stringify({marketId:market,regions:['fees']}));
 watcher.stop();runDelay(120);await Promise.resolve();
 assert.equal(observed.length,2);
 assert.equal(source.closed,true);
 assert.ok(timers.filter(item=>item.interval).every(item=>item.cancelled));
});
