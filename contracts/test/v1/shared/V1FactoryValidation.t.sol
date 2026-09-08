// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    CreateMarketParams,
    IApprovedQuoteRegistry,
    ILaunchTemplateRegistry,
    IOfficialStockRegistryV1,
    ITickerGardenBaselineRegistry,
    LaunchTemplate,
    TickerGardenBaseline,
    QuoteAssetConfig
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {V1FactoryValidation} from "../../../src/v1/shared/V1FactoryValidation.sol";
import {V1Identifiers} from "../../../src/v1/shared/V1Identifiers.sol";
import {V1MarketEconomics} from "../../../src/v1/shared/V1MarketEconomics.sol";
import {GraduationPoolMath} from "../../../src/v1/libraries/GraduationPoolMath.sol";

contract FactoryRegistryFixtures {
    mapping(bytes32 => AssetView) internal _assets;
    mapping(bytes32 => QuoteAssetConfig) internal _quotes;
    mapping(bytes32 => TickerGardenBaseline) internal _baselines;
    mapping(bytes32 => LaunchTemplate) internal _templates;
    mapping(bytes32 => bytes32) internal _templateHashes;
    mapping(address => bytes32) internal _vaultSchemas;
    mapping(bytes32 => address) internal _vaults;
    mapping(address => bytes32) internal _vaultRuntimeCodeHashes;
    mapping(address => bool) internal _vaultIdentityIsCurrent;
    bool private _assetIdentityIsCurrent = true;
    bool private _quoteIdentityIsCurrent = true;

    function setAsset(bytes32 id, AssetView memory value) external {
        _assets[id] = value;
    }

    function setAssetIdentityCurrent(bool current) external {
        _assetIdentityIsCurrent = current;
    }

    function setVault(address vault, bytes32 schemaId) external {
        _vaultSchemas[vault] = schemaId;
        _vaults[schemaId] = vault;
        _vaultRuntimeCodeHashes[vault] = vault.codehash;
        _vaultIdentityIsCurrent[vault] = true;
    }

    function setVaultRuntimeCodeHash(address vault, bytes32 value) external {
        _vaultRuntimeCodeHashes[vault] = value;
    }

    function setVaultIdentityCurrent(address vault, bool current) external {
        _vaultIdentityIsCurrent[vault] = current;
    }

    function setQuote(bytes32 id, QuoteAssetConfig memory value) external {
        _quotes[id] = value;
    }

    function setQuoteIdentityCurrent(bool current) external {
        _quoteIdentityIsCurrent = current;
    }

    function setBaseline(bytes32 id, TickerGardenBaseline memory value) external {
        _baselines[id] = value;
    }

    function setTemplate(bytes32 id, LaunchTemplate memory value, bytes32 contentHash) external {
        _templates[id] = value;
        _templateHashes[id] = contentHash;
    }

    function asset(bytes32 id) external view returns (AssetView memory) {
        return _assets[id];
    }

    /// @dev Test fixture default: identity is stable unless explicitly modeled by a dedicated mock.
    function assetIdentityCurrent(bytes32) external view returns (bool) {
        return _assetIdentityIsCurrent;
    }

    function vaultSchemaId(address vault) external view returns (bytes32) {
        return _vaultSchemas[vault];
    }

    function vaultForSchema(bytes32 schemaId) external view returns (address) {
        return _vaults[schemaId];
    }

    function vaultRuntimeCodeHash(address vault) external view returns (bytes32) {
        return _vaultRuntimeCodeHashes[vault];
    }

    function vaultIdentityCurrent(address vault) external view returns (bool) {
        return _vaultIdentityIsCurrent[vault];
    }

    function quoteConfig(bytes32 id) external view returns (QuoteAssetConfig memory) {
        return _quotes[id];
    }

    function quoteIdentityCurrent(bytes32) external view returns (bool) {
        return _quoteIdentityIsCurrent;
    }

    function baseline(bytes32 id) external view returns (TickerGardenBaseline memory) {
        return _baselines[id];
    }

    function launchTemplate(bytes32 id) external view returns (LaunchTemplate memory) {
        return _templates[id];
    }

    function launchTemplateHash(bytes32 id) external view returns (bytes32) {
        return _templateHashes[id];
    }
}

