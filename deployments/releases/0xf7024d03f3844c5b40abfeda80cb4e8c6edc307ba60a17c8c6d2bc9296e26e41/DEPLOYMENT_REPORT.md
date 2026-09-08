# Robinhood Chain Testnet deployment report

- Status: **DEPLOYED_VERIFIED_NOT_ACTIVATED**
- Chain: Robinhood Chain Testnet (46630)
- Release ID: `0xf7024d03f3844c5b40abfeda80cb4e8c6edc307ba60a17c8c6d2bc9296e26e41`
- Payload hash: `0x36a6748906456b77c78e24d3f0dac964f61b625099971119a9185f098fc75b78`
- Deployer/admin: `0xA6c3298a5559544c3b4cf8e6DC5f349f4be524ea`
- Total deployment and setup fee: 0.000560476440 ETH
- Remaining balance: 1.75944637 ETH

## Primary contracts

| Contract | Address |
| --- | --- |
| Platform treasury | `0xD84897cD860Da0B51D39a252961B18D54fBbb266` |
| Orchestrator | `0xBEac38aa168c09C9Fb978A91B7E4c0E0264102Ee` |
| Factory | `0xd945d3d16801b48e1268f69E2C10651925CCbCFb` |
| Hook | `0x45df010082D88722756f890fcDA1634f205B6044` |
| GraduationExecutor | `0x82ADBB9566cEaaac170Fc82808092Cda6675dEFd` |
| HookExecutorHelper | `0x9bD11A241d856f31346e8A82A01ac31D263b976A` |

## Components

| Component | Address |
| --- | --- |
| AccessManager | `0xaE8B567e6C89070eBD14112E14faf08A581C12dB` |
| OfficialStockRegistryV1 | `0x5a04e4dB95BcEFb7f4CddC7E27576f8D74029586` |
| ApprovedQuoteRegistry | `0x4FE87f1e7Eb36b70Ac47d335c169F6634048E9AA` |
| TickerGardenBaselineRegistry | `0x750F809fB647B542B21b9A9335f1cDd95A9EE389` |
| LaunchTemplateRegistry | `0xC5b4EEa812075BCc15B669Cdd5D39De3Bf39A855` |
| LaunchConfigResolver | `0x252D531896D5E3A8e479Ef652ac57Dc614D1E51D` |
| TickerMemeTokenV1Implementation | `0xCd4B6c541Cf839994d0F9ab451b58ca7F99914d6` |
| TickerGardenCurveImplementation | `0x4296A17179Df66fb9d88F849173f79c8e1a4C9FB` |
| MemeStockGauge | `0xb1F4C649Cc00121B0A4CdbA7098Ce88cB7939E48` |
| LaunchAndBuyRouter | `0xa3eDba183f586Cd0Eb9DE5080701bb9610F9f351` |
| MarketRegistryV1 | `0x5e09f948F0c51b35E9C6130ac028a43A66260792` |
| CreatorRevenueRegistry | `0x53C2f9412FFcC06E66a4421049fEf73B39E2f1fe` |
| AllocationManager | `0x4D62Ed1Ae353710f73A1A8A9ddeaa9301570A2ab` |
| UserStockVault | `0x8b58A2c4166D5a2Dad021D8772114b4b41813584` |
| HolderRewardsDistributorV1 | `0x9e8D8B91189c075860C0567fD08404f0114C20c9` |
| ProtocolFeeVault | `0xA6AAeddd288578D11b99F9fbFBCAf8eb113Ac38C` |

## Verification

- 21 runtime contracts matched the current compiled artifacts.
- 19 core deployment transactions and 2 setup transactions are confirmed.
- Hook permission mask is `0x2044`.
- Holder rewards stream duration is 86,400 seconds.
- FeeVault settlement operator is configured to the test operator.
- Registries, protocol roles, and markets remain unactivated.

## Scope limit

The chain 46630 Uniswap v4 dependencies are project-pinned test deployments, not an official Uniswap chain mapping. Robinhood Chain mainnet 4663 remains the production target.
