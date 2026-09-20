export type RpcEnvironment = Readonly<Record<string, string | undefined>>;

/** Single mode trusts one provider. Identical in-flight reads are shared; later anchor checks remain fresh. */
export function rpcPolicy(env: RpcEnvironment) {
  const mode = env.TG_RPC_VERIFICATION_MODE ?? 'dual';
  if (mode !== 'single' && mode !== 'dual') throw Error('Invalid RPC verification mode');
  if (mode === 'single') {
    if (env.TG_ENVIRONMENT !== 'production' || env.TG_CHAIN_ID !== '4663') {
      throw Error('Single RPC mode requires explicit production chain 4663');
    }
    if (env.TG_SECONDARY_RPC_URL || env.TG_LOGS_SECONDARY_RPC_URL) {
      throw Error('Single RPC mode must not configure secondary endpoints');
    }
  }
  return {
    mode,
    verificationUrl: mode === 'single' ? env.TG_RPC_URL : env.TG_SECONDARY_RPC_URL,
    verificationProvider: mode === 'single' ? 'primary-consistency-read' : 'independent-secondary',
    logsUrl: mode === 'single' ? undefined : env.TG_LOGS_SECONDARY_RPC_URL,
    independentProviders: mode === 'single' ? 1 : 2,
  } as const;
}

/** Failover is availability routing, never an independent verification source. */
export function rpcFailoverOptions(env:RpcEnvironment, role:'pipeline'|'read-api'='pipeline') {
  const fallbackUrl=role==='read-api'?env.TG_READ_RPC_FALLBACK_URL:env.TG_RPC_FALLBACK_URL;
  const limit=role==='read-api'?env.TG_READ_RPC_LOG_MAX_BLOCKS:env.TG_RPC_LOG_MAX_BLOCKS;
  const primaryLogMaxBlocks=limit?Number(limit):undefined;
  if(primaryLogMaxBlocks!==undefined&&(!Number.isSafeInteger(primaryLogMaxBlocks)||primaryLogMaxBlocks<1))throw Error('Invalid RPC log range capability');
  const limits=primaryLogMaxBlocks===undefined?{}:{primaryLogMaxBlocks};
  if(!fallbackUrl)return limits;
  const expectedChainId=Number(env.TG_CHAIN_ID);
  if(!Number.isSafeInteger(expectedChainId)||expectedChainId<=0)throw Error('RPC fallback requires TG_CHAIN_ID');
  return {fallbackUrl,expectedChainId,...limits};
}
