export declare const V1_EXECUTION_SPEC_ID: "V1-EXEC-11";
export declare const V1_ABI_FINGERPRINT: "sha256:d80208c1ac00e7e2ab31fa7ce94bee6ed4159a802519b9d0fdbdf5a300a81b41";
export declare const V1_ABI_SOURCES: readonly [{
    readonly module: "AllocationManager";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IAllocationManager.json";
    readonly artifactSha256: "3f0b6f49e56deb00fbe3d99c2d9fefb80c47ba4f9d1061a925270cb7df7d858b";
}, {
    readonly module: "ApprovedQuoteRegistry";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IApprovedQuoteRegistry.json";
    readonly artifactSha256: "91bf6117970557b204a96313f9499c22b94f8838293bb6bd7c0f591516817457";
}, {
    readonly module: "CreatorRevenueRegistry";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ICreatorRevenueRegistry.json";
    readonly artifactSha256: "fe8aadefdf9c0865c63c6242f244ee01b017c5672fa77b2bf9a0ea9c33711e28";
}, {
    readonly module: "GraduationExecutor";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IGraduationExecutor.json";
    readonly artifactSha256: "6efedadf21fdbcda230613e151e9c6d8eb7b46151a70015917e0b0b0fc0b2dd9";
}, {
    readonly module: "LaunchAndBuyRouter";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ILaunchAndBuyRouter.json";
    readonly artifactSha256: "07372bb828b86bd21215fd04c8f7d9b52ba5d0e572e4623a0083d9974b81089d";
}, {
    readonly module: "LaunchConfigResolver";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ILaunchConfigResolver.json";
    readonly artifactSha256: "844d5c0e10f76659b303d9ae0999488c635a0f0f9a69f131589815849aef9911";
}, {
    readonly module: "LaunchLocker";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ILaunchLocker.json";
    readonly artifactSha256: "c6be04ccdac6f8418ddce6f94871c13f62eae97752520dd1e1f22c9c902fce7a";
}, {
    readonly module: "LaunchTemplateRegistry";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ILaunchTemplateRegistry.json";
    readonly artifactSha256: "a3be1dce0c57585bd0047264dcc0ec85bbc6ad16ab9797323685ef14d808f7e2";
}, {
    readonly module: "MarketRegistryV1";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IMarketRegistryV1.json";
    readonly artifactSha256: "a45a2346bc502447c836b123996d18eba799c447184a438a82e32c0518a9ec85";
}, {
    readonly module: "MemeStockGauge";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IMemeStockGauge.json";
    readonly artifactSha256: "f7e662eb676ea4fe7ccd5cc7267e90f30ce8797eaf6dad234c3e5a7bb89717e2";
}, {
    readonly module: "OfficialStockRegistryV1";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IOfficialStockRegistryV1.json";
    readonly artifactSha256: "3f3e335a72c14b4c4bfd2da389609c97f7d4216ba9eec19bd511053d01a6409a";
}, {
    readonly module: "ProtocolFeeVault";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IProtocolFeeVault.json";
    readonly artifactSha256: "0d612f6854534bdd2eda2d992c3fd11099ca34708fa3f02d558a63fe64f6e737";
}, {
    readonly module: "TickerGardenBaselineRegistry";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ITickerGardenBaselineRegistry.json";
    readonly artifactSha256: "09126f378481428ccc0aa50070c516ce8dd433ea5466a1b2b9797f7f17f038b1";
}, {
    readonly module: "TickerGardenCurve";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ITickerGardenCurve.json";
    readonly artifactSha256: "8221518f472cf9cd302b2a6fdd26482053e7d6a238b5e0deec331738a858e8e7";
}, {
    readonly module: "TickerGardenFactoryV1";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ITickerGardenFactoryV1.json";
    readonly artifactSha256: "d1ceb27bde6619d74ba95247bdaf434f133318e4935a2e78cc56be08b15e07dd";
}, {
    readonly module: "TickerGardenMemeHook";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ITickerGardenMemeHook.json";
    readonly artifactSha256: "62f117220032a827f535a274dc0dae0b91d8854682e1f6df9af701bd3058f809";
}, {
    readonly module: "TickerMemeTokenV1";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ITickerMemeTokenV1.json";
    readonly artifactSha256: "8241a9ee575887e831e43953d4d6ff0146e78b69cac703811bdee46840d54a1e";
}, {
    readonly module: "TreasuryDistributorV1";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/ITreasuryDistributorV1.json";
    readonly artifactSha256: "71dbc2eab4258865b47bc52c3b384fd1f890c5cc2547a496bf01ba95dadc454c";
}, {
    readonly module: "UserStockVault";
    readonly artifact: "contracts/out-v1/IV1Protocol.sol/IUserStockVault.json";
    readonly artifactSha256: "7ed340580249eb241aac3592b19bbbb5473af909f4b9fb52496ca32f1593683f";
}];
export declare const legacyV1Abis: {
    readonly AllocationManager: readonly [{
        readonly type: "function";
        readonly name: "allocate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "closeAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "depositAndAllocate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "increaseAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "marketRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "officialStockRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rageQuit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "rageQuitRewardCutoff";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output3";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rageQuitSettlementPending";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "recordGaugeRewardState";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "rewardCohortEpoch";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rewardEligibleActiveStock";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "settleRageQuitRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output2";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "stake";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "unstakeAndWithdraw";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "AllocationRageQuitExecuted";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "principal";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteForfeited";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeForfeited";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "redistributed";
            readonly type: "bool";
            readonly indexed: false;
            readonly internalType: "bool";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RageQuitRewardSettlementDeferred";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "principal";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "gauge";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RageQuitRewardSettlementFinalized";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "principal";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteForfeited";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeForfeited";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "redistributed";
            readonly type: "bool";
            readonly indexed: false;
            readonly internalType: "bool";
        }];
        readonly anonymous: false;
    }];
    readonly ApprovedQuoteRegistry: readonly [{
        readonly type: "function";
        readonly name: "addQuoteConfig";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct QuoteAssetConfig";
            readonly components: readonly [{
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteDecimals";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }, {
                readonly name: "phantomQuote";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "graduationThreshold";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "economicsHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "addStockQuoteConfig";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct QuoteAssetConfig";
            readonly components: readonly [{
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteDecimals";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }, {
                readonly name: "phantomQuote";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "graduationThreshold";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "economicsHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }, {
            readonly name: "arg2";
            readonly type: "tuple";
            readonly internalType: "struct StockQuoteBinding";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "stockTokenFingerprintHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "referenceEvidenceHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "generatorPolicyId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }];
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "officialStockRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "pauseQuote";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "quoteConfig";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct QuoteAssetConfig";
            readonly components: readonly [{
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteDecimals";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }, {
                readonly name: "phantomQuote";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "graduationThreshold";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "economicsHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "quoteIdentityCurrent";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "quoteRuntimeCodeHash";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "retireQuote";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "stockQuoteBinding";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct StockQuoteBinding";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "stockTokenFingerprintHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "referenceEvidenceHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "generatorPolicyId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "unpauseQuote";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "QuoteAssetConfigAdded";
        readonly inputs: readonly [{
            readonly name: "configId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "tickerGardenBaselineId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "economicsHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "QuoteAssetIdentityPinned";
        readonly inputs: readonly [{
            readonly name: "configId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "runtimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "QuoteAssetStatusChanged";
        readonly inputs: readonly [{
            readonly name: "configId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "newStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StockQuoteConfigBound";
        readonly inputs: readonly [{
            readonly name: "configId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "stockTokenFingerprintHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "referenceEvidenceHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "generatorPolicyId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }];
    readonly CreatorRevenueRegistry: readonly [{
        readonly type: "function";
        readonly name: "acceptCreatorRevenueBeneficiary";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "cancelCreatorRevenueBeneficiaryTransfer";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "creatorBeneficiaryAt";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "currentCreatorEpoch";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "factory";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "initializeCreatorRevenueEpoch";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "marketRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "pendingCreatorRevenueBeneficiary";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "transferCreatorRevenueBeneficiary";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "CreatorRevenueBeneficiaryProposed";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "currentBeneficiary";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "pendingBeneficiary";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CreatorRevenueBeneficiaryTransferCancelled";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CreatorRevenueBeneficiaryUpdated";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldEpoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "newEpoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "oldBeneficiary";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "newBeneficiary";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CreatorRevenueEpochInitialized";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "beneficiary";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }];
    readonly GraduationExecutor: readonly [{
        readonly type: "function";
        readonly name: "approvedQuoteRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "factory";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "graduateFromCurve";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "hook";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "launchLockerCreationCodeHash";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "permit2";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "poolManager";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "positionManager";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "predictLaunchLocker";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "PoolGraduated";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "launchLocker";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "sweptQuote";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "sweptTokens";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "poolQuoteAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "poolMemeAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "lockedExcessQuote";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "lockedExcessMeme";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "sourceVersion";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }];
        readonly anonymous: false;
    }];
    readonly LaunchAndBuyRouter: readonly [{
        readonly type: "function";
        readonly name: "approvedQuoteRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "factory";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "launchAndBuy";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "tuple";
            readonly internalType: "struct CreateMarketParams";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchTemplateId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "expectedEconomics";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorRevenueBeneficiary";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "name";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "symbol";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "metadataURI";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "salt";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorTaxBps";
                readonly type: "uint16";
                readonly internalType: "uint16";
            }, {
                readonly name: "creatorFeesToHolders";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "stakingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "output1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "poolManager";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "unlockCallback";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes";
            readonly internalType: "bytes";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes";
            readonly internalType: "bytes";
        }];
        readonly stateMutability: "nonpayable";
    }];
    readonly LaunchConfigResolver: readonly [{
        readonly type: "function";
        readonly name: "approvedQuoteRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "launchTemplateRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "resolve";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct QuoteAssetConfig";
            readonly components: readonly [{
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteDecimals";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }, {
                readonly name: "phantomQuote";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "graduationThreshold";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "economicsHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }, {
            readonly name: "output1";
            readonly type: "tuple";
            readonly internalType: "struct TickerGardenBaseline";
            readonly components: readonly [{
                readonly name: "referenceChainId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "referenceFactory";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "referenceFactoryCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchConfigId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "supply";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "curveFeeBps";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "poolFee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "behaviorVectorRoot";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }, {
            readonly name: "output2";
            readonly type: "tuple";
            readonly internalType: "struct LaunchTemplate";
            readonly components: readonly [{
                readonly name: "memeTokenImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "memeTokenCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "curveImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "curveCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "gaugeImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "gaugeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "graduatedHook";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "hookCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "graduationExecutor";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "graduationExecutorCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "feePolicyId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "executionSpecId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "tickerGardenBaselineRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }];
    readonly LaunchLocker: readonly [{
        readonly type: "function";
        readonly name: "lockedPosition";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketId";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "unpairedLockedBalance";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }];
    readonly LaunchTemplateRegistry: readonly [{
        readonly type: "function";
        readonly name: "addLaunchTemplate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct LaunchTemplate";
            readonly components: readonly [{
                readonly name: "memeTokenImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "memeTokenCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "curveImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "curveCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "gaugeImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "gaugeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "graduatedHook";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "hookCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "graduationExecutor";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "graduationExecutorCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "feePolicyId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "executionSpecId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "launchTemplate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct LaunchTemplate";
            readonly components: readonly [{
                readonly name: "memeTokenImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "memeTokenCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "curveImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "curveCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "gaugeImplementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "gaugeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "graduatedHook";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "hookCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "graduationExecutor";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "graduationExecutorCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "feePolicyId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "executionSpecId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "launchTemplateHash";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "pauseLaunchTemplate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "retireLaunchTemplate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "unpauseLaunchTemplate";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "LaunchTemplateAdded";
        readonly inputs: readonly [{
            readonly name: "launchTemplateId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "templateHash";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "executionSpecId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "LaunchTemplateStatusChanged";
        readonly inputs: readonly [{
            readonly name: "launchTemplateId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "newStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }];
    readonly MarketRegistryV1: readonly [{
        readonly type: "function";
        readonly name: "activeFeeSource";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "approvedQuoteRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "canonicalPoolId";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "canonicalPoolKey";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct PoolKey";
            readonly components: readonly [{
                readonly name: "currency0";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "currency1";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "fee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "hooks";
                readonly type: "address";
                readonly internalType: "address";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "canonicalRoute";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct CanonicalRoute";
            readonly components: readonly [{
                readonly name: "poolKey";
                readonly type: "tuple";
                readonly internalType: "struct PoolKey";
                readonly components: readonly [{
                    readonly name: "currency0";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "currency1";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "fee";
                    readonly type: "uint24";
                    readonly internalType: "uint24";
                }, {
                    readonly name: "tickSpacing";
                    readonly type: "int24";
                    readonly internalType: "int24";
                }, {
                    readonly name: "hooks";
                    readonly type: "address";
                    readonly internalType: "address";
                }];
            }, {
                readonly name: "poolId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "swapRouter";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoter";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "hook";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "memeToken";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "gauge";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "curve";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "launchLocker";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "sourceVersion";
                readonly type: "uint32";
                readonly internalType: "uint32";
            }, {
                readonly name: "launchPhase";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }, {
                readonly name: "curveTradingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "poolTradingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "commitPoolCreated";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "factory";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "graduationExecutor";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "launchTemplateRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "market";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct MarketView";
            readonly components: readonly [{
                readonly name: "config";
                readonly type: "tuple";
                readonly internalType: "struct MarketConfig";
                readonly components: readonly [{
                    readonly name: "assetUid";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "tickerGardenBaselineId";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "quoteAssetConfigId";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "launchTemplateId";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "feePolicyId";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "executionSpecId";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "expectedEconomics";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "launchConfigId";
                    readonly type: "uint256";
                    readonly internalType: "uint256";
                }, {
                    readonly name: "creatorRevenueBeneficiaryAtCreation";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "memeToken";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "curve";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "gauge";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "quoteAsset";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "graduatedHook";
                    readonly type: "address";
                    readonly internalType: "address";
                }, {
                    readonly name: "creatorTaxBps";
                    readonly type: "uint16";
                    readonly internalType: "uint16";
                }, {
                    readonly name: "creatorFeesToHolders";
                    readonly type: "bool";
                    readonly internalType: "bool";
                }, {
                    readonly name: "stakingEnabled";
                    readonly type: "bool";
                    readonly internalType: "bool";
                }];
            }, {
                readonly name: "runtime";
                readonly type: "tuple";
                readonly internalType: "struct MarketRuntime";
                readonly components: readonly [{
                    readonly name: "poolId";
                    readonly type: "bytes32";
                    readonly internalType: "bytes32";
                }, {
                    readonly name: "sourceVersion";
                    readonly type: "uint32";
                    readonly internalType: "uint32";
                }, {
                    readonly name: "launchPhase";
                    readonly type: "uint8";
                    readonly internalType: "uint8";
                }];
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketIdByToken";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "officialStockRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "quoter";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "registerMarket";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct MarketConfig";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchTemplateId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "feePolicyId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "executionSpecId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "expectedEconomics";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchConfigId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "creatorRevenueBeneficiaryAtCreation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "memeToken";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "curve";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "gauge";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "graduatedHook";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "creatorTaxBps";
                readonly type: "uint16";
                readonly internalType: "uint16";
            }, {
                readonly name: "creatorFeesToHolders";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "stakingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "swapRouter";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "tickerGardenBaselineRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "LaunchPhaseChanged";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldPhase";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "newPhase";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "sourceVersion";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "MarketRegistered";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "memeToken";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "curve";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "gauge";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "sourceVersion";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }];
        readonly anonymous: false;
    }];
    readonly MemeStockGauge: readonly [{
        readonly type: "function";
        readonly name: "activationSlot";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct ActivationSlot";
            readonly components: readonly [{
                readonly name: "generation";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "amount";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "refs";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "activationSnapshot";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct ActivationSnapshot";
            readonly components: readonly [{
                readonly name: "quoteAccumulator";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "memeAccumulator";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "refs";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "processed";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "addPending";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "arg3";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "checkpointActivations";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "consumeClaimable";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "consumeForConversion";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "creditConversion";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "creditStakerFee";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "deferredForfeiture";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "effectiveTotalActiveStock";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "flushDeferredForfeiture";
        readonly inputs: readonly [];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "gaugeIdentity";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct GaugeIdentity";
            readonly components: readonly [{
                readonly name: "marketId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "allocationManager";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "protocolFeeVault";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "memeToken";
                readonly type: "address";
                readonly internalType: "address";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "positionOf";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct PositionView";
            readonly components: readonly [{
                readonly name: "activeAmount";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "pendingAmount";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "pendingGeneration";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "unlockAt";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "quoteClaimable";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "memeClaimable";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rageQuit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output3";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "removeAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "rewardState";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct RewardStateView";
            readonly components: readonly [{
                readonly name: "accFeePerShare";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "indexRemainder";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "settle";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "storedTotalActiveStock";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "totalPendingStock";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "ActivationBucketProcessed";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "generation";
            readonly type: "uint64";
            readonly indexed: true;
            readonly internalType: "uint64";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteAccumulator";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeAccumulator";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "refs";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "ForfeitureRecordDeferred";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "quoteAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "totalDeferredQuote";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "totalDeferredMeme";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "ForfeitureRecordFlushed";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "quoteAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "GaugeRageQuit";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "principal";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteForfeited";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeForfeited";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "redistributed";
            readonly type: "bool";
            readonly indexed: false;
            readonly internalType: "bool";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "PendingMaterialized";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "generation";
            readonly type: "uint64";
            readonly indexed: true;
            readonly internalType: "uint64";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "PendingRescheduled";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldGeneration";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "newGeneration";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "combinedAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "unlockAt";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "PendingScheduled";
        readonly inputs: readonly [{
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "generation";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "unlockAt";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StakerFeeCredited";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "feeId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "accumulatorDelta";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "indexRemainder";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }];
    readonly OfficialStockRegistryV1: readonly [{
        readonly type: "function";
        readonly name: "acceptAssetImplementation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg3";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "asset";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct AssetView";
            readonly components: readonly [{
                readonly name: "stockToken";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "userStockVault";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "tokenDecimals";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "assetFingerprint";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct StockTokenFingerprint";
            readonly components: readonly [{
                readonly name: "tokenRuntimeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "beacon";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "beaconRuntimeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "implementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "implementationRuntimeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "assetIdentityCurrent";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "minimumAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "pauseAsset";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "registerAsset";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }, {
            readonly name: "arg3";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg4";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg5";
            readonly type: "tuple";
            readonly internalType: "struct StockTokenFingerprint";
            readonly components: readonly [{
                readonly name: "tokenRuntimeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "beacon";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "beaconRuntimeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "implementation";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "implementationRuntimeCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }];
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "retireAsset";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "setMinimumAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "unpauseAsset";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "vaultForSchema";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "vaultIdentityCurrent";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "vaultRuntimeCodeHash";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "vaultSchemaId";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "AssetImplementationAccepted";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldImplementation";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "newImplementation";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "oldImplementationRuntimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "newImplementationRuntimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "AssetMinimumAllocationChanged";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldMinimum";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "newMinimum";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "AssetRegistered";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "stockToken";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "userStockVault";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "tokenDecimals";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "AssetStatusChanged";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "newStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StockTokenFingerprintRegistered";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "tokenRuntimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "beacon";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "beaconRuntimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "implementation";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "implementationRuntimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StockVaultCodeIdentityPinned";
        readonly inputs: readonly [{
            readonly name: "userStockVault";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "runtimeCodeHash";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StockVaultRegistered";
        readonly inputs: readonly [{
            readonly name: "userStockVault";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "schemaId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "marketRegistry";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "allocationManager";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }];
    readonly ProtocolFeeVault: readonly [{
        readonly type: "function";
        readonly name: "beginCurveCredit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg4";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg5";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "arg6";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "beginV4Credit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg4";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "cancelRawRewardExit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claimCreator";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claimPlatform";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claimStaker";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claimStakerFor";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claimUserRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }, {
            readonly name: "arg2";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg3";
            readonly type: "bool";
            readonly internalType: "bool";
        }, {
            readonly name: "arg4";
            readonly type: "bool";
            readonly internalType: "bool";
        }, {
            readonly name: "arg5";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "consumedFeeId";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "conversionNonce";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "convertUserClaim";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "creatorLiability";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "creatorRevenueRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "feePolicyHash";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "feePolicyId";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "finalizeCurveCredit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg4";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg5";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "arg6";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "finalizeV4Credit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg4";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg5";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg6";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "arg7";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "forfeitureReserve";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "fundHolderMemeRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "fundHolderRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "holderLiability";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "liability";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "platformTreasury";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "poolManager";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rawRewardExitAt";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "recordForfeiture";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "requestRawRewardExit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "setSettlementOperator";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "settleHolderRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg4";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "settleRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple[]";
            readonly internalType: "struct ConversionItem[]";
            readonly components: readonly [{
                readonly name: "user";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "creatorEpoch";
                readonly type: "uint32";
                readonly internalType: "uint32";
            }, {
                readonly name: "maximumMeme";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }];
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "settlementOperator";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "totalLiability";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "userClaimMode";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "pure";
    }, {
        readonly type: "event";
        readonly name: "CurveFeesSwept";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "creatorEpoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "sweepNonce";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "feeId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "creatorAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "platformAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "FeeBucketsCredited";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "creatorEpoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "feeId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "creatorAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "stakerAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "platformAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "activeStock";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "FeeClaimed";
        readonly inputs: readonly [{
            readonly name: "beneficiaryType";
            readonly type: "uint8";
            readonly indexed: true;
            readonly internalType: "uint8";
        }, {
            readonly name: "beneficiary";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "beneficiaryEpoch";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "ForfeitureReserveConverted";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "ForfeitureReserved";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "reserveBalance";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "HolderFeesAccrued";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "HolderRewardsConverted";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "memeAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "memeSpent";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteReceived";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RawRewardExitCancelled";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RawRewardExitRequested";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "availableAt";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RewardBatchConverted";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "nonce";
            readonly type: "uint256";
            readonly indexed: true;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "memeSpent";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteReceived";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RewardConverted";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "creatorEpoch";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "memeSpent";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteReceived";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "SettlementOperatorUpdated";
        readonly inputs: readonly [{
            readonly name: "operator";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "UserRewardsClaimed";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "role";
            readonly type: "uint8";
            readonly indexed: true;
            readonly internalType: "uint8";
        }, {
            readonly name: "creatorEpoch";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }, {
            readonly name: "quotePaid";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memePaid";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeRetained";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "memeConverted";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "conversionFailed";
            readonly type: "bool";
            readonly indexed: false;
            readonly internalType: "bool";
        }];
        readonly anonymous: false;
    }];
    readonly TickerGardenBaselineRegistry: readonly [{
        readonly type: "function";
        readonly name: "addBaseline";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct TickerGardenBaseline";
            readonly components: readonly [{
                readonly name: "referenceChainId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "referenceFactory";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "referenceFactoryCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchConfigId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "supply";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "curveFeeBps";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "poolFee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "behaviorVectorRoot";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "baseline";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct TickerGardenBaseline";
            readonly components: readonly [{
                readonly name: "referenceChainId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "referenceFactory";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "referenceFactoryCodeHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchConfigId";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "supply";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "curveFeeBps";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "poolFee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "behaviorVectorRoot";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "pauseBaseline";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "retireBaseline";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "unpauseBaseline";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "TickerGardenBaselineAdded";
        readonly inputs: readonly [{
            readonly name: "baselineId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "behaviorVectorRoot";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "factoryCodeHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "TickerGardenBaselineStatusChanged";
        readonly inputs: readonly [{
            readonly name: "baselineId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "oldStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "newStatus";
            readonly type: "uint8";
            readonly indexed: false;
            readonly internalType: "uint8";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }];
    readonly TickerGardenCurve: readonly [{
        readonly type: "function";
        readonly name: "accruedCreatorTax";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "accruedCurveFees";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "buy";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "creatorTaxBps";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint16";
            readonly internalType: "uint16";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "getReserves";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "quoteAsset";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "quoteBuy";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "quoteSell";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "readyToGraduate";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "realQuoteReserve";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "reservedTokens";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "sell";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "sellableTokens";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "sweepCurveFees";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "sweepNonce";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "CurveBuy";
        readonly inputs: readonly [{
            readonly name: "buyer";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "recipient";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "quoteIn";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "tokensOut";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "fee";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "tax";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CurveBuyRefunded";
        readonly inputs: readonly [{
            readonly name: "buyer";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "unusedQuote";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CurveCompleted";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CurveFeeTransferred";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "sweepNonce";
            readonly type: "uint64";
            readonly indexed: true;
            readonly internalType: "uint64";
        }, {
            readonly name: "feeId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "CurveSell";
        readonly inputs: readonly [{
            readonly name: "seller";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "recipient";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "tokensIn";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "quoteOut";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "fee";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "tax";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }];
    readonly TickerGardenFactoryV1: readonly [{
        readonly type: "function";
        readonly name: "createMarket";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "tuple";
            readonly internalType: "struct CreateMarketParams";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchTemplateId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "expectedEconomics";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorRevenueBeneficiary";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "name";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "symbol";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "metadataURI";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "salt";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorTaxBps";
                readonly type: "uint16";
                readonly internalType: "uint16";
            }, {
                readonly name: "creatorFeesToHolders";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "stakingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "output1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output2";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output3";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "createMarketFor";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct CreateMarketParams";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchTemplateId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "expectedEconomics";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorRevenueBeneficiary";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "name";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "symbol";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "metadataURI";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "salt";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorTaxBps";
                readonly type: "uint16";
                readonly internalType: "uint16";
            }, {
                readonly name: "creatorFeesToHolders";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "stakingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "output1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output2";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output3";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "creatorRevenueRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "launchFee";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "predictMarketAddresses";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct CreateMarketParams";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchTemplateId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "expectedEconomics";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorRevenueBeneficiary";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "name";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "symbol";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "metadataURI";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "salt";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorTaxBps";
                readonly type: "uint16";
                readonly internalType: "uint16";
            }, {
                readonly name: "creatorFeesToHolders";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "stakingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "output1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output2";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output3";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output4";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "previewMarketEconomics";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "tuple";
            readonly internalType: "struct CreateMarketParams";
            readonly components: readonly [{
                readonly name: "assetUid";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "tickerGardenBaselineId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAssetConfigId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "launchTemplateId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "expectedEconomics";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorRevenueBeneficiary";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "name";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "symbol";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "metadataURI";
                readonly type: "string";
                readonly internalType: "string";
            }, {
                readonly name: "salt";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "creatorTaxBps";
                readonly type: "uint16";
                readonly internalType: "uint16";
            }, {
                readonly name: "creatorFeesToHolders";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "stakingEnabled";
                readonly type: "bool";
                readonly internalType: "bool";
            }];
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "runtimeBindings";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output2";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output3";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output4";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output5";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output6";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output7";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "treasuryDistributor";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "MarketCreated";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "memeToken";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "curve";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "gauge";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "quoteAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "tickerGardenBaselineId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "quoteAssetConfigId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "expectedEconomics";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }];
    readonly TickerGardenMemeHook: readonly [{
        readonly type: "function";
        readonly name: "activatePool";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "afterSwap";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct PoolKey";
            readonly components: readonly [{
                readonly name: "currency0";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "currency1";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "fee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "hooks";
                readonly type: "address";
                readonly internalType: "address";
            }];
        }, {
            readonly name: "arg2";
            readonly type: "tuple";
            readonly internalType: "struct SwapParams";
            readonly components: readonly [{
                readonly name: "zeroForOne";
                readonly type: "bool";
                readonly internalType: "bool";
            }, {
                readonly name: "amountSpecified";
                readonly type: "int256";
                readonly internalType: "int256";
            }, {
                readonly name: "sqrtPriceLimitX96";
                readonly type: "uint160";
                readonly internalType: "uint160";
            }];
        }, {
            readonly name: "arg3";
            readonly type: "int256";
            readonly internalType: "int256";
        }, {
            readonly name: "arg4";
            readonly type: "bytes";
            readonly internalType: "bytes";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes4";
            readonly internalType: "bytes4";
        }, {
            readonly name: "output1";
            readonly type: "int128";
            readonly internalType: "int128";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "beforeInitialize";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct PoolKey";
            readonly components: readonly [{
                readonly name: "currency0";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "currency1";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "fee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "hooks";
                readonly type: "address";
                readonly internalType: "address";
            }];
        }, {
            readonly name: "arg2";
            readonly type: "uint160";
            readonly internalType: "uint160";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes4";
            readonly internalType: "bytes4";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "convertRewards";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "graduationExecutor";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "hookPermissionMask";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint160";
            readonly internalType: "uint160";
        }];
        readonly stateMutability: "pure";
    }, {
        readonly type: "function";
        readonly name: "marketOfPool";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "poolBinding";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct PoolBinding";
            readonly components: readonly [{
                readonly name: "marketId";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "keyHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "sourceVersion";
                readonly type: "uint32";
                readonly internalType: "uint32";
            }, {
                readonly name: "feeNonce";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "uint8";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "poolManager";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "protocolFeeVault";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "registerExpectedPool";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "tuple";
            readonly internalType: "struct PoolKey";
            readonly components: readonly [{
                readonly name: "currency0";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "currency1";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "fee";
                readonly type: "uint24";
                readonly internalType: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
                readonly internalType: "int24";
            }, {
                readonly name: "hooks";
                readonly type: "address";
                readonly internalType: "address";
            }];
        }, {
            readonly name: "arg2";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "unlockCallback";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes";
            readonly internalType: "bytes";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes";
            readonly internalType: "bytes";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "ExpectedPoolRegistered";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "keyHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "sourceVersion";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "PoolBindingActivated";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "sourceVersion";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "V4FeeAccrued";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "feeAsset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "feeNonce";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "feeId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "base";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "totalFee";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "lpAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "nonLpAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }];
    readonly TickerMemeTokenV1: readonly [{
        readonly type: "function";
        readonly name: "allowance";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "approve";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "balanceOf";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "burnTreasury";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "continuousRewardsEnabled";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "creator";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "decimals";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint8";
            readonly internalType: "uint8";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "deployedAt";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "enableContinuousRewards";
        readonly inputs: readonly [];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "factory";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "initialSupply";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketId";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "metadataURI";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "string";
            readonly internalType: "string";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "name";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "string";
            readonly internalType: "string";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "symbol";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "string";
            readonly internalType: "string";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "totalSupply";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "transfer";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "transferFrom";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "treasuryDistributor";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "event";
        readonly name: "Approval";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "spender";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "value";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "Transfer";
        readonly inputs: readonly [{
            readonly name: "from";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "to";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "value";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "TreasuryBurn";
        readonly inputs: readonly [{
            readonly name: "treasuryDistributor";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "totalSupplyAfter";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }];
    readonly TreasuryDistributorV1: readonly [{
        readonly type: "function";
        readonly name: "accountClaimed";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "activateMarket";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "burnMeme";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "cancelPendingRoot";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claim";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg4";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg5";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg6";
            readonly type: "bytes32[]";
            readonly internalType: "bytes32[]";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "claimLeaf";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg4";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg5";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "currentEpochId";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "epoch";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct TreasuryEpochV1";
            readonly components: readonly [{
                readonly name: "requestedAt";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "publishBy";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "finalizeAfter";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "claimUntil";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "sourceBlockNumber";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }, {
                readonly name: "leafCount";
                readonly type: "uint32";
                readonly internalType: "uint32";
            }, {
                readonly name: "status";
                readonly type: "uint8";
                readonly internalType: "enum TreasuryEpochStatusV1";
            }, {
                readonly name: "requester";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "serviceFeeAsset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "serviceFeeAmount";
                readonly type: "uint128";
                readonly internalType: "uint128";
            }, {
                readonly name: "sourceBlockHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "merkleRoot";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "datasetHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "quoteAmount";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "claimedAmount";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }, {
                readonly name: "totalTwab";
                readonly type: "uint256";
                readonly internalType: "uint256";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "epochQuoteAmount";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "epochWindow";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }, {
            readonly name: "output1";
            readonly type: "uint64";
            readonly internalType: "uint64";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "expireRootRequest";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "feeSharingExcludedAccounts";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address[]";
            readonly internalType: "address[]";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "feeSharingVault";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "finalizeRoot";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "fundCreatorFees";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "fundQuoteTreasury";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "isClaimed";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "market";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct TreasuryMarketV1";
            readonly components: readonly [{
                readonly name: "memeToken";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "quoteToken";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "eligibilityPolicyHash";
                readonly type: "bytes32";
                readonly internalType: "bytes32";
            }, {
                readonly name: "activatedAt";
                readonly type: "uint64";
                readonly internalType: "uint64";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketRegistry";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "operationConsumed";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "bool";
            readonly internalType: "bool";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "publishRoot";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg3";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg4";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg5";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "arg6";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "registerFeeSharingMarket";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "registerMarket";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg3";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "requestRoot";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "payable";
    }, {
        readonly type: "function";
        readonly name: "rolloverExpiredEpoch";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint32";
            readonly internalType: "uint32";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "rootServiceFee";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "tuple";
            readonly internalType: "struct RootServiceFeeV1";
            readonly components: readonly [{
                readonly name: "asset";
                readonly type: "address";
                readonly internalType: "address";
            }, {
                readonly name: "amount";
                readonly type: "uint128";
                readonly internalType: "uint128";
            }];
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "serviceCredit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "setRootServiceFee";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg1";
            readonly type: "uint128";
            readonly internalType: "uint128";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "totalQuoteLiability";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "totalServiceLiability";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "withdrawServiceCredit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "EpochRemainderRolledOver";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "fromEpochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "toEpochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "MemeTreasuryBurned";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "funder";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "memeToken";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "burnId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "totalSupplyAfter";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "PendingRootCancelled";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "reasonHash";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "QuoteTreasuryFunded";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "funder";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "quoteToken";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "fundingId";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RootFinalized";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "merkleRoot";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "claimUntil";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RootPublished";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "merkleRoot";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "datasetHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "totalTwab";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "leafCount";
            readonly type: "uint32";
            readonly indexed: false;
            readonly internalType: "uint32";
        }, {
            readonly name: "finalizeAfter";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RootRequestExpired";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "requester";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RootRequested";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "requester";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "windowStart";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "windowEnd";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "sourceBlockNumber";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }, {
            readonly name: "sourceBlockHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }, {
            readonly name: "quoteAmount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "serviceFeeAsset";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "serviceFeeAmount";
            readonly type: "uint128";
            readonly indexed: false;
            readonly internalType: "uint128";
        }, {
            readonly name: "publishBy";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RootServiceFeeUpdated";
        readonly inputs: readonly [{
            readonly name: "asset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint128";
            readonly indexed: false;
            readonly internalType: "uint128";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "ServiceCreditWithdrawn";
        readonly inputs: readonly [{
            readonly name: "asset";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "beneficiary";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "TreasuryClaimed";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "epochId";
            readonly type: "uint32";
            readonly indexed: true;
            readonly internalType: "uint32";
        }, {
            readonly name: "leafIndex";
            readonly type: "uint256";
            readonly indexed: true;
            readonly internalType: "uint256";
        }, {
            readonly name: "account";
            readonly type: "address";
            readonly indexed: false;
            readonly internalType: "address";
        }, {
            readonly name: "twab";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "TreasuryMarketActivated";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "activatedAt";
            readonly type: "uint64";
            readonly indexed: false;
            readonly internalType: "uint64";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "TreasuryMarketRegistered";
        readonly inputs: readonly [{
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "memeToken";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "quoteToken";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "eligibilityPolicyHash";
            readonly type: "bytes32";
            readonly indexed: false;
            readonly internalType: "bytes32";
        }];
        readonly anonymous: false;
    }];
    readonly UserStockVault: readonly [{
        readonly type: "function";
        readonly name: "allocated";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "allocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "completeRageQuitRewardSettlement";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "depositStock";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "depositStockFor";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "deposited";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "freeBalanceOf";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "lockAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "marketAllocated";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketRewardCohortEpoch";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "marketRewardEligible";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rageQuit";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "rageQuitAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "rageQuitRewardCutoff";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "output3";
            readonly type: "bool";
            readonly internalType: "bool";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "rageQuitSettlementPrincipal";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "recordGaugeRewardState";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg2";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }, {
            readonly name: "arg3";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "releaseAllocation";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "releaseAllocationAndWithdraw";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "arg2";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "function";
        readonly name: "totalAllocated";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "totalDeposited";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "vaultIdentity";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly name: "output0";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output1";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output2";
            readonly type: "address";
            readonly internalType: "address";
        }, {
            readonly name: "output3";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }];
        readonly stateMutability: "view";
    }, {
        readonly type: "function";
        readonly name: "withdrawFreeStock";
        readonly inputs: readonly [{
            readonly name: "arg0";
            readonly type: "bytes32";
            readonly internalType: "bytes32";
        }, {
            readonly name: "arg1";
            readonly type: "uint256";
            readonly internalType: "uint256";
        }];
        readonly outputs: readonly [];
        readonly stateMutability: "nonpayable";
    }, {
        readonly type: "event";
        readonly name: "AllocationLocked";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "userMarketAllocation";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "userTotalAllocated";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "AllocationRageQuit";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "AllocationReleased";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "userMarketAllocation";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }, {
            readonly name: "userTotalAllocated";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RageQuitRewardSettlementCompleted";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "principal";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "RageQuitRewardSettlementQueued";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "marketId";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "principal";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StockDeposited";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }, {
        readonly type: "event";
        readonly name: "StockWithdrawn";
        readonly inputs: readonly [{
            readonly name: "assetUid";
            readonly type: "bytes32";
            readonly indexed: true;
            readonly internalType: "bytes32";
        }, {
            readonly name: "user";
            readonly type: "address";
            readonly indexed: true;
            readonly internalType: "address";
        }, {
            readonly name: "amount";
            readonly type: "uint256";
            readonly indexed: false;
            readonly internalType: "uint256";
        }];
        readonly anonymous: false;
    }];
};
export type V1ModuleName = keyof typeof legacyV1Abis;
//# sourceMappingURL=legacy-abis.d.ts.map