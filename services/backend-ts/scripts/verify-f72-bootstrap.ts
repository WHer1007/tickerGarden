import { RpcTransport, verifyChainIdentity } from '../packages/chain/src/index.ts';
import { verifyF72BootstrapSourceBlocks } from '../packages/config-projector/src/index.ts';
import { F72_RELEASE_ID } from '../packages/events/src/index.ts';
import { f72BootstrapConfigs } from '../packages/config-projector/src/f72-bootstrap.generated.ts';

const first = process.env.TG_RPC_URL;
const second = process.env.TG_SECONDARY_RPC_URL;
if (!first || !second) throw new Error('TG_RPC_URL and TG_SECONDARY_RPC_URL are required');
const primary = new RpcTransport({ url: first, timeoutMs: 15_000 });
const secondary = new RpcTransport({ url: second, timeoutMs: 15_000 });
const genesis = '0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32';
await Promise.all([verifyChainIdentity(primary, 46630n, genesis), verifyChainIdentity(secondary, 46630n, genesis)]);
const sourceBlocks = await verifyF72BootstrapSourceBlocks(primary, secondary);
console.log(JSON.stringify({ status: 'verified', releaseId: F72_RELEASE_ID, records: f72BootstrapConfigs.length, sourceBlocks, providers: 2 }));
