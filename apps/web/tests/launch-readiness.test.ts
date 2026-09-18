import assert from 'node:assert/strict';
import test from 'node:test';
import {launchDataReady} from '../src/create/launch-readiness.ts';
import type {MarketPageBootstrap,TokenDetailResponse} from '../src/v1/generated/read-api.ts';
const page={market:{marketId:'market',memeToken:'token',quoteAssetConfigId:'quote',identity:{},content:{},display:{}},configs:[{kind:'quote',id:'quote'}],sync:{chainId:4663}} as unknown as MarketPageBootstrap;
const detail={chainId:4663,marketId:'market',memeToken:'token',statistics:{price:'0',volume24h:'0',priceUsd:'0',marketCapUsd:'0'},holders:{},chart:{points:[]},trades:[],fees:[]} as unknown as TokenDetailResponse;
test('accepts initialized zero values and empty activity for a new market',()=>assert.equal(launchDataReady(page,detail,'market','token'),true));
test('waits for every detail section and USD metrics',()=>{
 for(const key of ['statistics','holders','chart','trades','fees'])assert.equal(launchDataReady(page,{...detail,[key]:null},'market','token'),false);
 assert.equal(launchDataReady(page,{...detail,statistics:{...detail.statistics!,marketCapUsd:null}},'market','token'),false);
});
test('rejects mismatched market, token, network and missing configuration',()=>{
 assert.equal(launchDataReady(page,detail,'other','token'),false);
 assert.equal(launchDataReady(page,detail,'market','other'),false);
 assert.equal(launchDataReady(page,{...detail,chainId:46630},'market','token'),false);
 assert.equal(launchDataReady({...page,configs:[]},detail,'market','token'),false);
});

test('preparation polls only compact persisted readiness and rejects a mismatched token',async()=>{
 const {waitForLaunchData}=await import('../src/create/launch-readiness.ts');
 const saved=globalThis.fetch,marketId=`0x${'1'.repeat(64)}` as `0x${string}`,token=`0x${'2'.repeat(40)}`;
 let count=0;const paths:string[]=[];
 globalThis.fetch=async(input)=>{paths.push(String(input));count++;return new Response(JSON.stringify({chainId:4663,marketId,memeToken:count===1?'other':token,ready:true}),{headers:{'content-type':'application/json'}});};
 try{await waitForLaunchData('https://read.example',marketId,token,new AbortController().signal,{retryMs:1,timeoutMs:1000});assert.equal(count,2);assert.ok(paths.every(p=>p.endsWith('/launch-readiness')));}
 finally{globalThis.fetch=saved;}
});
