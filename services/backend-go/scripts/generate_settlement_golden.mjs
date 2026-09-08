import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRewardSettlement, rewardSettlementRequestDigest } from '../testsupport/settlement-reference.ts';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = (n) => '0x' + n.toString(16).padStart(40, '0');
const market = '0x' + 'a'.repeat(64);
const common = {chainId:46630,marketId:market,now:1700000000,pendingParticipants:[],rawExitAt:{},perBatchCap:'100000',totalMeme:'100000',deadline:1700000300,slippageBps:100};
const examples = [
 ['empty',{}],
 ['roles',{pendingParticipants:[{user:user(1),creatorEpoch:0,maximumMeme:'19'},{user:user(1),creatorEpoch:3,maximumMeme:'31'}]}],
 ['raw-exit-boundary',{pendingParticipants:[{user:user(1),creatorEpoch:0,maximumMeme:'7'},{user:user(2),creatorEpoch:1,maximumMeme:'13'},{user:user(3),creatorEpoch:2,maximumMeme:'0'}],rawExitAt:{[user(1)]:'1700000000',[user(2)]:'1700000001'}}],
 ['all-exited',{pendingParticipants:[{user:user(1),creatorEpoch:0,maximumMeme:'7'}],rawExitAt:{[user(1)]:'1699999999'}}],
 ['max-items',{pendingParticipants:Array.from({length:32},(_,i)=>({user:user(i+1),creatorEpoch:i,maximumMeme:'1'}))}],
 ['uint256',{pendingParticipants:[{user:user(1),creatorEpoch:4294967295,maximumMeme:((1n<<256n)-1n).toString()}],perBatchCap:((1n<<256n)-1n).toString(),totalMeme:((1n<<256n)-1n).toString()}],
 ['zero-slippage',{pendingParticipants:[{user:user(1),creatorEpoch:0,maximumMeme:'1'}],slippageBps:0,deadline:1700000000}],
];
const result = examples.map(([name,changes]) => {
 const input = {...common,...changes};
 const items = input.pendingParticipants.filter(i => BigInt(i.maximumMeme)>0n && !(BigInt(input.rawExitAt[i.user]??'0')>0n && BigInt(input.rawExitAt[i.user])<=BigInt(input.now)));
 if(items.length) input.quote={chainId:input.chainId,marketId:input.marketId,expectedOutput:name==='uint256'?((1n<<256n)-1n).toString():'10003',quotedAt:input.now-30,requestDigest:rewardSettlementRequestDigest(input.chainId,input.marketId,items),referenceId:'test-reference'};
 const plan=planRewardSettlement({...input,pendingParticipants:input.pendingParticipants.map(i=>({...i,maximumMeme:BigInt(i.maximumMeme)})),rawExitAt:Object.fromEntries(Object.entries(input.rawExitAt).map(([k,v])=>[k,BigInt(v)])),perBatchCap:BigInt(input.perBatchCap),totalMeme:BigInt(input.totalMeme),quote:input.quote?{...input.quote,expectedOutput:BigInt(input.quote.expectedOutput)}:undefined});
 return {name,input,plan};
});
const output=JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const target=path.join(base,'internal/settlement/testdata/typescript-golden.json');
if(process.argv.includes('--check')) { if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output) throw new Error('settlement golden is stale'); }
else {fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);}
