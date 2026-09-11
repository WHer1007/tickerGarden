import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,decodeFunctionData} from 'viem';
import {userClaimsAbi,userClaimOutcome} from '../src/v1/features/userClaims.ts';
test('claim choice and explicit fallback stay independent with no minimum output field',()=>{
 for(const convert of [true,false])for(const fallback of [true,false]){
  const data=encodeFunctionData({abi:userClaimsAbi,functionName:'claimUserRewards',args:['0x'+'1'.repeat(64) as `0x${string}`,2,0,convert,fallback,1800000240n]});
  const decoded=decodeFunctionData({abi:userClaimsAbi,data});
  assert.equal(decoded.functionName,'claimUserRewards');assert.deepEqual(decoded.args?.slice(3),[convert,fallback,1800000240n]);
 }
});
test('partial and failed conversion receipts never display full conversion success',()=>{
 assert.match(userClaimOutcome({quotePaid:20n,memeRetained:30n,memeConverted:10n}),/Partial Conversion/);
 assert.equal(userClaimOutcome({quotePaid:20n,memeRetained:30n,memeConverted:0n,conversionFailed:true}),'Quote Claimed; Meme Retained');
 assert.equal(userClaimOutcome({memePaid:30n,conversionFailed:true}),'Original Meme Claimed');
 assert.equal(userClaimOutcome({memeRetained:30n,conversionFailed:true}),'Conversion Failed; Meme Retained');
});

test('single-asset claim encodes the selected rights without adding a price floor',()=>{
 for(const assets of [1,2,3]) {
  const data=encodeFunctionData({abi:userClaimsAbi,functionName:'claimUserRewardAssets',args:['0x'+'1'.repeat(64) as `0x${string}`,1,0,assets,false,false,0n]});
  const decoded=decodeFunctionData({abi:userClaimsAbi,data});
  assert.equal(decoded.functionName,'claimUserRewardAssets');
  assert.deepEqual(decoded.args?.slice(3),[assets,false,false,0n]);
 }
});
