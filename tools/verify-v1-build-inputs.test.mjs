import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {keccak256,encodeFunctionData,parseAbi} from '../apps/web/node_modules/viem/_esm/index.js';
import {assertArtifactSourcesCurrent,assertOrdinaryInitCodesCurrent} from './verify-v1-build-inputs.mjs';
const abi=parseAbi(['function deployComponent(uint8 index, bytes initCode)']);
test('rejects stale embedded source even when another artifact is freshly compiled',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-build-guard-'));
 try{const file=path.join(dir,'Fee.sol');fs.writeFileSync(file,'old source');const stale={metadata:{sources:{'Fee.sol':{keccak256:keccak256(fs.readFileSync(file))}}}};
 fs.writeFileSync(file,'fixed source');const fresh={metadata:{sources:{'Fee.sol':{keccak256:keccak256(fs.readFileSync(file))}}}};
 assert.equal(assertArtifactSourcesCurrent(fresh,dir),1);assert.throws(()=>assertArtifactSourcesCurrent(stale,dir),/Stale compiled source/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing or escaped compiler provenance fails closed',()=>{
 assert.throws(()=>assertArtifactSourcesCurrent({},'/tmp'),/Missing compiler/);
 assert.throws(()=>assertArtifactSourcesCurrent({metadata:{sources:{'../outside.sol':{keccak256:'0x'}}}},'/tmp'),/Unresolvable compiler source/);
});
const fixtures=()=>{const artifacts=Array.from({length:16},()=>({bytecode:{object:'0x60016000'}}));const transactions=artifacts.map((_,index)=>({transaction:{input:encodeFunctionData({abi,functionName:'deployComponent',args:[index,'0x60016000abcdef']})}}));return {artifacts,batch:{transactions}};};
test('accepts every current component with constructor arguments',()=>{const {artifacts,batch}=fixtures();assert.equal(assertOrdinaryInitCodesCurrent(batch,abi,artifacts),16);});
test('rejects a stale embedded FeeVault init code before broadcast',()=>{const {artifacts,batch}=fixtures();batch.transactions[15].transaction.input=encodeFunctionData({abi,functionName:'deployComponent',args:[15,'0x60026000abcdef']});assert.throws(()=>assertOrdinaryInitCodesCurrent(batch,abi,artifacts),/component 15/);});
test('rejects missing and duplicate deployment components',()=>{const {artifacts,batch}=fixtures();batch.transactions.pop();assert.throws(()=>assertOrdinaryInitCodesCurrent(batch,abi,artifacts),/exactly 16/);batch.transactions.push(batch.transactions[0]);assert.throws(()=>assertOrdinaryInitCodesCurrent(batch,abi,artifacts),/component 0/);});
