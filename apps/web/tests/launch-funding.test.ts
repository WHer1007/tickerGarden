import assert from "node:assert/strict";
import test from "node:test";
import { resolveLaunchFunding } from "../src/v1/launchFunding.ts";
import { ZERO_ADDRESS } from "../src/runtime/model.ts";
const account = "0x1111111111111111111111111111111111111111" as const;
const quote = "0x2222222222222222222222222222222222222222" as const;
function client(balance: bigint) { return { getBalance: async()=>1000n, readContract: async()=>balance, simulateContract: async()=>{ throw Error("External swaps must not be requested"); } } as never; }
test("wallet Quote is the sole source for ERC20 first buy", async()=>{
 const r=await resolveLaunchFunding({client:client(100n),account,quoteAsset:quote,quoteAmount:100n});
 assert.equal(r.mode,"quote");assert.equal(r.quotedNativeInput,0n);
});
test("ETH cannot substitute for insufficient Quote",async()=>{
 await assert.rejects(resolveLaunchFunding({client:client(99n),account,quoteAsset:quote,quoteAmount:100n}),/Insufficient paired asset/);
});
test("native first buy uses its exact supplied amount",async()=>{
 const r=await resolveLaunchFunding({client:client(0n),account,quoteAsset:ZERO_ADDRESS,quoteAmount:20n});assert.equal(r.quotedNativeInput,20n);
});
test("create without buy needs no ERC20 balance read",async()=>{
 const r=await resolveLaunchFunding({client:{getBalance:async()=>1000n,readContract:async()=>{throw Error("unused balance");}} as never,account,quoteAsset:quote,quoteAmount:0n});assert.equal(r.mode,"quote");assert.equal(r.quoteBalance,null);
});

test('ETH purchase quotes only the shortfall and is skipped once funds arrive',async()=>{
 let called=0;
 const purchase={chainId:4663 as const,token:quote,amountOut:'1',amountIn:'2',stockInput:'2',blockNumber:'1',expiresAt:Date.now()+90000,priceImpactBps:50};
 const quotePurchase=async(amount:bigint)=>{called++;assert.equal(amount,1n);return purchase;};
 const result=await resolveLaunchFunding({client:client(99n),account,quoteAsset:quote,quoteAmount:100n,quotePurchase});
 assert.equal(result.quotedNativeInput,2n);assert.equal(result.purchase,purchase);
 const retry=await resolveLaunchFunding({client:client(100n),account,quoteAsset:quote,quoteAmount:100n,quotePurchase});
 assert.equal(called,1);assert.equal(retry.purchase,undefined);
});
