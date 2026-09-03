// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {V1Create2} from "../../../src/v1/shared/V1Create2.sol";
import {V1Identifiers} from "../../../src/v1/shared/V1Identifiers.sol";

contract V1Create2Target {
    uint256 public immutable value;

    constructor(uint256 value_) {
        value = value_;
    }
}

contract V1DeploymentLibraryHarness {
    function hashMarketId(V1Identifiers.MarketIdInput memory input) external pure returns (bytes32) {
        return V1Identifiers.hashMarketId(input);
    }

    function hashMarketIdStrings(V1Identifiers.MarketIdStringInput memory input) external pure returns (bytes32) {
        return V1Identifiers.hashMarketId(input);
    }

    function componentKindHash(V1Identifiers.ComponentKind kind) external pure returns (bytes32) {
        return V1Identifiers.componentKindHash(kind);
    }

    function componentSalt(uint256 chainId, address factory, bytes32 marketId, V1Identifiers.ComponentKind kind)
        external
        pure
        returns (bytes32)
    {
        return V1Identifiers.componentSalt(chainId, factory, marketId, kind);
    }

    function initCodeHash(bytes memory creationCode, bytes memory constructorArgs) external pure returns (bytes32) {
        return V1Create2.initCodeHash(creationCode, constructorArgs);
    }

    function predict(bytes32 salt, bytes32 initCodeHash_) external view returns (address) {
        return V1Create2.predict(address(this), salt, initCodeHash_);
    }

    function predictFor(address deployer, bytes32 salt, bytes32 initCodeHash_) external pure returns (address) {
        return V1Create2.predict(deployer, salt, initCodeHash_);
    }

    function deploy(bytes32 salt, bytes memory initCode) external returns (address) {
        return V1Create2.deploy(salt, initCode);
    }
}

