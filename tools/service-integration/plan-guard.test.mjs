import test from 'node:test';import assert from 'node:assert/strict';import{validatePlan}from './plan-guard.mjs';
const h='0x'+'12'.repeat(32),a='0x'+'34'.repeat(20),b='0x'+'56'.repeat(20);
const expected={chainId:421614,from:a,to:b,data:'0x1234',candidateId:h};
const good={...expected,value:'0x0',status:'simulated_unsigned',transactionSubmission:false,reviewId:h,observedBlockHash:h};
test('exact reviewed Arbitrum Sepolia plan accepted',()=>assert.equal(validatePlan(good,expected),true));
for(const [field,value]of Object.entries({chainId:4663,from:b,to:a,data:'0xabcd',value:'0x1',candidateId:'0x'+'aa'.repeat(32),reviewId:'',observedBlockHash:'latest',status:'approved',transactionSubmission:true}))test('reject altered '+field,()=>assert.throws(()=>validatePlan({...good,[field]:value},expected)));
