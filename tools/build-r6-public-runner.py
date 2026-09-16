from pathlib import Path
root=Path(__file__).resolve().parents[1];dst=root/'.codex_tmp/r6-fast-test'
s=(root/'tools/test-r5-business-public.mjs').read_text().replace('r5-business-acceptance-2026-09-06','r6-fast-test-2026-09-06').replace('R5-BUSINESS-2026-09-06','R6-FAST-BUSINESS-2026-09-06')
s=s.replace('TICKERGARDEN_ARB_SEPOLIA_R5_NO_STAKING_FEE_FIX_CLEAN_BUILD_2026_09_06','TICKERGARDEN_R6_FAST_TEST_ONLY_2026_09_06').replace('Expected R5','Expected R6').replace('docs/testing/R5_BUSINESS_CASES.json','docs/testing/R6_FAST_BUSINESS_CASES.json')
s=s.replace("parseEther('0.001')", "parseEther('0.00001')")
# Root request fee remains the deployed 0.001 ETH; economic trade sizes alone shrink 100x.
s=s.replace("'EpochNotClosed',parseEther('0.00001')", "'EpochNotClosed',parseEther('0.001')")
s=s.replace("parseEther('1000')]);\n record('fixture-identities'", "parseEther('1000')]);\n record('fixture-identities'")
s=s.replace("accounts.outsider.address,parseEther('1000')]);", "accounts.outsider.address,parseEther('3000')]);")
s=s.replace("// Fund one ETH graduation; retain the other seven ETH combinations as explicit coverage gaps.","// R6: all eight native configurations graduate with independent principal.")
s=s.replace("'fund-one-eth-graduation'","'fund-eight-fast-eth-graduations'").replace("parseEther('0.36')","parseEther('0.04')").replace("Object.values(state.markets).filter(m=>m.quote!==zero||m.key==='ETH-S1-H1-T500')","Object.values(state.markets)").replace("parseEther('0.45')","parseEther('0.0045')")
s=s.replace('pauseBlock.timestamp+86400n','pauseBlock.timestamp+1200n').replace('actual 30-day claim deadline','actual 2-hour claim deadline')
# Test creator epochs using actual v4 sells now that every ETH matrix market graduates.
for epoch in [1,2]:
 old=f"await call('epoch{epoch}-curve-buy','buyer','TickerGardenCurve',e.curve,'buy',[parseEther('0.00001'),1n,accounts.buyer.address],parseEther('0.00001'));"
 new=f"const amount{epoch}=await snapshot('epoch{epoch}-sell-amount',async()=>({{value:String(await balance(e.token,accounts.buyer.address)/1000n)}})); await swap('epoch{epoch}-v4-sell',e,false,BigInt(amount{epoch}.value));"
 assert old in s;s=s.replace(old,new)
