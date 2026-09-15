export type RpcEnvironment = Readonly<Record<string, string | undefined>>;

/** Single mode deliberately trusts one provider; repeated reads only check its consistency. */
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
