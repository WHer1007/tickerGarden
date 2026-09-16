import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseTransaction,recoverTransactionAddress} from '../../apps/web/node_modules/viem/_esm/index.js';
// Temporary capability for the exact reviewed five-stock testnet admission plan.
export class ApprovedAssets {
 constructor(planPath,auditPath){
  const raw=fs.readFileSync(planPath),p=JSON.parse(raw),a=JSON.parse(fs.readFileSync(auditPath));
  if(p.chainId!==46630||p.transactions.length!==10||p.stocks.length!==5||a.status!=='APPROVED_FOR_CANONICAL_TEST_ASSET_ACTIVATION'||a.planSha256!=='0x'+createHash('sha256').update(raw).digest('hex')||p.releaseId!==a.releaseId)throw Error('Invalid asset admission approval');
  this.plan=p;
 }
 async permits(method,params){
  const p=this.plan;if(Date.now()/1000>p.expiresAtUnix)return false;
  if(method!=='eth_sendRawTransaction')return false;
  const t=parseTransaction(params[0]),sender=await recoverTransactionAddress({serializedTransaction:params[0]});
  const row=p.transactions.find(r=>r.nonce===t.nonce&&r.to.toLowerCase()===t.to?.toLowerCase()&&r.data===t.data);
  if(t.chainId!==46630||sender.toLowerCase()!==p.deployer.toLowerCase()||!row||BigInt(t.value??0)!==0n||BigInt(t.gas??0)*BigInt(t.maxFeePerGas??t.gasPrice??0)>BigInt(p.limits.perTransactionMaximumWei))throw Error('Outside reviewed asset admission');
  return true;
 }
}
