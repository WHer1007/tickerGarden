// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetView,
    CreateMarketParams,
    IApprovedQuoteRegistry,
    ILaunchTemplateRegistry,
    IOfficialStockRegistryV1,
    IPonsBaselineRegistry,
    IUserStockVault,
    LaunchTemplate,
    PonsBaseline,
    QuoteAssetConfig
} from "../interfaces/IV1Protocol.sol";
import {V1MarketEconomics} from "./V1MarketEconomics.sol";
import {V1GraduationEconomicDomain} from "../libraries/V1GraduationEconomicDomain.sol";

/// @notice Fail-closed Registry resolution and economics verification shared by Factory create and preview paths.
library V1FactoryValidation {
    uint8 internal constant ACTIVE = 1;
    bytes32 internal constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-8");
    uint24 internal constant FEE_PIPS = 10_000;
    uint16 internal constant LP_SHARE_BPS = 0;
    uint24 internal constant POOL_KEY_FEE = 0;
    uint160 internal constant HOOK_PERMISSION_MASK = 0x2044;
    uint8 internal constant FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA = 1;
    uint16 internal constant STAKER_NON_LP_SHARE_BPS = 3_000;
    uint16 internal constant PLATFORM_NON_LP_SHARE_BPS = 3_000;
    bytes32 internal constant REQUIRED_VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v6");

    struct Registries {
        IOfficialStockRegistryV1 officialStock;
        IApprovedQuoteRegistry approvedQuote;
        IPonsBaselineRegistry ponsBaseline;
        ILaunchTemplateRegistry launchTemplate;
    }

    struct Policy {
        bytes32 feePolicyId;
        V1MarketEconomics.FeePolicyInput fields;
    }

    struct Snapshot {
        AssetView asset;
        QuoteAssetConfig quote;
        PonsBaseline baseline;
        LaunchTemplate template;
        bytes32 ponsBaselineHash;
        bytes32 launchTemplateHash;
        bytes32 feePolicyHash;
        bytes32 expectedEconomics;
    }

    error InvalidCreator(address creator);
    error UnauthorizedLaunchRouter(address caller);
    error InvalidCreatorRevenueBeneficiary(address beneficiary);
    error InactiveAsset(bytes32 assetUid, uint8 status);
    error AssetIdentityDrift(bytes32 assetUid);
    error InvalidVaultSchema(bytes32 assetUid, address vault, bytes32 schemaId, address registeredVault);
    error InvalidVaultIdentity(
        bytes32 assetUid,
        address vault,
        address officialStockRegistry,
        address marketRegistry,
        address allocationManager,
        bytes32 schemaId
    );
    error InactiveQuote(bytes32 quoteAssetConfigId, uint8 status);
    error InactivePonsBaseline(bytes32 ponsBaselineId, uint8 status);
    error InactiveLaunchTemplate(bytes32 launchTemplateId, uint8 status);
    error QuoteBaselineMismatch(bytes32 quoteBaselineId, bytes32 requestedBaselineId);
    error InvalidQuoteEconomics(bytes32 quoteAssetConfigId, bytes32 economicsHash);
    error InvalidLaunchTemplateBinding(bytes32 feePolicyId, bytes32 executionSpecId);
    error InvalidFeePolicy(bytes32 feePolicyId);
    error ExpectedEconomicsMismatch(bytes32 supplied, bytes32 computed);

    function directCreator(address caller) internal pure returns (address creator) {
        if (caller == address(0)) revert InvalidCreator(caller);
        return caller;
    }

    function routedCreator(address caller, address launchRouter, address creator) internal pure returns (address) {
        if (caller != launchRouter) revert UnauthorizedLaunchRouter(caller);
        if (creator == address(0)) revert InvalidCreator(creator);
        return creator;
    }

    function resolve(
        Registries memory registries,
        Policy memory policy,
        address factory,
        address marketRegistry,
        address allocationManager,
        address creator,
        CreateMarketParams memory params
    ) internal view returns (Snapshot memory snapshot) {
        if (creator == address(0)) revert InvalidCreator(creator);
        if (params.creatorRevenueBeneficiary == address(0)) {
            revert InvalidCreatorRevenueBeneficiary(params.creatorRevenueBeneficiary);
        }
        _validatePolicy(policy);

        snapshot.asset = registries.officialStock.asset(params.assetUid);
        if (snapshot.asset.status != ACTIVE) revert InactiveAsset(params.assetUid, snapshot.asset.status);
        if (!registries.officialStock.assetIdentityCurrent(params.assetUid)) {
            revert AssetIdentityDrift(params.assetUid);
        }
        _validateVaultIdentity(
            registries.officialStock, params.assetUid, snapshot.asset.userStockVault, marketRegistry, allocationManager
        );

        snapshot.quote = registries.approvedQuote.quoteConfig(params.quoteAssetConfigId);
        if (snapshot.quote.status != ACTIVE) revert InactiveQuote(params.quoteAssetConfigId, snapshot.quote.status);
        if (snapshot.quote.ponsBaselineId != params.ponsBaselineId) {
            revert QuoteBaselineMismatch(snapshot.quote.ponsBaselineId, params.ponsBaselineId);
        }
        if (snapshot.quote.economicsHash != params.quoteAssetConfigId) {
            revert InvalidQuoteEconomics(params.quoteAssetConfigId, snapshot.quote.economicsHash);
        }

        snapshot.baseline = registries.ponsBaseline.baseline(params.ponsBaselineId);
        if (snapshot.baseline.status != ACTIVE) {
            revert InactivePonsBaseline(params.ponsBaselineId, snapshot.baseline.status);
        }
        V1GraduationEconomicDomain.validate(snapshot.baseline, snapshot.quote);

        snapshot.template = registries.launchTemplate.launchTemplate(params.launchTemplateId);
        if (snapshot.template.status != ACTIVE) {
            revert InactiveLaunchTemplate(params.launchTemplateId, snapshot.template.status);
        }
        if (
            snapshot.template.feePolicyId != policy.feePolicyId
                || snapshot.template.executionSpecId != policy.fields.executionSpecId
        ) {
            revert InvalidLaunchTemplateBinding(snapshot.template.feePolicyId, snapshot.template.executionSpecId);
        }

        snapshot.ponsBaselineHash = V1MarketEconomics.hashPonsBaseline(snapshot.baseline);
        snapshot.launchTemplateHash = registries.launchTemplate.launchTemplateHash(params.launchTemplateId);
        if (snapshot.launchTemplateHash == bytes32(0)) {
            revert InactiveLaunchTemplate(params.launchTemplateId, snapshot.template.status);
        }
        snapshot.feePolicyHash = V1MarketEconomics.hashFeePolicy(policy.fields);
        snapshot.expectedEconomics = V1MarketEconomics.hashExpectedEconomics(
            V1MarketEconomics.ExpectedEconomicsInput({
                chainId: block.chainid,
                factory: factory,
                assetUid: params.assetUid,
                stockToken: snapshot.asset.stockToken,
                stockDecimals: snapshot.asset.tokenDecimals,
                ponsBaselineId: params.ponsBaselineId,
                ponsBaselineHash: snapshot.ponsBaselineHash,
                quoteAssetConfigId: params.quoteAssetConfigId,
                quoteEconomicsHash: snapshot.quote.economicsHash,
                launchTemplateId: params.launchTemplateId,
                launchTemplateHash: snapshot.launchTemplateHash,
                launchConfigId: snapshot.baseline.launchConfigId,
                feePolicyId: policy.feePolicyId,
                feePolicyHash: snapshot.feePolicyHash,
                executionSpecId: policy.fields.executionSpecId
            })
        );
    }

    function validateExpected(Snapshot memory snapshot, bytes32 supplied) internal pure {
        if (supplied != snapshot.expectedEconomics) {
            revert ExpectedEconomicsMismatch(supplied, snapshot.expectedEconomics);
        }
    }

    function _validateVaultIdentity(
        IOfficialStockRegistryV1 officialStock,
        bytes32 assetUid,
        address vault,
        address marketRegistry,
        address allocationManager
    ) private view {
        bytes32 schemaId = officialStock.vaultSchemaId(vault);
        address registeredVault = officialStock.vaultForSchema(REQUIRED_VAULT_SCHEMA_ID);
        if (schemaId != REQUIRED_VAULT_SCHEMA_ID || registeredVault != vault) {
            revert InvalidVaultSchema(assetUid, vault, schemaId, registeredVault);
        }

        try IUserStockVault(vault).vaultIdentity() returns (
            address reportedRegistry,
            address reportedMarketRegistry,
            address reportedAllocationManager,
            bytes32 reportedSchemaId
        ) {
            if (
                reportedRegistry != address(officialStock) || reportedMarketRegistry != marketRegistry
                    || reportedAllocationManager != allocationManager || reportedSchemaId != REQUIRED_VAULT_SCHEMA_ID
            ) {
                revert InvalidVaultIdentity(
                    assetUid,
                    vault,
                    reportedRegistry,
                    reportedMarketRegistry,
                    reportedAllocationManager,
                    reportedSchemaId
                );
            }
        } catch {
            revert InvalidVaultIdentity(assetUid, vault, address(0), address(0), address(0), bytes32(0));
        }
    }

    function _validatePolicy(Policy memory policy) private pure {
        V1MarketEconomics.FeePolicyInput memory fields = policy.fields;
        if (
            policy.feePolicyId == bytes32(0) || fields.executionSpecId != EXECUTION_SPEC_ID
                || fields.feePips != FEE_PIPS || fields.lpShareBps != LP_SHARE_BPS || fields.poolKeyFee != POOL_KEY_FEE
                || fields.hookPermissionMask != HOOK_PERMISSION_MASK
                || fields.feeAssetMode != FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA
                || fields.stakerNonLpShareBps != STAKER_NON_LP_SHARE_BPS
                || fields.platformNonLpShareBps != PLATFORM_NON_LP_SHARE_BPS
        ) revert InvalidFeePolicy(policy.feePolicyId);
    }
}