contract V1DeploymentLibrariesTest is Test {
    uint256 internal constant REFERENCE_CHAIN_ID = 31_337;
    address internal constant REFERENCE_FACTORY = 0xd0CDeac414e546d2e7ede445f4e7032a4272C771;
    bytes32 internal constant REFERENCE_MARKET_RESULT =
        0x76155598cd42d79f7f18c39992ed9f0d8872205c4b757801661c51f412898211;

    uint256 internal constant CREATE2_CHAIN_ID = 4_663;
    address internal constant VECTOR_FACTORY = 0x1111111111111111111111111111111111111111;
    address internal constant LAUNCH_DEPLOYER = 0x2222222222222222222222222222222222222222;
    address internal constant GRADUATION_DEPLOYER = 0x3333333333333333333333333333333333333333;
    bytes32 internal constant CREATE2_MARKET_ID = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;

    V1DeploymentLibraryHarness internal harness;

    function setUp() public {
        harness = new V1DeploymentLibraryHarness();
    }

    function test_marketIdMatchesFrozenMachineVector() public view {
        assertEq(harness.hashMarketId(_referenceMarketInput()), REFERENCE_MARKET_RESULT);
    }

    function test_rawStringsAreHashedInsideTheCanonicalMarketIdPath() public view {
        V1Identifiers.MarketIdStringInput memory input = V1Identifiers.MarketIdStringInput({
            chainId: block.chainid,
            factory: address(harness),
            creator: address(0xC0FFEE),
            creatorRevenueBeneficiaryAtCreation: address(0xBEEF),
            creatorSalt: keccak256("creator-salt"),
            expectedEconomics: keccak256("economics"),
            name: unicode"Ticker Garden 树",
            symbol: "TREE",
            metadataURI: unicode"ipfs://市场"
        });
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_MARKET_ID"),
                uint256(1),
                input.chainId,
                input.factory,
                input.creator,
                input.creatorRevenueBeneficiaryAtCreation,
                input.creatorSalt,
                input.expectedEconomics,
                keccak256(bytes(input.name)),
                keccak256(bytes(input.symbol)),
                keccak256(bytes(input.metadataURI))
            )
        );
        assertEq(harness.hashMarketIdStrings(input), expected);
    }

    function test_everyMarketIdentityFieldChangesTheResult() public view {
        V1Identifiers.MarketIdInput memory input = _referenceMarketInput();
        bytes32 original = harness.hashMarketId(input);

        input.chainId += 1;
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.factory = address(1);
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.creator = address(2);
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.creatorRevenueBeneficiaryAtCreation = address(3);
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.creatorSalt = bytes32(uint256(4));
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.expectedEconomics = bytes32(uint256(5));
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.nameHash = bytes32(uint256(6));
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.symbolHash = bytes32(uint256(7));
        assertNotEq(harness.hashMarketId(input), original);
        input = _referenceMarketInput();
        input.metadataUriHash = bytes32(uint256(8));
        assertNotEq(harness.hashMarketId(input), original);
    }

    function test_fourComponentKindsAndSaltsMatchFrozenReferenceVectors() public view {
        _assertComponent(
            V1Identifiers.ComponentKind.CURVE,
            keccak256("CURVE"),
            0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,
            0x523d466b10193f59dc5a2f5abcbae41348c14b8be342810a721f4f56432077f3,
            LAUNCH_DEPLOYER,
            0x0E8Cc85E3350d4ca44b42064eb50df2B6eD03Fdb
        );
        _assertComponent(
            V1Identifiers.ComponentKind.TOKEN,
            keccak256("TOKEN"),
            0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc,
            0x3a64384a587c5edc8676d3f5052623b881ee379c07ae93f5393524daf0e93e29,
            LAUNCH_DEPLOYER,
            0xbB095393424c000c43D4fe5696Ef2F2bB6dC13db
        );
        _assertComponent(
            V1Identifiers.ComponentKind.GAUGE,
            keccak256("GAUGE"),
            0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd,
            0xe58551d65384f0721d898488434a36cc33de5e3f002df444f863681dc99fb735,
            LAUNCH_DEPLOYER,
            0x73AF16AE7F445686926148BAa6aD81200651128e
        );
        _assertComponent(
            V1Identifiers.ComponentKind.LOCKER,
            keccak256("LOCKER"),
            0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee,
            0x766550e1d33f016b0249853ae1e8d7ce004e4fa9bbe525ad941b1ae42d2fb58a,
            GRADUATION_DEPLOYER,
            0x59644E32244eb0F5d7D4D5f54BEFAa69E80DdA34
        );
    }

    function test_componentSaltBindsChainFactoryMarketAndKind() public view {
        bytes32 tokenSalt = _componentSalt(V1Identifiers.ComponentKind.TOKEN);
        assertNotEq(tokenSalt, _componentSalt(V1Identifiers.ComponentKind.CURVE));
        assertNotEq(
            tokenSalt,
            harness.componentSalt(
                CREATE2_CHAIN_ID + 1, VECTOR_FACTORY, CREATE2_MARKET_ID, V1Identifiers.ComponentKind.TOKEN
            )
        );
        assertNotEq(
            tokenSalt,
            harness.componentSalt(CREATE2_CHAIN_ID, address(1), CREATE2_MARKET_ID, V1Identifiers.ComponentKind.TOKEN)
        );
        assertNotEq(
            tokenSalt,
            harness.componentSalt(
                CREATE2_CHAIN_ID, VECTOR_FACTORY, bytes32(uint256(1)), V1Identifiers.ComponentKind.TOKEN
            )
        );
    }

    function test_initCodeHashUsesFullCreationCodeAndConstructorArguments() public view {
        bytes memory creationCode = type(V1Create2Target).creationCode;
        bytes memory constructorArgs = abi.encode(uint256(42));
        assertEq(
            harness.initCodeHash(creationCode, constructorArgs), keccak256(bytes.concat(creationCode, constructorArgs))
        );
        assertNotEq(
            harness.initCodeHash(creationCode, constructorArgs),
            harness.initCodeHash(creationCode, abi.encode(uint256(43)))
        );
    }

    function test_predictionAndActualDeploymentUseTheSameLibraryPath() public {
        bytes32 salt = keccak256("actual-component");
        bytes memory initCode = bytes.concat(type(V1Create2Target).creationCode, abi.encode(uint256(42)));
        address predicted = harness.predict(salt, keccak256(initCode));
        address actual = harness.deploy(salt, initCode);

        assertEq(actual, predicted);
        assertGt(actual.code.length, 0);
        assertEq(V1Create2Target(actual).value(), 42);
    }

    function test_collisionRevertsWithoutChangingSaltOrTryingANonceFallback() public {
        bytes32 salt = keccak256("collision");
        bytes memory initCode = bytes.concat(type(V1Create2Target).creationCode, abi.encode(uint256(7)));
        address predicted = harness.predict(salt, keccak256(initCode));
        assertEq(harness.deploy(salt, initCode), predicted);

        vm.expectRevert(abi.encodeWithSelector(V1Create2.Create2AddressCollision.selector, predicted));
        harness.deploy(salt, initCode);
        assertEq(V1Create2Target(predicted).value(), 7);
    }

    function test_emptyOrNonContractInitCodeFailsWithoutLeavingAComponent() public {
        bytes32 salt = keccak256("empty-code");
        bytes memory emptyCode = new bytes(0);
        address predicted = harness.predict(salt, keccak256(emptyCode));
        vm.expectRevert(
            abi.encodeWithSelector(V1Create2.Create2DeploymentFailed.selector, predicted, salt, keccak256(emptyCode))
        );
        harness.deploy(salt, emptyCode);
        assertEq(predicted.code.length, 0);
    }

    function test_launchAndGraduationDeployersProduceDifferentAddresses() public view {
        bytes32 salt = _componentSalt(V1Identifiers.ComponentKind.LOCKER);
        bytes32 initCodeHash_ = keccak256("locker-init-code");
        address launchAddress = harness.predictFor(LAUNCH_DEPLOYER, salt, initCodeHash_);
        address graduationAddress = harness.predictFor(GRADUATION_DEPLOYER, salt, initCodeHash_);
        assertNotEq(launchAddress, graduationAddress);
    }

    function _assertComponent(
        V1Identifiers.ComponentKind componentKind,
        bytes32 expectedKindHash,
        bytes32 initCodeHash_,
        bytes32 expectedSalt,
        address deployer,
        address expectedAddress
    ) private view {
        assertEq(harness.componentKindHash(componentKind), expectedKindHash);
        bytes32 salt = _componentSalt(componentKind);
        assertEq(salt, expectedSalt);
        assertEq(harness.predictFor(deployer, salt, initCodeHash_), expectedAddress);
    }

    function _componentSalt(V1Identifiers.ComponentKind componentKind) private view returns (bytes32) {
        return harness.componentSalt(CREATE2_CHAIN_ID, VECTOR_FACTORY, CREATE2_MARKET_ID, componentKind);
    }

    function _referenceMarketInput() private pure returns (V1Identifiers.MarketIdInput memory) {
        return V1Identifiers.MarketIdInput({
            chainId: REFERENCE_CHAIN_ID,
            factory: REFERENCE_FACTORY,
            creator: 0x43e489a98cEdAf66d744B3Ab1BB877ff82930B0b,
            creatorRevenueBeneficiaryAtCreation: 0x39E6fB8120080F24C5d0374FD92365df51Ce37E7,
            creatorSalt: 0xc0508e6680b39379924617191068f24c22967c0a53f6d18d40fd2257031be994,
            expectedEconomics: 0x0dfe7c8b7de88308dab2d810f162b512ad2aaa534e3d7aad0343681976873e5f,
            nameHash: 0x688cdaffbbe8b52b5101594cf7ed98a1d99ac78985c2db5a7a2a3814233e99f6,
            symbolHash: 0x002218150d1bebde9cdc6da057def9ab123d5d7adc920c7b1f7ebfaa400963c0,
            metadataUriHash: 0x4ec5ce70866038ecd7e3760c0013954d05648b59da5c3b7792dbe6737929ad23
        });
    }
}
