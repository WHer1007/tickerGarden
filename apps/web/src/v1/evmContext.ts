import {bscPublicEnvironment} from '../chains/bsc/generated.ts';
/** Select once per document. Cross-chain navigation reloads the document so pending RPC/wallet state cannot leak. */
export function selectedEvmChain(env: Record<string, unknown>, search = ''): string | undefined {
 const selected = new URLSearchParams(search).get('chain');
 if (selected === 'bsc') return '56';
 if (selected === 'rh' || selected === 'evm') return typeof env.VITE_V1_CHAIN_ID === 'string' && env.VITE_V1_CHAIN_ID !== '56' ? env.VITE_V1_CHAIN_ID : '4663';
 if (selected && selected !== 'solana') throw Error('Unsupported chain selection');
 return typeof env.VITE_V1_CHAIN_ID === 'string' ? env.VITE_V1_CHAIN_ID : undefined;
}
export function evmEnvironment(env: Record<string, string | boolean | undefined>, chainId: number) {
 const scoped: Record<string, string | undefined> = Object.fromEntries(Object.entries(env).filter((entry): entry is [string,string] => typeof entry[1] === "string"));
 if (chainId !== 56) return scoped;
 // Never fall back to RH contract addresses, origins, release approvals or integration bootstrap.
 for (const key of Object.keys(scoped)) if (key.startsWith('VITE_V1_')) delete scoped[key];
 const bscEnv:Record<string,string|boolean|undefined>={...bscPublicEnvironment,...env};
 for (const [key,value] of Object.entries(bscEnv)) if(key.startsWith('VITE_BSC_')) scoped['VITE_V1_'+key.slice(9)] = typeof value === 'string' ? value : undefined;
 scoped.VITE_V1_CHAIN_ID = '56';
 // Public backend availability does not approve user fund transactions.
 // Keep the existing disabled-action UI until BSC transaction acceptance is promoted.
 if(env.VITE_BSC_USER_WRITES!=='approved')for(const key of Object.keys(scoped))if(key.startsWith('VITE_V1_')&&key.endsWith('_ADDRESS'))delete scoped[key];
 scoped.VITE_LAUNCH_METADATA_ORIGIN = typeof bscEnv.VITE_BSC_CONTENT_ORIGIN === "string" ? bscEnv.VITE_BSC_CONTENT_ORIGIN : undefined;
 scoped.VITE_INTEGRATION_BOOTSTRAP = undefined;
 scoped.VITE_HOLDER_SNAPSHOT_RELEASE_APPROVAL = typeof env.VITE_BSC_HOLDER_SNAPSHOT_RELEASE_APPROVAL==='string'?env.VITE_BSC_HOLDER_SNAPSHOT_RELEASE_APPROVAL:undefined;
 scoped.VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL = typeof env.VITE_BSC_CONTINUOUS_HOLDER_RELEASE_APPROVAL==='string'?env.VITE_BSC_CONTINUOUS_HOLDER_RELEASE_APPROVAL:undefined;
 scoped.VITE_MARKET_RELEASE_CATALOG = typeof env.VITE_BSC_RELEASE_CATALOG==='string'?env.VITE_BSC_RELEASE_CATALOG:undefined;
 return Object.freeze(scoped);
}
export function preserveEvmChain(url: URL, current: URL): URL {
 const next = new URL(url);
 if(next.origin === current.origin && !next.searchParams.has('chain') && current.searchParams.has('chain')) next.searchParams.set('chain',current.searchParams.get('chain')!);
 return next;
}
