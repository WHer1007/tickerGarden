import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcScope} from '../../apps/read-api/src/rpc-scope.ts';
import {fixedF72Sources,eventTopicsForModules} from '../../packages/events/src/index.ts';
import {WETH} from '../../packages/chain/src/quote-purchase/quote.ts';
import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../packages/chain/src/index.ts';
import {keccak256,toHex} from 'viem';

const deployment:DeploymentIdentity={environment:'preview',chainId:46630,deploymentDigest:`0x${'a'.repeat(64)}`,activationBlock:0n};
function mockPool(handler:(sql:string,values:unknown[])=>unknown[]){const calls:Array<{sql:string;values:unknown[]}> = [];return {calls,pool:{query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:handler(sql,values)};}} as unknown as Pool};}

test('fixed protocol addresses and configured asset tokens are allowed without database access',async()=>{
 const {pool,calls}=mockPool(()=>{throw Error('database must not be queried');});
 const factory=fixedF72Sources().find(s=>s.module==='TickerGardenFactoryV1')!;
 const token=WETH;
 const mainnet={...deployment,chainId:4663 as const};
 const result=await rpcScope(pool,mainnet,[factory.address,token]);
 assert.equal(calls.length,0);
 assert.deepEqual(result[0],{address:factory.address,topics:eventTopicsForModules(['TickerGardenFactoryV1'])});
 assert.deepEqual(result[1],{address:token,topics:['Transfer(address,address,uint256)','Approval(address,address,uint256)'].map(value=>keccak256(toHex(value)))});
});

test('unknown addresses are omitted and dynamic sources are queried within the deployment scope',async()=>{
 const dynamic='0x'+'d'.repeat(40),unknown='0x'+'e'.repeat(40);
 const {pool,calls}=mockPool(()=>[{address:dynamic,module:'TickerGardenCurve'}]);
 const result=await rpcScope(pool,deployment,[dynamic,unknown]);
 assert.equal(calls.length,1);
 const {sql,values}=calls[0]!;
 assert.match(sql,/environment=\$1 AND chain_id=\$2 AND deployment_digest=\$3/);
 assert.match(sql,/address=ANY\(\$4::text\[\]\)/);
 assert.deepEqual(values,[deployment.environment,deployment.chainId,deployment.deploymentDigest,[dynamic,unknown]]);
 assert.deepEqual(result,[{address:dynamic,topics:eventTopicsForModules(['TickerGardenCurve'])}]);
});

test('invalid schema names reject before database access',async()=>{
 const {pool,calls}=mockPool(()=>[]);
 await assert.rejects(()=>rpcScope(pool,deployment,['0x'+'d'.repeat(40)],'bad-name'),/Invalid schema/);
 assert.equal(calls.length,0);
});
