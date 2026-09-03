// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IV1QuoteTransferCallback {
    function onV1QuoteTransfer(address token, address from, uint256 amount) external;
}

contract MockExactQuoteToken {
    bytes32 public uid;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setUid(bytes32 uid_) external {
        uid = uid_;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external virtual returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address owner, address recipient, uint256 amount) external virtual returns (bool) {
        uint256 currentAllowance = allowance[owner][msg.sender];
        if (currentAllowance != type(uint256).max) allowance[owner][msg.sender] = currentAllowance - amount;
        _transfer(owner, recipient, amount);
        return true;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal virtual {
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount;
    }
}

contract MockFeeOnTransferQuoteToken is MockExactQuoteToken {
    uint16 public feeBps;

    constructor(uint8 decimals_, uint16 feeBps_) MockExactQuoteToken(decimals_) {
        feeBps = feeBps_;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal override {
        uint256 fee = amount * feeBps / 10_000;
        balanceOf[owner] -= amount;
        balanceOf[recipient] += amount - fee;
    }
}

contract MockRebasingQuoteToken is MockExactQuoteToken {
    constructor(uint8 decimals_) MockExactQuoteToken(decimals_) {}

    function simulateRebase(address account, uint256 newBalance) external {
        balanceOf[account] = newBalance;
    }
}

contract MockCallbackQuoteToken is MockExactQuoteToken {
    bool public callbackEnabled;

    constructor(uint8 decimals_) MockExactQuoteToken(decimals_) {}

    function setCallbackEnabled(bool enabled) external {
        callbackEnabled = enabled;
    }

    function _transfer(address owner, address recipient, uint256 amount) internal override {
        super._transfer(owner, recipient, amount);
        if (callbackEnabled) {
            IV1QuoteTransferCallback(recipient).onV1QuoteTransfer(address(this), owner, amount);
        }
    }
}

contract MockReturnAnomalyQuoteToken {
    enum ReturnMode {
        FALSE,
        NO_DATA,
        MALFORMED_TRUE
    }

    ReturnMode public mode;

    function setMode(ReturnMode mode_) external {
        mode = mode_;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function transferFrom(address, address, uint256) external view returns (bool) {
        ReturnMode current = mode;
        assembly ("memory-safe") {
            switch current
            case 0 {
                mstore(0, 0)
                return(0, 32)
            }
            case 1 { return(0, 0) }
            default {
                mstore(0, 2)
                return(0, 32)
            }
        }
    }
}

contract MockForcedNativeSender {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}

contract MockV1ExactBalanceReceiver is IV1QuoteTransferCallback {
    error TransferCallFailed();
    error InvalidTransferReturn();
    error InexactBalanceDelta(uint256 expected, uint256 actual);
    error ReentrantTransferCallback();

    bool private pulling;

    function pull(address token, address owner, uint256 amount) external {
        pulling = true;
        uint256 beforeBalance = MockExactQuoteToken(token).balanceOf(address(this));
        (bool ok, bytes memory result) =
            token.call(abi.encodeCall(MockExactQuoteToken.transferFrom, (owner, address(this), amount)));
        if (!ok) revert TransferCallFailed();
        if (result.length != 32) revert InvalidTransferReturn();
        uint256 returned;
        assembly ("memory-safe") {
            returned := mload(add(result, 32))
        }
        if (returned != 1) revert InvalidTransferReturn();
        uint256 actual = MockExactQuoteToken(token).balanceOf(address(this)) - beforeBalance;
        if (actual != amount) revert InexactBalanceDelta(amount, actual);
        pulling = false;
    }

    function onV1QuoteTransfer(address, address, uint256) external view {
        if (pulling) revert ReentrantTransferCallback();
    }
}