# v4 sells credit the FeeVault directly; the already-graduated curve has no fee sweep.
s=s.replace("await call('epoch2-sweep','outsider','TickerGardenCurve',e.curve,'sweepCurveFees');", "// v4 fees are already credited to the separate creator epochs.")
# Capture early lock rejection immediately after each position is opened; lifecycle can finish after 20m.
needle="const pos=await read('MemeStockGauge',m.gauge,'positionOf',[accounts.outsider.address]);"
s=s.replace(needle,"await strictReject('early-normal-'+key,'staker','AllocationManager',manager,'unstakeAndWithdraw',[m.id],'PositionLockedUntil');\n   "+needle)
s=s.replace("await strictReject('early-staker-quote','staker','ProtocolFeeVault',fees,'claimStaker',[m.id,m.quote],'PositionLockedUntil');\n await strictReject('early-normal-unstake','staker','AllocationManager',manager,'unstakeAndWithdraw',[m.id],'PositionLockedUntil');","if((await c.getBlock()).timestamp<BigInt(m.normalExitDueAt)){await strictReject('early-staker-quote','staker','ProtocolFeeVault',fees,'claimStaker',[m.id,m.quote],'PositionLockedUntil');await strictReject('early-normal-unstake','staker','AllocationManager',manager,'unstakeAndWithdraw',[m.id],'PositionLockedUntil');}")
s=s.replace("for(const h of Object.values(state.markets).filter(m=>m.holderFunded))await strictReject", "for(const h of Object.values(state.markets).filter(m=>m.holderFunded))if((await c.getBlock()).timestamp<BigInt(h.epochWindow[1])+600n)await strictReject")
# A long real-chain run can cross the one-hour boundary. Settle each accrued holder
# epoch separately; keep epoch 1 as the fixed canonical-root scenario.
old="""await call('convert-holder-'+key,'admin','ProtocolFeeVault',fees,'settleHolderRewards',[m.id,1,BigInt(conv.holder),1n,await deadline('convert-holder-'+key)]);"""
new="""const lastHolderEpoch=Number(await read('TreasuryDistributorV1',distributor,'currentEpochId',[m.id]));
   m.settledHolderEpochs??=[];
   for(let holderEpoch=1;holderEpoch<=lastHolderEpoch;holderEpoch++){
    const holderDebt=await read('ProtocolFeeVault',fees,'holderLiability',[m.id,holderEpoch,m.token]);
    if(holderDebt>0n){const settlementId='convert-holder-'+key+'-epoch-'+holderEpoch;
     const captured=await snapshot(settlementId,async()=>({amount:String(holderDebt)}));
     await call(settlementId,'admin','ProtocolFeeVault',fees,'settleHolderRewards',[m.id,holderEpoch,BigInt(captured.amount),1n,await deadline(settlementId)]);
    }
    if(holderEpoch>1&&await read('ProtocolFeeVault',fees,'holderLiability',[m.id,holderEpoch,m.quote])>0n)await call('fund-holder-'+key+'-epoch-'+holderEpoch,'outsider','ProtocolFeeVault',fees,'fundHolderRewards',[m.id,holderEpoch]);
    if(!m.settledHolderEpochs.includes(holderEpoch))m.settledHolderEpochs.push(holderEpoch);save();
   }"""
assert old in s;s=s.replace(old,new)
s=s.replace("if(stage==='matrix')await matrix();","if(stage==='fund'){await send('fund-fast-buyer-initial','admin',accounts.buyer.address,'0x',parseEther('0.1'));await send('fund-fast-outsider-initial','admin',accounts.outsider.address,'0x',parseEther('0.02'));record('role-funding',{testOnly:true});}else if(stage==='matrix')await matrix();")
s=s.replace("const code=keccak256(await c.getCode({address:state.stock}));","const code=keccak256(await c.getCode({address:state.stock}));state.stockRuntimeHash=code;save();")
s=s.replace("if (p.chainId!==421614","if(p.releaseId!=='0xf2ab431cdae9144d0bd1b5f4f3c52c337e0b77a5aa8fd5504cff3d46bf2eec4f')throw Error('Not the authorized R6 fast release');\nif (p.chainId!==421614")
s=s.replace("const stage=process.argv[3]",(root/'tools/r6-natural-stages.inc.mjs').read_text()+"\nconst stage=process.argv[3]")
s=s.replace("else if(stage==='conversion-rejections')await conversionRejections();","else if(stage==='conversion-rejections')await conversionRejections();else if(stage==='natural-exits')await naturalExits();else if(stage==='natural-roots')await naturalRoots();else if(stage==='natural-claims')await naturalClaims();else if(stage==='natural-rollover')await naturalRollover();")
(dst/'tools/test-r6-business-public.mjs').write_text(s)
a=(root/'tools/audit-r5-business-public.mjs').read_text().replace('r5-business-acceptance-2026-09-06','r6-fast-test-2026-09-06').replace('168000000000000000n','1680000000000000n').replace('420000000000000000n','4200000000000000n')
a=a.replace("const c=createPublicClient","s.transactions=s.transactions.filter(t=>['CONFIRMED','EXPECTED_REVERT'].includes(t.status));\nconst c=createPublicClient")
(dst/'tools/audit-r6-business-public.mjs').write_text(a)
print('Derived R6 resumable runner and independent accounting auditor; R5 unchanged.')
