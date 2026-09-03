// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetView,
    CreateMarketParams,
    IApprovedQuoteRegistry,
    ILaunchTemplateRegistry,
    IOfficialStockRegistryV1,
    IPonsBaselineRegistry,
    LaunchTemplate,
    PonsBaseline,
    QuoteAssetConfig
} from "../interfaces/IV1Protocol.sol";
import {V1MarketEconomics} from "./V1MarketEconomics.sol";

/// @notice Fail-closed Registry resolution and economics verification shared by Factory create and preview paths.
library V1FactoryValidation {
    uint8 internal constant ACTIVE = 1;
    bytes32 internal constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-6");
    uint24 internal constant FEE_PIPS = 10_000;
    uint16 internal constant LP_SHARE_BPS = 2_000;
    uint24 internal constant POOL_KEY_FEE = 0;
    uint160 internal constant HOOK_PERMISSION_MASK = 0x2044;
    uint8 internal constant FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA = 1;
    uint16 internal constant STAKER_NON_LP_SHARE_BPS = 5_000;

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

    function _validatePolicy(Policy memory policy) private pure {
        V1MarketEconomics.FeePolicyInput memory fields = policy.fields;
        if (
            policy.feePolicyId == bytes32(0) || fields.executionSpecId != EXECUTION_SPEC_ID
                || fields.feePips != FEE_PIPS || fields.lpShareBps != LP_SHARE_BPS || fields.poolKeyFee != POOL_KEY_FEE
                || fields.hookPermissionMask != HOOK_PERMISSION_MASK
                || fields.feeAssetMode != FEE_ASSET_MODE_UNSPECIFIED_CORE_SWAP_DELTA
                || fields.stakerNonLpShareBps != STAKER_NON_LP_SHARE_BPS
        ) revert InvalidFeePolicy(policy.feePolicyId);
    }
}
