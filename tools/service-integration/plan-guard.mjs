// Validate the exact reviewed test transaction before the external signer sees it.
export function validatePlan(plan,{chainId,from,to,data,candidateId}){
 if(chainId!==421614||plan.chainId!==chainId||plan.status!=='simulated_unsigned'||plan.transactionSubmission!==false)throw Error('Plan scope/status mismatch');
 if(plan.from?.toLowerCase()!==from.toLowerCase()||plan.to?.toLowerCase()!==to.toLowerCase()||BigInt(plan.value)!==0n||plan.data?.toLowerCase()!==data.toLowerCase())throw Error('Plan transaction mismatch');
 if(plan.candidateId!==candidateId||!/^0x[0-9a-f]{64}$/.test(plan.reviewId)||!/^0x[0-9a-f]{64}$/.test(plan.observedBlockHash))throw Error('Plan approval identity missing');
 return true;
}
