// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {V1HookExecutorDeployer} from "../../../script/v1/V1HookExecutorDeployer.sol";

contract HookExecutorHelperCreate2Factory {
    function deploy(bytes32 salt, address authorizer) external returns (V1HookExecutorDeployer helper) {
        helper = new V1HookExecutorDeployer{salt: salt}(authorizer);
    }

    function predict(bytes32 salt, address authorizer) external view returns (address) {
        bytes32 initCodeHash =
            keccak256(bytes.concat(type(V1HookExecutorDeployer).creationCode, abi.encode(authorizer)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}

contract HookExecutorHelperHookMock {
    address public immutable marketRegistry;
    address public immutable poolManager;
    address public immutable protocolFeeVault;
    address public immutable graduationExecutor;

    constructor(address marketRegistry_, address poolManager_, address feeVault_, address executor_) {
        marketRegistry = marketRegistry_;
        poolManager = poolManager_;
        protocolFeeVault = feeVault_;
        graduationExecutor = executor_;
    }
}

contract HookExecutorHelperExecutorMock {
    address public immutable marketRegistry;
    address public immutable approvedQuoteRegistry;
    address public immutable factory;
    address public immutable poolManager;
    address public immutable positionManager;
    address public immutable permit2;
    address public immutable hook;

    constructor(address marketRegistry_, address poolManager_, address hook_) {
        marketRegistry = marketRegistry_;
        poolManager = poolManager_;
        hook = hook_;
        approvedQuoteRegistry = address(1);
        factory = address(2);
        positionManager = address(3);
        permit2 = address(4);
    }

    function predictLaunchLocker(bytes32) external pure returns (address) {
        return address(5);
    }

    function launchLockerCreationCodeHash() external pure returns (bytes32) {
        return keccak256("locker");
    }
}

contract HookExecutorHelperWrongExecutorMock is HookExecutorHelperExecutorMock {
    constructor(address marketRegistry_, address poolManager_, address hook_)
        HookExecutorHelperExecutorMock(marketRegistry_, poolManager_, hook_)
    {}

    function wrongHook() external pure returns (address) {
        return address(0xBAD);
    }
}

contract V1HookExecutorDeployerTest is Test {
    uint160 private constant MASK = 0x2044;
    uint160 private constant ALL_BITS = 0x3fff;

    HookExecutorHelperCreate2Factory private factory;
    address private registry;
    address private poolManager;
    address private feeVault;

    function setUp() public {
        factory = new HookExecutorHelperCreate2Factory();
        registry = address(new HookExecutorDependencyMock());
        poolManager = address(new HookExecutorDependencyMock());
        feeVault = address(new HookExecutorDependencyMock());
    }

    function test_deploysTheReciprocalPairAtNonceOneAndTwo() public {
        V1HookExecutorDeployer helper = _deployMinedHelper();
        address hook = helper.predictedHook();
        address executor = helper.predictedExecutor();

        bytes memory hookInitCode = bytes.concat(
            type(HookExecutorHelperHookMock).creationCode, abi.encode(registry, poolManager, feeVault, executor)
        );
        bytes memory executorInitCode =
            bytes.concat(type(HookExecutorHelperExecutorMock).creationCode, abi.encode(registry, poolManager, hook));

        (address deployedHook, address deployedExecutor) = helper.deploy(hookInitCode, executorInitCode);

        assertEq(deployedHook, hook);
        assertEq(deployedExecutor, executor);
        assertEq(uint160(deployedHook) & ALL_BITS, MASK);
        assertTrue(helper.completed());
        assertEq(HookExecutorHelperHookMock(hook).graduationExecutor(), executor);
        assertEq(HookExecutorHelperExecutorMock(executor).hook(), hook);
    }

    function test_failureRollsBackTheFirstChildAndAllowsCorrectedRetry() public {
        V1HookExecutorDeployer helper = _deployMinedHelper();
        address hook = helper.predictedHook();
        address executor = helper.predictedExecutor();
        bytes memory hookInitCode = bytes.concat(
            type(HookExecutorHelperHookMock).creationCode, abi.encode(registry, poolManager, feeVault, executor)
        );
        bytes memory badExecutorCode =
            bytes.concat(type(HookExecutorHelperExecutorMock).creationCode, abi.encode(registry, address(0xBAD), hook));

        vm.expectRevert(
            abi.encodeWithSelector(V1HookExecutorDeployer.InvalidReciprocalBindings.selector, hook, executor)
        );
        helper.deploy(hookInitCode, badExecutorCode);
        assertEq(hook.code.length, 0);
        assertEq(executor.code.length, 0);
        assertFalse(helper.completed());

        bytes memory executorInitCode =
            bytes.concat(type(HookExecutorHelperExecutorMock).creationCode, abi.encode(registry, poolManager, hook));
        helper.deploy(hookInitCode, executorInitCode);
        assertTrue(helper.completed());
    }

    function test_onlyAuthorizerCanDeployAndPairIsOneShot() public {
        V1HookExecutorDeployer helper = _deployMinedHelper();
        bytes memory hookInitCode = bytes.concat(
            type(HookExecutorHelperHookMock).creationCode,
            abi.encode(registry, poolManager, feeVault, helper.predictedExecutor())
        );
        bytes memory executorInitCode = bytes.concat(
            type(HookExecutorHelperExecutorMock).creationCode, abi.encode(registry, poolManager, helper.predictedHook())
        );

        vm.prank(address(0xBAD));
        vm.expectRevert(
            abi.encodeWithSelector(V1HookExecutorDeployer.UnauthorizedDeployer.selector, address(0xBAD), address(this))
        );
        helper.deploy(hookInitCode, executorInitCode);

        helper.deploy(hookInitCode, executorInitCode);
        vm.expectRevert(V1HookExecutorDeployer.DeploymentAlreadyCompleted.selector);
        helper.deploy(hookInitCode, executorInitCode);
    }

    function _deployMinedHelper() private returns (V1HookExecutorDeployer helper) {
        bytes32 salt;
        for (uint256 nonce; nonce < 100_000; ++nonce) {
            salt = bytes32(nonce);
            address candidate = factory.predict(salt, address(this));
            address predictedHook = _predictCreate(candidate, 1);
            if ((uint160(predictedHook) & ALL_BITS) == MASK) {
                helper = factory.deploy(salt, address(this));
                assertEq(helper.predictedHook(), predictedHook);
                assertEq(helper.predictedExecutor(), _predictCreate(candidate, 2));
                return helper;
            }
        }
        revert("HELPER_SALT_NOT_FOUND");
    }

    function _predictCreate(address deployer, uint8 nonce) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(nonce))))));
    }
}

contract HookExecutorDependencyMock {}
