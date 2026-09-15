// Mainnet address reference, independent of the app runtime network.
// Source: finalized production post-deployment catalog, verified 2026-09-14T21:00:06Z.
// Release: 0xda13cee41cf89064426e10cd5b2f63cb8448fb5b4e8713f2d48d2f99b9570cd5; activation block 63094312.
export const productionContracts = [
  {
    "module": "TickerGardenFactoryV1",
    "name": "Market factory",
    "address": "0x5eBC1c14Dc10AAC61A1d1E59b2618AB1f4c3dE9c",
    "description": "Creates community tokens and their markets with the selected launch terms."
  },
  {
    "module": "LaunchAndBuyRouter",
    "name": "Launch and buy router",
    "address": "0x6C0abd362798af76478ed98de521Fc70D3226Df7",
    "description": "Combines token creation with an optional first purchase."
  },
  {
    "module": "MarketRegistryV1",
    "name": "Market registry",
    "address": "0xccC003A03A13c2cF00C7c00b1bFF77732728059D",
    "description": "Records the identities and associated contracts of each market."
  },
  {
    "module": "OfficialStockRegistryV1",
    "name": "Official Stock registry",
    "address": "0xAeDCa76Eb53518aE931915dB1A1f2ce9861abD52",
    "description": "Records approved Stock Tokens and their staking settings."
  },
  {
    "module": "ApprovedQuoteRegistry",
    "name": "Paired-asset registry",
    "address": "0xce53f5Ad6c7135D6F418a2BCA49F52de89CF819F",
    "description": "Records approved paired assets and their curve and Bloom settings."
  },
  {
    "module": "UserStockVault",
    "name": "Stock vault",
    "address": "0xbd259f2C7c68323a28876c3921e4cB58649Dc32f",
    "description": "Holds deposited Stock principal and separates balances by asset and user."
  },
  {
    "module": "AllocationManager",
    "name": "Staking allocation manager",
    "address": "0x2526fCdbA8F2ACBA0AC071E102c57eA4B83Ab3e6",
    "description": "Assigns Stock principal to eligible markets and handles position exits."
  },
  {
    "module": "ProtocolFeeVault",
    "name": "Protocol fee vault",
    "address": "0xcf24dBE80CAEaBaf4ca777CEdE365BAE4bD674ce",
    "description": "Accounts for trading fees and pays the corresponding reward shares."
  },
  {
    "module": "HolderRewardsDistributorV1",
    "name": "Holder rewards distributor",
    "address": "0xD923AB39A55006dd43662A36d83E3e62F5ecD08a",
    "description": "Holds funded Holder distributions and pays eligible snapshot claims."
  },
  {
    "module": "CreatorRevenueRegistry",
    "name": "Creator revenue registry",
    "address": "0x9247f7b0c326D2DB6E03bB551fE61741AA3Ed913",
    "description": "Records creator fee beneficiaries and their accepted handoffs."
  },
  {
    "module": "TickerGardenMemeHook",
    "name": "Pool fee hook",
    "address": "0x64EAe8957dfd203Bc87EE3B60faA43530d77A044",
    "description": "Applies the protocol trading-fee rules to the market\u2019s Uniswap v4 pool."
  },
  {
    "module": "GraduationExecutor",
    "name": "Bloom executor",
    "address": "0x4bf6b0cD468f31E76143025ddB4B4a7fc084b154",
    "description": "Creates the liquidity pool and locks the initial position when a market completes its curve."
  },
  {
    "module": "AccessManager",
    "name": "Governance access manager",
    "address": "0x31D69124e5A9e30962847687A66030A6944A5158",
    "description": "Enforces administrative roles and permission delays."
  },
  {
    "module": "TickerGardenBaselineRegistry",
    "name": "Protocol rules registry",
    "address": "0xEb34f8c73452666f9FdcF592247A55fB30e8Dd0C",
    "description": "Records the approved versions of market economics."
  },
  {
    "module": "LaunchTemplateRegistry",
    "name": "Launch template registry",
    "address": "0x86E0401802837e351e034583353738b94B8DAbCe",
    "description": "Records the available launch templates for new markets."
  },
  {
    "module": "LaunchConfigResolver",
    "name": "Launch configuration resolver",
    "address": "0x164F790a340d924EB42eCEC2bdcCb6b5Bb0a8211",
    "description": "Combines approved asset and template settings for a new launch."
  },
  {
    "module": "TickerMemeTokenV1Implementation",
    "name": "Token implementation",
    "address": "0xf0281901443e1cfe276e0016DE52B88da714cAe1",
    "description": "Shared template used to create each individual community token."
  },
  {
    "module": "TickerGardenCurveImplementation",
    "name": "Curve implementation",
    "address": "0x90790c598bad26a84873D76350d36865C6536B59",
    "description": "Shared template used to create each market\u2019s bonding curve."
  },
  {
    "module": "MemeStockGauge",
    "name": "Staking rewards implementation",
    "address": "0x4E6936C977C7c354BbAD238444ac3BF068762c56",
    "description": "Shared template for the per-market staking pools that account for active stake and rewards."
  },
  {
    "module": "LaunchLockerCreationCodeStore",
    "name": "Liquidity Locker creation store",
    "address": "0x598a2Aa14830BfB9319cB3A51b972F79a99C1CB8",
    "description": "Stores the template used to create permanent liquidity Lockers; this address is not a market\u2019s Locker."
  },
  {
    "module": "V1RobinhoodMainnetDeploymentOrchestrator",
    "name": "Production deployment coordinator",
    "address": "0xd8718c72968FD48982F2B8c391f6481269641996",
    "description": "Coordinates the initial setup of this production release; it is not a user deposit or trading entry point."
  },
  {
    "module": "V1HookExecutorDeployer",
    "name": "Pool integration deployer",
    "address": "0xF1b6F156E869985aF059D5559d71291F95BEBeA6",
    "description": "Creates the pool fee hook and Bloom executor during deployment; it is not a user trading entry point."
  }
] as const;
