import {CURRENT_CHAIN_ID,runtimeGenesisHash,runtimeActivationBlock,runtimeActivationHash} from '../packages/runtime-deployment/src/index.ts';
import {rpcPolicy} from '../packages/chain/src/rpc-policy.ts';
import { consensusBlock, RpcTransport, verifyChainIdentity } from '../packages/chain/src/index.ts';

const baseline = {target:{chainId:CURRENT_CHAIN_ID,genesisHash:runtimeGenesisHash,activationBlockNumber:runtimeActivationBlock.toString(),activationBlockHash:runtimeActivationHash}};
const policy = rpcPolicy(process.env);
const endpoint = process.env.TG_RPC_URL
  ?? (CURRENT_CHAIN_ID === 46630 && process.env.ALCHEMY_API_KEY ? `https://robinhood-testnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : undefined);
if (!endpoint) throw new Error('TG_RPC_URL or ALCHEMY_API_KEY is required');

const transport = new RpcTransport({ url: endpoint });
await verifyChainIdentity(transport, BigInt(baseline.target.chainId), baseline.target.genesisHash);
const candidates: Array<readonly [string, string]> = [];
if (policy.mode === 'dual' && process.env.TG_SECONDARY_RPC_URL) candidates.push(['TG_SECONDARY_RPC_URL', process.env.TG_SECONDARY_RPC_URL]);
else if (policy.mode === 'dual' && CURRENT_CHAIN_ID === 46630) {
  if (process.env.RH46630_RPC_INDEPENDENT) candidates.push(['RH46630_RPC_INDEPENDENT', process.env.RH46630_RPC_INDEPENDENT]);
  if (process.env.RH46630_RPC_PUBLIC) candidates.push(['RH46630_RPC_PUBLIC', process.env.RH46630_RPC_PUBLIC]);
  if (process.env.RH46630_RPC_LOGS) candidates.push(['RH46630_RPC_LOGS', process.env.RH46630_RPC_LOGS]);
}
let secondary: RpcTransport | undefined;
let secondarySource: string | undefined;
for (const [source, candidate] of candidates) {
  try {
    const transportCandidate = new RpcTransport({ url: candidate });
    await verifyChainIdentity(transportCandidate, BigInt(baseline.target.chainId), baseline.target.genesisHash);
    secondary = transportCandidate;
    secondarySource = source;
    break;
  } catch (error) {
    console.error(JSON.stringify({ source, status: 'rejected', reason: 'RPC identity check failed' }));
  }
}
if (policy.mode === 'dual' && !secondary) throw new Error('configured secondary RPC failed identity checks');
const activation = await consensusBlock(transport, secondary, BigInt(baseline.target.activationBlockNumber));
if (activation.hash !== baseline.target.activationBlockHash) throw new Error('activation block hash mismatch');
console.log(JSON.stringify({
  status: 'verified', chainId: baseline.target.chainId,
  activationBlockNumber: baseline.target.activationBlockNumber, activationBlockHash: activation.hash,
  verificationMode: policy.mode, providers: secondary ? 2 : 1, ...(secondarySource ? { secondarySource } : {}),
}));
