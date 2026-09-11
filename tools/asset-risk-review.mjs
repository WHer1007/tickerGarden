// Public operational evidence only. This check cannot override on-chain registry checks or issuer controls.
const address=/^0x[0-9a-f]{40}$/i, hash=/^0x[0-9a-f]{64}$/i;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function requireAssetRiskReview(table, asset, now=Date.now()) {
 const fail=reason=>{throw Error(`Asset review required (${asset.symbol??asset.address}): ${reason}`)};
 if(table?.schemaVersion!==1||!Array.isArray(table.assets)||!address.test(asset.address)||/^0x0{40}$/i.test(asset.address)||!Number.isSafeInteger(asset.chainId)||asset.chainId<=0||!Array.isArray(asset.roles)||asset.roles.length===0||asset.roles.some(r=>!['quote','staking'].includes(r)))fail('invalid review scope');
 const matches=table.assets.filter(r=>r.chainId===asset.chainId&&same(r.tokenAddress,asset.address));
 if(matches.length!==1)fail('missing or duplicate identity');
 const r=matches[0];
 if(r.status!=='approved'||r.acceptedIssuerRisk!==true)fail('not approved');
 const reviewed=Date.parse(r.reviewedAt),until=Date.parse(r.validUntil);
 if(!Number.isFinite(now)||!Number.isFinite(reviewed)||!Number.isFinite(until)||reviewed>now||until<=now||until<=reviewed)fail('expired or invalid review time');
 if(r.decimals!==asset.decimals||!Array.isArray(r.roles)||!asset.roles?.every(role=>r.roles.includes(role)))fail('role or decimals mismatch');
 if(!r.reviewer?.trim()||!r.issuerControl?.trim()||!Array.isArray(r.evidence)||!r.evidence.length||r.evidence.some(v=>typeof v!=='string'||!v.trim()))fail('missing review evidence');
 for(const key of ['pause','blacklist','upgrade'])if(!['present','absent'].includes(r.capabilities?.[key]))fail(`unreviewed ${key} capability`);
 for(const key of ['feeOnTransfer','rebasing'])if(r.capabilities?.[key]!=='absent')fail(`unsupported or unreviewed ${key}`);
 if(asset.roles.includes('staking')){
  if(!/^\d+$/.test(r.minimumAllocationRaw)||BigInt(r.minimumAllocationRaw)<414n||!r.minimumRationale?.trim())fail('missing economic minimum');
  if(!same(r.assetUid,asset.uid)||!hash.test(r.assetUid))fail('asset UID mismatch');
  if(asset.minimumAllocation!==undefined&&BigInt(r.minimumAllocationRaw)!==BigInt(asset.minimumAllocation))fail('minimum differs from plan');
 }
 if(asset.fingerprint){
  if(r.checkMode!=='stock-fingerprint')fail('wrong fingerprint policy');
  for(const key of ['tokenRuntimeCodeHash','beacon','beaconRuntimeCodeHash','implementation','implementationRuntimeCodeHash']){
   const value=asset.fingerprint[key];
   if(!(key.endsWith('Hash')?hash:address).test(value)||!same(r.fingerprint?.[key],value))fail(`changed ${key}`);
  }
 }else if(r.checkMode!=='runtime-codehash'||!hash.test(asset.runtimeCodeHash)||!same(r.runtimeCodeHash,asset.runtimeCodeHash))fail('runtime review mismatch');
 return r;
}