contract FactoryDependencyMock {
    address private _registry;
    address private _marketRegistry;
    address private _allocationManager;
    bytes32 private _schemaId;

    function setVaultIdentity(address registry, address marketRegistry, address allocationManager, bytes32 schemaId)
        external
    {
        _registry = registry;
        _marketRegistry = marketRegistry;
        _allocationManager = allocationManager;
        _schemaId = schemaId;
    }

    function vaultIdentity() external view returns (address, address, address, bytes32) {
        return (_registry, _marketRegistry, _allocationManager, _schemaId);
    }
}

contract V1FactoryValidationHarness {
    V1FactoryValidation.Registries internal _registries;
    V1FactoryValidation.Policy internal _policy;
    mapping(bytes32 => bool) public reserved;
    address public immutable launchRouter;
    address public immutable marketRegistry;
    address public immutable allocationManager;

    error MarketIdentityAlreadyReserved(bytes32 marketId);

    constructor(
        address fixtures,
        bytes32 feePolicyId,
        address launchRouter_,
        address marketRegistry_,
        address allocationManager_
    ) {
        launchRouter = launchRouter_;
        marketRegistry = marketRegistry_;
        allocationManager = allocationManager_;
        _registries = V1FactoryValidation.Registries({
            officialStock: IOfficialStockRegistryV1(fixtures),
            approvedQuote: IApprovedQuoteRegistry(fixtures),
            tickerGardenBaseline: ITickerGardenBaselineRegistry(fixtures),
            launchTemplate: ILaunchTemplateRegistry(fixtures)
        });
        _policy.feePolicyId = feePolicyId;
        _policy.fields = V1MarketEconomics.FeePolicyInput({
            executionSpecId: keccak256("V1-EXEC-11"),
            feePips: 10_000,
            lpShareBps: 0,
            poolKeyFee: 0,
            hookPermissionMask: 0x2044,
            feeAssetMode: 1,
            stakerNonLpShareBps: 3_000,
            platformNonLpShareBps: 3_000
        });
    }

    function directCreator() external view returns (address) {
        return V1FactoryValidation.directCreator(msg.sender);
    }

    function routedCreator(address creator) external view returns (address) {
        return V1FactoryValidation.routedCreator(msg.sender, launchRouter, creator);
    }

    function preview(address creator, CreateMarketParams memory params)
        external
        view
        returns (bytes32 expectedEconomics, bytes32 marketId)
    {
        V1FactoryValidation.Snapshot memory snapshot = V1FactoryValidation.resolve(
            _registries, _policy, address(this), marketRegistry, allocationManager, creator, params
        );
        expectedEconomics = snapshot.expectedEconomics;
        marketId = _marketId(creator, params, expectedEconomics);
    }

    function validateAndReserve(address creator, CreateMarketParams memory params) external returns (bytes32 marketId) {
        V1FactoryValidation.Snapshot memory snapshot = V1FactoryValidation.resolve(
            _registries, _policy, address(this), marketRegistry, allocationManager, creator, params
        );
        V1FactoryValidation.validateExpected(snapshot, params.expectedEconomics);
        marketId = _marketId(creator, params, snapshot.expectedEconomics);
        if (reserved[marketId]) revert MarketIdentityAlreadyReserved(marketId);
        reserved[marketId] = true;
    }

    function hashTickerGardenBaseline(TickerGardenBaseline memory value) external pure returns (bytes32) {
        return V1MarketEconomics.hashTickerGardenBaseline(value);
    }

    function hashExpectedEconomics(V1MarketEconomics.ExpectedEconomicsInput memory value)
        external
        pure
        returns (bytes32)
    {
        return V1MarketEconomics.hashExpectedEconomics(value);
    }

    function _marketId(address creator, CreateMarketParams memory params, bytes32 economics)
        private
        view
        returns (bytes32)
    {
        return V1Identifiers.hashMarketId(
            V1Identifiers.MarketIdStringInput({
                chainId: block.chainid,
                factory: address(this),
                creator: creator,
                creatorRevenueBeneficiaryAtCreation: params.creatorRevenueBeneficiary,
                creatorSalt: params.salt,
                expectedEconomics: economics,
                name: params.name,
                symbol: params.symbol,
                metadataURI: params.metadataURI
            })
        );
    }
}

