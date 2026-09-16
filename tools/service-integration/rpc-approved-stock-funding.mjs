import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseTransaction,recoverTransactionAddress} from '../../apps/web/node_modules/viem/_esm/index.js';
export class ApprovedStockFunding {
 constructor(path,digest){const raw=fs.readFileSync(path);if(createHash('sha256').update(raw).digest('hex')!==digest)throw Error('Funding plan digest mismatch');const p=JSON.parse(raw);if(p.chainId!==46630||p.scope!=='FIVE_STOCK_GRADUATION_FUNDING'||p.transactions.length!==10||p.transactions.reduce((n,t)=>n+BigInt(t.value),0n)>100000000000000000n)throw Error('Invalid funding scope');this.plan=p;}
 async permits(method,params){if(method!=='eth_sendRawTransaction')return false;const p=this.plan;if(Date.now()/1000>p.deadline)throw Error('Funding plan expired');const t=parseTransaction(params[0]);const from=await recoverTransactionAddress({serializedTransaction:params[0]});const r=p.transactions.find(r=>r.nonce===t.nonce&&r.to.toLowerCase()===t.to?.toLowerCase()&&r.data===t.data&&BigInt(r.value)===BigInt(t.value??0));if(t.chainId!==46630||from.toLowerCase()!==p.sender.toLowerCase()||!r||BigInt(t.gas??0)*BigInt(t.maxFeePerGas??t.gasPrice??0)>5000000000000000n)throw Error('Outside exact funding intent');return true;}
}
