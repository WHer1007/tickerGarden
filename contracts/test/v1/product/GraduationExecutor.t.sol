// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import {Test} from "forge-std/Test.sol";

import {TickerGardenBaseline, QuoteAssetConfig} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {GraduationExecutor} from "../../../src/v1/modules/GraduationExecutor.sol";
import {LaunchLocker} from "../../../src/v1/modules/LaunchLocker.sol";
import {V1Create2} from "../../../src/v1/shared/V1Create2.sol";
import {V1Identifiers} from "../../../src/v1/shared/V1Identifiers.sol";
import {
    PoolExecutionCurveCaller,
    PoolExecutionHookMock,
    PoolExecutionPermit2Mock,
    PoolExecutionPoolManagerMock,
    PoolExecutionPositionManagerMock,
    PoolExecutionTickerGardenBaselineRegistryMock,
    PoolExecutionQuoteRegistryMock,
    PoolExecutionRegistryMock,
    PoolExecutionToken
} from "../shared/GraduationExecutorPoolExecution.t.sol";

contract GraduationExecutorTest is Test {
    bytes32 private constant MARKET_ID = keccak256("PRODUCT-GRADUATION");
    bytes32 private constant QUOTE_ID = keccak256("PRODUCT-QUOTE");
    address private constant HOOK_ADDRESS = address(0x2044);
    uint256 private constant SWEPT_QUOTE = 40 ether;
    uint256 private constant SWEPT_MEME = 100 ether;
    uint256 private constant PHANTOM = 10 ether;

    PoolExecutionToken private meme;
    PoolExecutionToken private quote;
    PoolExecutionQuoteRegistryMock private quoteRegistry;
    PoolExecutionTickerGardenBaselineRegistryMock private baselineRegistry;
    PoolExecutionRegistryMock private registry;
    PoolExecutionPermit2Mock private permit2;
    PoolExecutionPoolManagerMock private poolManager;
    PoolExecutionPositionManagerMock private positionManager;
    PoolExecutionHookMock private hook;
    PoolExecutionCurveCaller private curve;
    GraduationExecutor private executor;

    function setUp() public {
        meme = new PoolExecutionToken("MEME");
        quote = new PoolExecutionToken("QUOTE");
        quoteRegistry = new PoolExecutionQuoteRegistryMock();
        baselineRegistry = new PoolExecutionTickerGardenBaselineRegistryMock();
        registry = new PoolExecutionRegistryMock(address(quoteRegistry), address(baselineRegistry));
        permit2 = new PoolExecutionPermit2Mock();
        poolManager = new PoolExecutionPoolManagerMock();
        positionManager = new PoolExecutionPositionManagerMock(address(poolManager), address(permit2));
        poolManager.setPositionManager(address(positionManager));

        PoolExecutionHookMock hookImplementation = new PoolExecutionHookMock();
        vm.etch(HOOK_ADDRESS, address(hookImplementation).code);
        hook = PoolExecutionHookMock(HOOK_ADDRESS);
        curve = new PoolExecutionCurveCaller();
        quoteRegistry.setQuote(
            QUOTE_ID,
            QuoteAssetConfig({
                tickerGardenBaselineId: bytes32("TICKERGARDEN"),
                quoteAsset: address(quote),
                quoteDecimals: 18,
                phantomQuote: PHANTOM,
                graduationThreshold: SWEPT_QUOTE,
                economicsHash: QUOTE_ID,
                status: 1
            })
        );
        baselineRegistry.setBaseline(
            bytes32("TICKERGARDEN"),
            TickerGardenBaseline({
                referenceChainId: block.chainid,
                referenceFactory: address(registry),
                referenceFactoryCodeHash: bytes32(0),
                launchConfigId: 0,
                supply: 500 ether,
                curveFeeBps: 0,
                poolFee: 0,
                tickSpacing: 200,
                behaviorVectorRoot: bytes32(0),
                status: 1
            })
        );
        registry.configure(MARKET_ID, QUOTE_ID, address(quote), address(meme), address(curve), address(hook));
        address predictedExecutor = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 3);
        registry.setGraduationExecutor(predictedExecutor);
        hook.setMarketRegistry(address(registry));
        hook.configure(predictedExecutor, address(poolManager));
        executor = new GraduationExecutor(
            address(registry), address(quoteRegistry), address(poolManager), address(positionManager), address(hook)
        );
    }

    function test_keeperGovernanceDelayRotationAndDisable() public {
        AccessManager access = new AccessManager(address(this));
        address stocks = address(0x510C);
        vm.mockCall(address(registry), abi.encodeWithSignature("officialStockRegistry()"), abi.encode(stocks));
        vm.mockCall(stocks, abi.encodeWithSignature("authority()"), abi.encode(address(access)));
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = executor.setCompoundKeeper.selector;
        access.setTargetFunctionRole(address(executor), selectors, 1);
        access.grantRole(1, address(this), uint32(2 days));
        assertEq(executor.compoundKeeper(), address(0));
        vm.prank(address(0xBAD));
        vm.expectRevert(GraduationExecutor.UnauthorizedCompoundGovernance.selector);
        executor.setCompoundKeeper(address(0xBEEF));
        bytes memory plan = abi.encodeCall(executor.setCompoundKeeper, (address(0xBEEF)));
        access.schedule(address(executor), plan, 0);
        vm.expectRevert();
        access.execute(address(executor), plan);
        vm.warp(block.timestamp + 2 days);
        access.execute(address(executor), plan);
        assertEq(executor.compoundKeeper(), address(0xBEEF));
        plan = abi.encodeCall(executor.setCompoundKeeper, (address(0)));
        access.schedule(address(executor), plan, 0);
        vm.warp(block.timestamp + 2 days);
        access.execute(address(executor), plan);
        assertEq(executor.compoundKeeper(), address(0));
    }

    function test_realLockerCreationCodeSaltPredictionAndActualDeploymentMatchManifest() public {
        bytes memory lockerInitCode = bytes.concat(
            type(LaunchLocker).creationCode, abi.encode(MARKET_ID, address(registry), address(positionManager))
        );
        bytes32 salt = V1Identifiers.componentSalt(
            block.chainid, registry.factory(), MARKET_ID, V1Identifiers.ComponentKind.LOCKER
        );
        address independentlyPredicted = V1Create2.predict(address(executor), salt, keccak256(lockerInitCode));
        address executorPredicted = executor.predictLaunchLocker(MARKET_ID);
        assertEq(independentlyPredicted, executorPredicted);

        string memory manifest = vm.readFile("../spec/v1_product_artifact_manifest.json");
        assertEq(abi.decode(vm.parseJson(manifest, ".modules[6].module"), (string)), "LaunchLocker");
        assertEq(
            abi.decode(vm.parseJson(manifest, ".modules[6].creationCode.keccak256"), (bytes32)),
            keccak256(type(LaunchLocker).creationCode)
        );

        quote.mint(address(executor), SWEPT_QUOTE);
        meme.mint(address(executor), SWEPT_MEME);
        curve.graduate(address(executor), MARKET_ID, SWEPT_QUOTE, SWEPT_MEME);

        assertGt(executorPredicted.code.length, 0);
        LaunchLocker deployed = LaunchLocker(payable(executorPredicted));
        assertEq(deployed.marketId(), MARKET_ID);
        (uint256 tokenId, bytes32 poolId) = deployed.lockedPosition();
        assertEq(tokenId, 1);
        assertEq(poolId, registry.canonicalPoolId(MARKET_ID));
        assertEq(positionManager.ownerOf(tokenId), executorPredicted);
        assertEq(registry.market(MARKET_ID).runtime.poolId, poolId);
        assertEq(registry.market(MARKET_ID).runtime.launchPhase, 1);
        assertEq(meme.balanceOf(executorPredicted), deployed.unpairedLockedBalance(address(meme)));
    }
}
