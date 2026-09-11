import fs from 'node:fs';
import { consensusBlock, RpcTransport, verifyChainIdentity } from '../packages/chain/src/index.ts';

const baselinePath = new URL('../../../docs/backend/typescript-serverless-baseline.json', import.meta.url);
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
  target: { chainId: number; genesisHash: string; activationBlockNumber: string; activationBlockHash: string };
};
const endpoint = process.env.TG_RPC_URL
  ?? (process.env.ALCHEMY_API_KEY ? `https://robinhood-testnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : undefined);
if (!endpoint) throw new Error('TG_RPC_URL or ALCHEMY_API_KEY is required');

const transport = new RpcTransport({ url: endpoint });
await verifyChainIdentity(transport, BigInt(baseline.target.chainId), baseline.target.genesisHash);
const candidates: Array<readonly [string, string]> = [];
if (process.env.TG_SECONDARY_RPC_URL) candidates.push(['TG_SECONDARY_RPC_URL', process.env.TG_SECONDARY_RPC_URL]);
else {
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
    console.error(JSON.stringify({ source, status: 'rejected', reason: error instanceof Error ? error.message : 'unknown' }));
  }
}
if (process.env.TG_SECONDARY_RPC_URL && !secondary) throw new Error('configured secondary RPC failed identity checks');
const activation = await consensusBlock(transport, secondary, BigInt(baseline.target.activationBlockNumber));
if (activation.hash !== baseline.target.activationBlockHash) throw new Error('activation block hash mismatch');
console.log(JSON.stringify({
  status: 'verified', chainId: baseline.target.chainId,
  activationBlockNumber: baseline.target.activationBlockNumber, activationBlockHash: activation.hash,
  providers: secondary ? 2 : 1, ...(secondarySource ? { secondarySource } : {}),
}));
