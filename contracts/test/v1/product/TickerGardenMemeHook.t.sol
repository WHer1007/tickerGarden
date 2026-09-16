// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TickerGardenMemeHook} from "../../../src/v1/modules/TickerGardenMemeHook.sol";
import {TickerGardenMemeHookBinding} from "../../../src/v1/shared/TickerGardenMemeHookBinding.sol";

contract ProductHookDependencyMock {}

contract ProductHookMarketRegistryMock {
    address public graduationExecutor;

    function setGraduationExecutor(address value) external {
        graduationExecutor = value;
    }
}

contract ProductHookCreate2Deployer {
    function deploy(bytes memory initCode, bytes32 salt) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
            if iszero(deployed) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
}

contract TickerGardenMemeHookTest is Test {
    uint160 private constant MASK = 0x2044;
    uint160 private constant ALL_BITS = (1 << 14) - 1;

    ProductHookMarketRegistryMock private registry;
    ProductHookDependencyMock private poolManager;
    ProductHookDependencyMock private feeVault;
    ProductHookDependencyMock private graduation;
    ProductHookCreate2Deployer private deployer;

    function setUp() public {
        registry = new ProductHookMarketRegistryMock();
        poolManager = new ProductHookDependencyMock();
        feeVault = new ProductHookDependencyMock();
        graduation = new ProductHookDependencyMock();
        registry.setGraduationExecutor(address(graduation));
        deployer = new ProductHookCreate2Deployer();
    }

    function test_concreteProductDeploysOnlyAtCanonicalPermissionAddress() public {
        bytes memory initCode = _initCode();
        bytes32 salt = _findSalt(initCode, true);
        address predicted = _predict(salt, keccak256(initCode));

        TickerGardenMemeHook hook = TickerGardenMemeHook(payable(deployer.deploy(initCode, salt)));

        assertEq(address(hook), predicted);
        assertEq(uint160(address(hook)) & ALL_BITS, MASK);
        assertEq(hook.hookPermissionMask(), MASK);
        assertGt(address(hook).code.length, 0);
    }

    function test_concreteProductRejectsWrongPermissionAddress() public {
        bytes memory initCode = _initCode();
        bytes32 salt = _findSalt(initCode, false);
        vm.expectRevert(TickerGardenMemeHookBinding.InvalidHookPermissionMask.selector);
        deployer.deploy(initCode, salt);
    }

    function test_concreteProductRejectsAliasedDependenciesAtCanonicalAddress() public {
        bytes memory initCode = abi.encodePacked(
            type(TickerGardenMemeHook).creationCode,
            abi.encode(address(registry), address(poolManager), address(registry), address(graduation))
        );
        bytes32 salt = _findSalt(initCode, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                TickerGardenMemeHookBinding.InvalidHookDependencies.selector,
                address(registry),
                address(poolManager),
                address(registry),
                address(graduation)
            )
        );
        deployer.deploy(initCode, salt);
    }

    function _initCode() private view returns (bytes memory) {
        return abi.encodePacked(
            type(TickerGardenMemeHook).creationCode,
            abi.encode(address(registry), address(poolManager), address(feeVault), address(graduation))
        );
    }

    function _findSalt(bytes memory initCode, bool canonical) private view returns (bytes32 salt) {
        bytes32 initCodeHash = keccak256(initCode);
        for (uint256 nonce; nonce < 100_000; ++nonce) {
            salt = bytes32(nonce);
            bool matches = uint160(_predict(salt, initCodeHash)) & ALL_BITS == MASK;
            if (matches == canonical) return salt;
        }
        revert("HOOK_SALT_NOT_FOUND");
    }

    function _predict(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), salt, initCodeHash)))));
    }
}
