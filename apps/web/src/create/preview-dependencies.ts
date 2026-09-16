const fields=new Set(['name','symbol','beneficiary','quoteAssetConfigId','tickerGardenBaselineId','launchTemplateId','stakingEnabled','assetUid','creatorTax','lpFeeEnabled','lpFeePips','burnMemeFees','treasuryEnabled','firstBuyAmount']);
export const launchPreviewField=(name:string)=>fields.has(name);
