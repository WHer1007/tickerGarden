// Public contract address reference for Robinhood Chain mainnet (4663).
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
    "description": "Identifies the tokens and contracts associated with each market."
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
    "description": "Lists the paired assets available for launches and their Bloom targets."
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
    "description": "Pays published Holder rewards to eligible wallets."
  },
  {
    "module": "CreatorRevenueRegistry",
    "name": "Creator revenue registry",
    "address": "0x9247f7b0c326D2DB6E03bB551fE61741AA3Ed913",
    "description": "Records creator fee beneficiaries and their accepted handoffs."
  },
  {
    "module": "AccessManager",
    "name": "Governance access manager",
    "address": "0x31D69124e5A9e30962847687A66030A6944A5158",
    "description": "Controls who can change protocol settings and the required waiting periods."
  }
] as const;
