import test from 'node:test';
import assert from 'node:assert/strict';
import {builtCssPath,configureResourceRecovery,cssFailurePath,recoverStylesheet,resourceContext,recoverInitialStylesheets,withCssRecovery} from '../src/routing/resource-recovery.ts';

test('CSS recovery shares one retry, preserves import result, reports only final failure, strips private URL data',async()=>{
 const originals=new Map(['document','location','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let initial:Array<{href:string;sheet:unknown}>=[];
 const links:Array<EventTarget&{href:string;rel:string;dataset:Record<string,string>;remove:()=>void}>=[];let fail=false;const reports:Array<{error:Error;fields:unknown}>=[];
 class Link extends EventTarget{href='';rel='';dataset:Record<string,string>={};remove(){}}
 try{
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://site.example',pathname:'/trade',search:'?wallet=secret'}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',querySelectorAll:()=>initial,createElement:()=>new Link(),head:{appendChild:(link:Link)=>{links.push(link);queueMicrotask(()=>link.dispatchEvent(new Event(fail?'error':'load')));}}}});
  configureResourceRecovery((error,fields)=>reports.push({error,fields}));
  assert.equal(builtCssPath('https://evil.example/assets/x.css'),undefined);assert.equal(builtCssPath('/api/private.css'),undefined);assert.equal(builtCssPath('/assets/x.css?secret=1'),'/assets/x.css');
  assert.equal(cssFailurePath(new Error('business failure')),undefined);
  const a=recoverStylesheet('/assets/one.css'),b=recoverStylesheet('/assets/one.css');assert.equal(a,b);assert.equal(await a,true);assert.equal(links.length,1);assert.equal(reports.length,0);assert.equal(await recoverStylesheet('/assets/one.css'),true);assert.equal(links.length,1);
  let calls=0;assert.equal(await withCssRecovery(async()=>{if(++calls===1)throw Error('Unable to preload CSS for /assets/two.css');return 42;}),42);assert.equal(calls,2);
  fail=true;calls=0;await assert.rejects(withCssRecovery(async()=>{calls++;throw Error('Unable to preload CSS for /assets/three.css');}));assert.equal(calls,1);assert.equal(reports.length,1);await recoverStylesheet('/assets/three.css');assert.equal(reports.length,1);
  assert.deepEqual(resourceContext('/assets/x.css'),{resourcePath:'/assets/x.css',pagePath:'/trade',online:'false',visibility:'visible',retryCount:'1'});
  calls=0;await assert.rejects(withCssRecovery(async()=>{calls++;throw Error('Wallet rejected');}));assert.equal(calls,1);
  fail=false;const before=links.length;
  initial=[{href:'/assets/loaded.css',sheet:{cssRules:[]}},{href:'/assets/initial.css',sheet:{get cssRules(){throw Error('SecurityError');}}},{href:'https://external.example/other.css',sheet:null}];
  recoverInitialStylesheets();await Promise.resolve();assert.equal(links.length,before+1);assert.equal(await recoverStylesheet('/assets/initial.css'),true);
  fail=true;configureResourceRecovery(()=>{throw Error('Reporter failure');});assert.equal(await recoverStylesheet('/assets/reporter.css'),false);
 }finally{for(const [k,v] of originals){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}}
});
