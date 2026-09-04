// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {QuoteAssetConfig} from "../../../src/v1/interfaces/IV1Protocol.sol";
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
        registry = new PoolExecutionRegistryMock(address(quoteRegistry));
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
                ponsBaselineId: bytes32("PONS"),
                quoteAsset: address(quote),
                quoteDecimals: 18,
                phantomQuote: PHANTOM,
                graduationThreshold: SWEPT_QUOTE,
                economicsHash: QUOTE_ID,
                status: 1
            })
        );
        registry.configure(MARKET_ID, QUOTE_ID, address(quote), address(meme), address(curve), address(hook));
        executor = new GraduationExecutor(
            address(registry), address(quoteRegistry), address(poolManager), address(positionManager), address(hook)
        );
        registry.setGraduationExecutor(address(executor));
        hook.configure(address(executor), address(poolManager));
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
