export const ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE = {
  id: 'alchemy-evm-standard-json-rpc-2026-09-11',
  asOf: '2026-09-11',
  source: 'https://www.alchemy.com/docs/reference/compute-unit-costs',
  methods: {
    eth_chainId: 0,
    eth_getBlockByNumber: 20,
    eth_getLogs: 60,
    eth_getTransactionReceipt: 20,
    eth_getTransactionByHash: 20,
    eth_call: 26,
    eth_getCode: 20,
  },
} as const;

export type AlchemyMeteredMethod = keyof typeof ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.methods;

export function alchemyNominalComputeUnits(method: string): number | null {
  return Object.hasOwn(ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.methods, method)
    ? ALCHEMY_EVM_COMPUTE_UNIT_SCHEDULE.methods[method as AlchemyMeteredMethod]
    : null;
}