contract V1FactoryValidationTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("asset");
    bytes32 internal constant BASELINE_ID = keccak256("baseline");
    bytes32 internal constant QUOTE_ID = keccak256("quote");
    bytes32 internal constant TEMPLATE_ID = keccak256("template");
    bytes32 internal constant TEMPLATE_HASH = keccak256("template-content");
    bytes32 internal constant VAULT_SCHEMA_ID = keccak256("TickerGarden.UserStockVault.MultiAsset.v6");
    bytes32 internal constant FEE_POLICY_ID = keccak256("fee-policy");
    address internal constant CREATOR = address(0xCAFE);
    address internal constant BENEFICIARY = address(0xBEEF);
    address internal constant ROUTER = address(0xA11CE);

    FactoryRegistryFixtures internal fixtures;
    V1FactoryValidationHarness internal harness;
    FactoryDependencyMock internal marketRegistry;
    FactoryDependencyMock internal allocationManager;
    FactoryDependencyMock internal vault;

    function setUp() public {
        fixtures = new FactoryRegistryFixtures();
        marketRegistry = new FactoryDependencyMock();
        allocationManager = new FactoryDependencyMock();
        vault = new FactoryDependencyMock();
        vault.setVaultIdentity(address(fixtures), address(marketRegistry), address(allocationManager), VAULT_SCHEMA_ID);
        fixtures.setVault(address(vault), VAULT_SCHEMA_ID);
        harness = new V1FactoryValidationHarness(
            address(fixtures), FEE_POLICY_ID, ROUTER, address(marketRegistry), address(allocationManager)
        );
        _setValidFixtures();
    }

    function test_hashTickerGardenBaselineMatchesFrozenMachineVector() public view {
        TickerGardenBaseline memory value = TickerGardenBaseline({
            referenceChainId: 3027,
            referenceFactory: 0x0dD9f133ac3Bf7BC0992A126562E997418dC7e10,
            referenceFactoryCodeHash: 0x386ae79e6e7109c4931350331813d9c957da4cb2646030770975cb91a92b4c67,
            launchConfigId: 6054,
            supply: 7063,
            curveFeeBps: 8072,
            poolFee: 9081,
            tickSpacing: 10090,
            behaviorVectorRoot: 0xc87156b19251bf73752ecba2d385efb695b0ed4735dcbd7cde6c42adb3632e65,
            status: 77
        });
        assertEq(harness.hashTickerGardenBaseline(value), 0x82e4d2fc20474a7058ed18d917d441a5f665510b83471eb38e0203dc5c91c64c);
        value.status = 1;
        assertEq(harness.hashTickerGardenBaseline(value), 0x82e4d2fc20474a7058ed18d917d441a5f665510b83471eb38e0203dc5c91c64c);
    }

    function test_hashExpectedEconomicsMatchesFrozenMachineVector() public view {
        V1MarketEconomics.ExpectedEconomicsInput memory input = V1MarketEconomics.ExpectedEconomicsInput({
            chainId: 31337,
            factory: 0xd0CDeac414e546d2e7ede445f4e7032a4272C771,
            assetUid: 0x5c4a029b7275e5230fd48512a07abde18983f60d7bef8648c280978d4ec500ed,
            stockToken: 0x10b4Fa177304452De91f0a2f0946E30898c90492,
            stockDecimals: 255,
            tickerGardenBaselineId: 0x835edd49b4ce47edf6c0d4d310823b69161ee152cce114c266375244f58da915,
            tickerGardenBaselineHash: 0xd87da152306d48fce2176e0124394a9b727fc9f0a7e5a01adf3202c46850c560,
            quoteAssetConfigId: 0x616f1a3de420a964cbefc678fc8cd8e58a1c8ca8057a9494712657d44e0f35a9,
            quoteEconomicsHash: 0x4608d8b85db48ec7199507737df8e1ebcf477f517420e3f051630e19c4672557,
            launchTemplateId: 0x68c59175f786b6b27be325d6d9b7d076ab8b60f41ab561edcfbc13489f1fb4a8,
            launchTemplateHash: 0x56c076a7bd4b2d6dc8958e89de51acac9155b2f412a7310d674739634212de47,
            launchConfigId: 14126,
            feePolicyId: 0x21ca6e12a39c5e115bc125098217de03e2bc2d8db30f5fb2b365a0ef284c6f5f,
            feePolicyHash: 0x124343479b3f0d099d68176c06295d21f1686332671e3d8d18143942ae18e13b,
            executionSpecId: 0x6d778d9fac5729e6943b9bef3a61d68f916469af230e2a521826a553ea0b5bad,
            creatorTaxBps: 18162,
            creatorFeesToHolders: true,
            stakingEnabled: true
        });
        assertEq(
            harness.hashExpectedEconomics(input), 0xe6fe5f9c165aab630ef76a8c78b8abc1a1339208c2f3d52a08cbc3a3cba18938
        );
    }

    function test_resolvesActiveSnapshotsAndFixedFeePolicy() public view {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        (bytes32 economics, bytes32 marketId) = harness.preview(CREATOR, params);
        assertNotEq(economics, bytes32(0));
        assertNotEq(marketId, bytes32(0));
        assertEq(harness.marketRegistry(), address(marketRegistry));
        assertEq(harness.allocationManager(), address(allocationManager));
    }

    function test_sameAssetCanReserveMultipleDistinctMarketIdentities() public {
        CreateMarketParams memory first = _params(bytes32(uint256(1)));
        (first.expectedEconomics,) = harness.preview(CREATOR, first);
        bytes32 firstId = harness.validateAndReserve(CREATOR, first);

        CreateMarketParams memory second = _params(bytes32(uint256(2)));
        (second.expectedEconomics,) = harness.preview(CREATOR, second);
        bytes32 secondId = harness.validateAndReserve(CREATOR, second);

        assertNotEq(firstId, secondId);
        assertTrue(harness.reserved(firstId));
        assertTrue(harness.reserved(secondId));
    }

    function test_duplicateIdentityFailsButDoesNotReserveAssetUidGlobally() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        bytes32 predicted;
        (params.expectedEconomics, predicted) = harness.preview(CREATOR, params);
        assertEq(harness.validateAndReserve(CREATOR, params), predicted);
        vm.expectRevert(
            abi.encodeWithSelector(V1FactoryValidationHarness.MarketIdentityAlreadyReserved.selector, predicted)
        );
        harness.validateAndReserve(CREATOR, params);
    }

    function test_suppliedEconomicsMustEqualTheRegistryDerivedSnapshot() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        (bytes32 expected,) = harness.preview(CREATOR, params);
        params.expectedEconomics = bytes32(uint256(123));
        vm.expectRevert(
            abi.encodeWithSelector(
                V1FactoryValidation.ExpectedEconomicsMismatch.selector, params.expectedEconomics, expected
            )
        );
        harness.validateAndReserve(CREATOR, params);
    }

    function test_everyRegistryMustBeActive() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));

        AssetView memory assetValue = _asset();
        assetValue.status = 2;
        fixtures.setAsset(ASSET_UID, assetValue);
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.InactiveAsset.selector, ASSET_UID, uint8(2)));
        harness.preview(CREATOR, params);
        fixtures.setAsset(ASSET_UID, _asset());

        QuoteAssetConfig memory quoteValue = _quote();
        quoteValue.status = 2;
        fixtures.setQuote(QUOTE_ID, quoteValue);
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.InactiveQuote.selector, QUOTE_ID, uint8(2)));
        harness.preview(CREATOR, params);
        fixtures.setQuote(QUOTE_ID, _quote());

        TickerGardenBaseline memory baselineValue = _baseline();
        baselineValue.status = 2;
        fixtures.setBaseline(BASELINE_ID, baselineValue);
        vm.expectRevert(
            abi.encodeWithSelector(V1FactoryValidation.InactiveTickerGardenBaseline.selector, BASELINE_ID, uint8(2))
        );
        harness.preview(CREATOR, params);
        fixtures.setBaseline(BASELINE_ID, _baseline());

        LaunchTemplate memory templateValue = _template();
        templateValue.status = 2;
        fixtures.setTemplate(TEMPLATE_ID, templateValue, TEMPLATE_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(V1FactoryValidation.InactiveLaunchTemplate.selector, TEMPLATE_ID, uint8(2))
        );
        harness.preview(CREATOR, params);
    }

    function test_assetIdentityDriftBlocksPreviewBeforeMarketIdentityReservation() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        fixtures.setAssetIdentityCurrent(false);
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.AssetIdentityDrift.selector, ASSET_UID));
        harness.preview(CREATOR, params);
    }

    function test_quoteIdentityDriftBlocksPreviewBeforeMarketIdentityReservation() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        fixtures.setQuoteIdentityCurrent(false);
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.QuoteIdentityDrift.selector, QUOTE_ID));
        harness.preview(CREATOR, params);
    }

    function test_rejectsCrossBaselineQuoteAndTemplatePolicyDrift() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        QuoteAssetConfig memory quoteValue = _quote();
        quoteValue.tickerGardenBaselineId = bytes32(uint256(999));
        fixtures.setQuote(QUOTE_ID, quoteValue);
        vm.expectRevert(
            abi.encodeWithSelector(
                V1FactoryValidation.QuoteBaselineMismatch.selector, quoteValue.tickerGardenBaselineId, BASELINE_ID
            )
        );
        harness.preview(CREATOR, params);

        fixtures.setQuote(QUOTE_ID, _quote());
        LaunchTemplate memory templateValue = _template();
        templateValue.feePolicyId = bytes32(uint256(999));
        fixtures.setTemplate(TEMPLATE_ID, templateValue, TEMPLATE_HASH);
        vm.expectRevert(
            abi.encodeWithSelector(
                V1FactoryValidation.InvalidLaunchTemplateBinding.selector,
                templateValue.feePolicyId,
                templateValue.executionSpecId
            )
        );
        harness.preview(CREATOR, params);
    }

    function test_rejectsJointEconomicsThatCannotProduceRepresentableGraduationLiquidity() public {
        TickerGardenBaseline memory baselineValue = _baseline();
        baselineValue.supply = uint256(uint128(type(int128).max));
        baselineValue.tickSpacing = 1;
        fixtures.setBaseline(BASELINE_ID, baselineValue);

        QuoteAssetConfig memory quoteValue = _quote();
        quoteValue.phantomQuote = uint256(uint128(type(int128).max));
        quoteValue.graduationThreshold = uint256(uint128(type(int128).max)) - 100;
        fixtures.setQuote(QUOTE_ID, quoteValue);

        vm.expectRevert(
            abi.encodeWithSelector(
                GraduationPoolMath.InvalidGraduationLiquidity.selector,
                85_070_591_730_234_615_868_149_581_540_740_050_543,
                191_757_530_477_355_301_479_181_766_273_477
            )
        );
        harness.preview(CREATOR, _params(bytes32(uint256(1))));
    }

    function test_rejectsZeroCreatorAndBeneficiary() public {
        CreateMarketParams memory params = _params(bytes32(uint256(1)));
        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.InvalidCreator.selector, address(0)));
        harness.preview(address(0), params);

        params.creatorRevenueBeneficiary = address(0);
        vm.expectRevert(
            abi.encodeWithSelector(V1FactoryValidation.InvalidCreatorRevenueBeneficiary.selector, address(0))
        );
        harness.preview(CREATOR, params);
    }

    function test_directAndRoutedCreatorIdentityNeverUseTxOrigin() public {
        address directCaller = address(0xD1EC7);
        vm.prank(directCaller, address(0x0B0B));
        assertEq(harness.directCreator(), directCaller);

        vm.prank(ROUTER, address(0x0B0B));
        assertEq(harness.routedCreator(CREATOR), CREATOR);

        vm.expectRevert(abi.encodeWithSelector(V1FactoryValidation.UnauthorizedLaunchRouter.selector, directCaller));
        vm.prank(directCaller);
        harness.routedCreator(CREATOR);
    }

    function _setValidFixtures() private {
        fixtures.setAsset(ASSET_UID, _asset());
        fixtures.setQuote(QUOTE_ID, _quote());
        fixtures.setBaseline(BASELINE_ID, _baseline());
        fixtures.setTemplate(TEMPLATE_ID, _template(), TEMPLATE_HASH);
    }

    function _asset() private view returns (AssetView memory) {
        return AssetView({stockToken: address(0x1001), userStockVault: address(vault), tokenDecimals: 18, status: 1});
    }

    function _quote() private pure returns (QuoteAssetConfig memory) {
        return QuoteAssetConfig({
            tickerGardenBaselineId: BASELINE_ID,
            quoteAsset: address(0),
            quoteDecimals: 18,
            phantomQuote: 1.68 ether,
            graduationThreshold: 4.2 ether,
            economicsHash: QUOTE_ID,
            status: 1
        });
    }

    function _baseline() private pure returns (TickerGardenBaseline memory) {
        return TickerGardenBaseline({
            referenceChainId: 4663,
            referenceFactory: address(0x2001),
            referenceFactoryCodeHash: keccak256("factory"),
            launchConfigId: 0,
            supply: 1_000_000_000 ether,
            curveFeeBps: 100,
            poolFee: 0,
            tickSpacing: 60,
            behaviorVectorRoot: keccak256("vectors"),
            status: 1
        });
    }

    function _template() private pure returns (LaunchTemplate memory) {
        return LaunchTemplate({
            memeTokenImplementation: address(0x3001),
            memeTokenCodeHash: keccak256("token"),
            curveImplementation: address(0x3002),
            curveCodeHash: keccak256("curve"),
            gaugeImplementation: address(0x3003),
            gaugeCodeHash: keccak256("gauge"),
            graduatedHook: address(uint160(0x4000 | 0x2044)),
            hookCodeHash: keccak256("hook"),
            graduationExecutor: address(0x3005),
            graduationExecutorCodeHash: keccak256("executor"),
            feePolicyId: FEE_POLICY_ID,
            executionSpecId: keccak256("V1-EXEC-11"),
            status: 1
        });
    }

    function _params(bytes32 salt) private pure returns (CreateMarketParams memory) {
        return CreateMarketParams({
            assetUid: ASSET_UID,
            tickerGardenBaselineId: BASELINE_ID,
            quoteAssetConfigId: QUOTE_ID,
            launchTemplateId: TEMPLATE_ID,
            expectedEconomics: bytes32(0),
            creatorRevenueBeneficiary: BENEFICIARY,
            name: "Garden",
            symbol: "GRDN",
            metadataURI: "ipfs://garden",
            salt: salt,
            creatorTaxBps: 0,
            creatorFeesToHolders: false,
            stakingEnabled: true
        });
    }
}
