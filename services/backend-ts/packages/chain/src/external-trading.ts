/** Operator-reviewed off-chain service configuration. These addresses are NOT protocol bindings.
 * A service change requires a matching calldata adapter review and a client/backend release,
 * but never a MarketRegistry or FeeVault deployment. Claims do not depend on this configuration.
 */
export interface ExternalTradingService {
  readonly chainId: number;
  readonly adapter: 'universal-router-v4-min-hop-v1';
  readonly router: `0x${string}`;
  readonly quoter: `0x${string}`;
}
const services: Readonly<Record<number, ExternalTradingService>> = {
  46630: { chainId: 46630, adapter: 'universal-router-v4-min-hop-v1', router: '0x8876789976decbfcbbbe364623c63652db8c0904', quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' },
  4663: { chainId: 4663, adapter: 'universal-router-v4-min-hop-v1', router: '0x8876789976decbfcbbbe364623c63652db8c0904', quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' },
};
export function externalTradingService(chainId: number): ExternalTradingService | undefined {
  const service = services[chainId];
  return service && { ...service };
}
export function requireExternalTradingService(chainId: number): ExternalTradingService {
  const service = externalTradingService(chainId);
  if (!service) throw Error('External trading service is not configured for this network');
  return service;
}
