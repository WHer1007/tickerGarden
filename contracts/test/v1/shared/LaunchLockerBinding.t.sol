// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketConfig, MarketRuntime, MarketView, PoolKey} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {LaunchLockerBinding} from "../../../src/v1/shared/LaunchLockerBinding.sol";
import {V1Create2} from "../../../src/v1/shared/V1Create2.sol";

contract LaunchLockerRegistryMock {
    address public graduationExecutor;
    MarketView private _value;
    PoolKey private _key;

    function configure(address executor, bytes32 marketId, uint8 phase, bytes32 existingPool) external {
        graduationExecutor = executor;
        _value = MarketView({
            config: MarketConfig({
                assetUid: bytes32("ASSET"),
                ponsBaselineId: bytes32("PONS"),
                quoteAssetConfigId: bytes32("QUOTE"),
                launchTemplateId: bytes32("TEMPLATE"),
                feePolicyId: bytes32("FEE"),
                executionSpecId: keccak256("V1-EXEC-9"),
                expectedEconomics: bytes32("ECON"),
                launchConfigId: 0,
                creatorRevenueBeneficiaryAtCreation: address(0xBEEF),
                memeToken: address(0x3000),
                curve: address(0x4000),
                gauge: address(0x5000),
                quoteAsset: address(0x2000),
                graduatedHook: address(0x2044)
            }),
            runtime: MarketRuntime({poolId: existingPool, sourceVersion: 1, launchPhase: phase})
        });
        _key = PoolKey({
            currency0: address(0x2000), currency1: address(0x3000), fee: 0, tickSpacing: 200, hooks: address(0x2044)
        });
        require(marketId != bytes32(0));
    }

    function market(bytes32) external view returns (MarketView memory) {
        return _value;
    }

    function canonicalPoolId(bytes32) external view returns (bytes32) {
        return keccak256(abi.encode(_key));
    }
}

contract LaunchLockerPositionManagerMock {
    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => address owner) public ownerOf;

    function setNextTokenId(uint256 value) external {
        nextTokenId = value;
    }

    function setOwner(uint256 tokenId, address owner) external {
        ownerOf[tokenId] = owner;
    }
}

contract LaunchLockerBindingHarness is LaunchLockerBinding {
    constructor(bytes32 marketId_, address registry_, address positionManager_)
        LaunchLockerBinding(marketId_, registry_, positionManager_)
    {}

    function requireOwnership() external view returns (uint256 tokenId, bytes32 poolId) {
        return _requireLockedPositionOwnership();
    }
}

contract LaunchLockerDeployerHarness {
    function initCode(bytes32 marketId, address registry, address positionManager) public pure returns (bytes memory) {
        return
            bytes.concat(type(LaunchLockerBindingHarness).creationCode, abi.encode(marketId, registry, positionManager));
    }

    function predict(bytes32 salt, bytes32 marketId, address registry, address positionManager)
        external
        view
        returns (address)
    {
        return V1Create2.predict(address(this), salt, keccak256(initCode(marketId, registry, positionManager)));
    }

    function deploy(bytes32 salt, bytes32 marketId, address registry, address positionManager)
        external
        returns (address)
    {
        return V1Create2.deploy(salt, initCode(marketId, registry, positionManager));
    }
}

contract LaunchLockerBindingTest is Test {
    bytes32 private constant MARKET_ID = keccak256("MARKET");
    bytes32 private constant SALT = keccak256("LOCKER");

    LaunchLockerRegistryMock private registry;
    LaunchLockerPositionManagerMock private positionManager;
    LaunchLockerDeployerHarness private deployer;

    function setUp() public {
        registry = new LaunchLockerRegistryMock();
        positionManager = new LaunchLockerPositionManagerMock();
        deployer = new LaunchLockerDeployerHarness();
        registry.configure(address(deployer), MARKET_ID, 0, bytes32(0));
    }

    function test_predictionIsStableWhileConstructorBindsCurrentNextTokenId() public {
        address predicted = deployer.predict(SALT, MARKET_ID, address(registry), address(positionManager));
        positionManager.setNextTokenId(27);

        address actual = deployer.deploy(SALT, MARKET_ID, address(registry), address(positionManager));
        assertEq(actual, predicted);
        assertEq(LaunchLockerBindingHarness(actual).marketId(), MARKET_ID);

        (uint256 tokenId, bytes32 poolId) = LaunchLockerBindingHarness(actual).lockedPosition();
        assertEq(tokenId, 27);
        assertEq(poolId, registry.canonicalPoolId(MARKET_ID));
    }

    function test_ownershipCheckAcceptsOnlyDirectPositionNftCustody() public {
        address locker = deployer.deploy(SALT, MARKET_ID, address(registry), address(positionManager));
        vm.expectRevert(
            abi.encodeWithSelector(LaunchLockerBinding.LockedPositionNotOwned.selector, uint256(1), address(0))
        );
        LaunchLockerBindingHarness(locker).requireOwnership();

        positionManager.setOwner(1, address(0xCAFE));
        vm.expectRevert(
            abi.encodeWithSelector(LaunchLockerBinding.LockedPositionNotOwned.selector, uint256(1), address(0xCAFE))
        );
        LaunchLockerBindingHarness(locker).requireOwnership();

        positionManager.setOwner(1, locker);
        (uint256 tokenId, bytes32 poolId) = LaunchLockerBindingHarness(locker).requireOwnership();
        assertEq(tokenId, 1);
        assertEq(poolId, registry.canonicalPoolId(MARKET_ID));
    }

    function test_onlyRegistryExecutorCanDeployTheBinding() public {
        registry.configure(address(0xBEEF), MARKET_ID, 0, bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchLockerBinding.UnauthorizedLaunchLockerDeployer.selector, address(this), address(0xBEEF)
            )
        );
        new LaunchLockerBindingHarness(MARKET_ID, address(registry), address(positionManager));
    }

    function test_onlyNotGraduatedMarketWithValidProspectiveTokenCanBind() public {
        registry.configure(address(this), MARKET_ID, 1, bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(LaunchLockerBinding.LaunchLockerMarketAlreadyGraduated.selector, MARKET_ID, uint8(1))
        );
        new LaunchLockerBindingHarness(MARKET_ID, address(registry), address(positionManager));

        registry.configure(address(this), MARKET_ID, 0, bytes32(0));
        positionManager.setNextTokenId(0);
        vm.expectRevert(abi.encodeWithSelector(LaunchLockerBinding.InvalidProspectivePositionId.selector, uint256(0)));
        new LaunchLockerBindingHarness(MARKET_ID, address(registry), address(positionManager));
    }
}
