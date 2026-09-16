import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderRouteFailure} from '../src/routing/load-state.ts';
test('route failure has an independent retry, home exit and pending transaction guidance',()=>{
 const button={onclick:null as null|(()=>void)};let focused=false,retries=0;
 const outlet={innerHTML:'',querySelector:(selector:string)=>selector==='main'?{focus:()=>{focused=true;}}:button};
 renderRouteFailure(outlet as unknown as HTMLElement,()=>{retries++;});
 assert.match(outlet.innerHTML,/role="alert"/);assert.match(outlet.innerHTML,/href="\/"/);assert.match(outlet.innerHTML,/check your wallet history/);
 button.onclick!();assert.equal(retries,1);assert.equal(focused,true);
});
