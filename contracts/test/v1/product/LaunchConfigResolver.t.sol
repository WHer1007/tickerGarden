// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchTemplate, TickerGardenBaseline, QuoteAssetConfig} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {LaunchConfigResolver} from "../../../src/v1/modules/LaunchConfigResolver.sol";

contract LaunchConfigResolverQuoteRegistryMock {
    mapping(bytes32 configId => QuoteAssetConfig value) private _configs;

    function setQuoteConfig(bytes32 configId, QuoteAssetConfig calldata value) external {
        _configs[configId] = value;
    }

    function quoteConfig(bytes32 configId) external view returns (QuoteAssetConfig memory) {
        return _configs[configId];
    }
}

contract LaunchConfigResolverTickerGardenRegistryMock {
    mapping(bytes32 baselineId => TickerGardenBaseline value) private _baselines;

    function setBaseline(bytes32 baselineId, TickerGardenBaseline calldata value) external {
        _baselines[baselineId] = value;
    }

    function baseline(bytes32 baselineId) external view returns (TickerGardenBaseline memory) {
        return _baselines[baselineId];
    }
}

contract LaunchConfigResolverTemplateRegistryMock {
    mapping(bytes32 templateId => LaunchTemplate value) private _templates;

    function setLaunchTemplate(bytes32 templateId, LaunchTemplate calldata value) external {
        _templates[templateId] = value;
    }

    function launchTemplate(bytes32 templateId) external view returns (LaunchTemplate memory) {
        return _templates[templateId];
    }
}

