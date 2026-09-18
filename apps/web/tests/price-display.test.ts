import test from 'node:test';import assert from 'node:assert/strict';
import {setPriceDisplay} from '../src/ui/compact-price.ts';
function fixture(){
 let selection:any=null;const listeners=new Map<string,Function>();const attrs=new Map<string,string>();
 const child:any={};const node:any={textContent:'',title:'',dataset:{},ownerDocument:{getSelection:()=>selection,addEventListener:(k:string,fn:Function)=>listeners.set(k,fn)},contains:(n:unknown)=>n===child,
 setAttribute:(k:string,v:string)=>attrs.set(k,v),removeAttribute:(k:string)=>attrs.delete(k),addEventListener:(k:string,fn:Function)=>listeners.set(k,fn)};
 child.parentElement={closest:()=>node};
 return {node,attrs,select:(text:string)=>{selection={toString:()=>text,anchorNode:child,focusNode:child};},copy:()=>{let copied='',prevented=false;listeners.get('copy')?.({clipboardData:{setData:(_t:string,v:string)=>{copied=v;}},preventDefault:()=>{prevented=true;}});return {copied,prevented};}};
}
test('compact visible price keeps exact hover/accessibility/copy and follows updates',()=>{
 const f=fixture();setPriceDisplay(f.node,'0.00000000853515',' AAPL / SEED');
 assert.equal(f.node.textContent,'0.0₈853515 AAPL / SEED');assert.equal(f.node.title,'0.00000000853515 AAPL / SEED');assert.equal(f.attrs.get('aria-label'),f.node.title);
 f.select(f.node.textContent);assert.deepEqual(f.copy(),{copied:f.node.title,prevented:true});
 setPriceDisplay(f.node,'0.00000000123456789');f.select(f.node.textContent);assert.equal(f.copy().copied,'0.00000000123456789');
 setPriceDisplay(f.node,null);assert.equal(f.node.title,'');assert.equal(f.attrs.has('aria-label'),false);assert.equal(f.copy().prevented,false);
});
test('copy does not replace a larger table selection or partial price',()=>{
 const f=fixture();setPriceDisplay(f.node,'0.00000000853515');
 for(const s of ['0.0','Time Buy '+f.node.textContent]){f.select(s);assert.deepEqual(f.copy(),{copied:'',prevented:false});}
});