contract LaunchConfigResolverTest is Test {
    bytes32 internal constant QUOTE_ID_A = keccak256("quote-a");
    bytes32 internal constant QUOTE_ID_B = keccak256("quote-b");
    bytes32 internal constant BASELINE_ID_A = keccak256("baseline-a");
    bytes32 internal constant BASELINE_ID_B = keccak256("baseline-b");
    bytes32 internal constant TEMPLATE_ID_A = keccak256("template-a");
    bytes32 internal constant TEMPLATE_ID_B = keccak256("template-b");

    LaunchConfigResolverQuoteRegistryMock internal quotes;
    LaunchConfigResolverTickerGardenRegistryMock internal baselines;
    LaunchConfigResolverTemplateRegistryMock internal templates;
    LaunchConfigResolver internal resolver;

    function setUp() public {
        quotes = new LaunchConfigResolverQuoteRegistryMock();
        baselines = new LaunchConfigResolverTickerGardenRegistryMock();
        templates = new LaunchConfigResolverTemplateRegistryMock();
        resolver = new LaunchConfigResolver(address(quotes), address(baselines), address(templates));
    }

    function test_constructorFreezesRegistryBindingsAndExposesGetters() public view {
        assertEq(address(resolver.approvedQuoteRegistry()), address(quotes));
        assertEq(address(resolver.tickerGardenBaselineRegistry()), address(baselines));
        assertEq(address(resolver.launchTemplateRegistry()), address(templates));
    }

    function test_resolveForwardsTypedSnapshotsFromEachRegistry() public {
        QuoteAssetConfig memory quote =
            _quote(bytes32(uint256(0x1111)), address(0x1001), 6, 11, 22, bytes32(uint256(0xaaaa)), 1);
        TickerGardenBaseline memory baseline = _baseline(4663, address(0x2001), 33, 44, 55, 66, bytes32(uint256(0xbbbb)), 1);
        LaunchTemplate memory template = _template(1);
        quotes.setQuoteConfig(QUOTE_ID_A, quote);
        baselines.setBaseline(BASELINE_ID_A, baseline);
        templates.setLaunchTemplate(TEMPLATE_ID_A, template);

        (
            QuoteAssetConfig memory resolvedQuote,
            TickerGardenBaseline memory resolvedBaseline,
            LaunchTemplate memory resolvedTemplate
        ) = resolver.resolve(QUOTE_ID_A, BASELINE_ID_A, TEMPLATE_ID_A);

        assertEq(keccak256(abi.encode(resolvedQuote)), keccak256(abi.encode(quote)));
        assertEq(keccak256(abi.encode(resolvedBaseline)), keccak256(abi.encode(baseline)));
        assertEq(keccak256(abi.encode(resolvedTemplate)), keccak256(abi.encode(template)));
    }

    function test_resolveUsesEachSuppliedIdIndependently() public {
        QuoteAssetConfig memory quoteA =
            _quote(bytes32(uint256(0xaaaa)), address(0x1001), 6, 1, 2, bytes32(uint256(0x1111)), 1);
        QuoteAssetConfig memory quoteB =
            _quote(bytes32(uint256(0xbbbb)), address(0x1002), 18, 3, 4, bytes32(uint256(0x2222)), 2);
        TickerGardenBaseline memory baselineA = _baseline(1, address(0x2001), 5, 6, 7, 8, bytes32(uint256(0x3333)), 1);
        TickerGardenBaseline memory baselineB = _baseline(2, address(0x2002), 9, 10, 11, 12, bytes32(uint256(0x4444)), 2);
        LaunchTemplate memory templateA = _templateWithSeed(bytes32(uint256(0x5555)), 1);
        LaunchTemplate memory templateB = _templateWithSeed(bytes32(uint256(0x6666)), 2);

        quotes.setQuoteConfig(QUOTE_ID_A, quoteA);
        quotes.setQuoteConfig(QUOTE_ID_B, quoteB);
        baselines.setBaseline(BASELINE_ID_A, baselineA);
        baselines.setBaseline(BASELINE_ID_B, baselineB);
        templates.setLaunchTemplate(TEMPLATE_ID_A, templateA);
        templates.setLaunchTemplate(TEMPLATE_ID_B, templateB);

        (
            QuoteAssetConfig memory resolvedQuote,
            TickerGardenBaseline memory resolvedBaseline,
            LaunchTemplate memory resolvedTemplate
        ) = resolver.resolve(QUOTE_ID_B, BASELINE_ID_A, TEMPLATE_ID_B);

        assertEq(keccak256(abi.encode(resolvedQuote)), keccak256(abi.encode(quoteB)));
        assertEq(keccak256(abi.encode(resolvedBaseline)), keccak256(abi.encode(baselineA)));
        assertEq(keccak256(abi.encode(resolvedTemplate)), keccak256(abi.encode(templateB)));
    }

    function test_constructorRejectsZeroRegistryAddresses() public {
        vm.expectRevert(abi.encodeWithSelector(LaunchConfigResolver.InvalidRegistry.selector, address(0)));
        new LaunchConfigResolver(address(0), address(baselines), address(templates));

        vm.expectRevert(abi.encodeWithSelector(LaunchConfigResolver.InvalidRegistry.selector, address(0)));
        new LaunchConfigResolver(address(quotes), address(0), address(templates));

        vm.expectRevert(abi.encodeWithSelector(LaunchConfigResolver.InvalidRegistry.selector, address(0)));
        new LaunchConfigResolver(address(quotes), address(baselines), address(0));
    }

    function test_constructorRejectsRegistryAddressesWithoutCode() public {
        address noCode = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(LaunchConfigResolver.InvalidRegistry.selector, noCode));
        new LaunchConfigResolver(noCode, address(baselines), address(templates));

        noCode = address(0x1235);
        vm.expectRevert(abi.encodeWithSelector(LaunchConfigResolver.InvalidRegistry.selector, noCode));
        new LaunchConfigResolver(address(quotes), noCode, address(templates));

        noCode = address(0x1236);
        vm.expectRevert(abi.encodeWithSelector(LaunchConfigResolver.InvalidRegistry.selector, noCode));
        new LaunchConfigResolver(address(quotes), address(baselines), noCode);
    }

    function test_constructorRejectsAliasedRegistryBindings() public {
        vm.expectRevert(
            abi.encodeWithSelector(LaunchConfigResolver.AliasedRegistries.selector, address(quotes), address(quotes))
        );
        new LaunchConfigResolver(address(quotes), address(quotes), address(templates));

        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchConfigResolver.AliasedRegistries.selector, address(templates), address(templates)
            )
        );
        new LaunchConfigResolver(address(quotes), address(templates), address(templates));
    }

    function _quote(
        bytes32 tickerGardenBaselineId,
        address quoteAsset,
        uint8 quoteDecimals,
        uint256 phantomQuote,
        uint256 graduationThreshold,
        bytes32 economicsHash,
        uint8 status
    ) private pure returns (QuoteAssetConfig memory) {
        return QuoteAssetConfig({
            tickerGardenBaselineId: tickerGardenBaselineId,
            quoteAsset: quoteAsset,
            quoteDecimals: quoteDecimals,
            phantomQuote: phantomQuote,
            graduationThreshold: graduationThreshold,
            economicsHash: economicsHash,
            status: status
        });
    }

    function _baseline(
        uint256 referenceChainId,
        address referenceFactory,
        uint256 launchConfigId,
        uint256 supply,
        uint256 curveFeeBps,
        uint24 poolFee,
        bytes32 behaviorVectorRoot,
        uint8 status
    ) private pure returns (TickerGardenBaseline memory) {
        return TickerGardenBaseline({
            referenceChainId: referenceChainId,
            referenceFactory: referenceFactory,
            referenceFactoryCodeHash: bytes32(uint256(0x123456)),
            launchConfigId: launchConfigId,
            supply: supply,
            curveFeeBps: curveFeeBps,
            poolFee: poolFee,
            tickSpacing: 60,
            behaviorVectorRoot: behaviorVectorRoot,
            status: status
        });
    }

    function _templateWithSeed(bytes32 seed, uint8 status) private pure returns (LaunchTemplate memory) {
        LaunchTemplate memory value;
        value.memeTokenImplementation = address(uint160(uint256(seed) + 1));
        value.memeTokenCodeHash = seed;
        value.curveImplementation = address(uint160(uint256(seed) + 2));
        value.curveCodeHash = bytes32(uint256(seed) + 3);
        value.gaugeImplementation = address(uint160(uint256(seed) + 4));
        value.gaugeCodeHash = bytes32(uint256(seed) + 5);
        value.graduatedHook = address(uint160(uint256(seed) + 6));
        value.hookCodeHash = bytes32(uint256(seed) + 7);
        value.graduationExecutor = address(uint160(uint256(seed) + 8));
        value.graduationExecutorCodeHash = bytes32(uint256(seed) + 9);
        value.feePolicyId = bytes32(uint256(seed) + 11);
        value.executionSpecId = bytes32(uint256(seed) + 12);
        value.status = status;
        return value;
    }

    function _template(uint8 status) private pure returns (LaunchTemplate memory) {
        LaunchTemplate memory value;
        value.memeTokenImplementation = address(0x3001);
        value.memeTokenCodeHash = bytes32(uint256(0x3333));
        value.curveImplementation = address(0x3002);
        value.curveCodeHash = bytes32(uint256(0x3334));
        value.gaugeImplementation = address(0x3003);
        value.gaugeCodeHash = bytes32(uint256(0x3335));
        value.graduatedHook = address(0x3004);
        value.hookCodeHash = bytes32(uint256(0x3336));
        value.graduationExecutor = address(0x3005);
        value.graduationExecutorCodeHash = bytes32(uint256(0x3337));
        value.feePolicyId = bytes32(uint256(0xcccc));
        value.executionSpecId = bytes32(uint256(0xdddd));
        value.status = status;
        return value;
    }
}
