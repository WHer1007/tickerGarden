// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {
    IGraduationExecutor,
    IMarketRegistryV1,
    ITickerGardenCurve,
    IProtocolFeeVault,
    ITickerMemeTokenV1,
    MarketView,
    PoolKey
} from "../interfaces/IV1Protocol.sol";
import {GraduationPoolMath} from "../libraries/GraduationPoolMath.sol";
import {TickerGardenAntiSnipe} from "../libraries/TickerGardenAntiSnipe.sol";
import {TickerGardenCurveMath} from "../libraries/TickerGardenCurveMath.sol";
import {TickerGardenSupplyMath} from "../libraries/TickerGardenSupplyMath.sol";

struct CurveInitialization {
    bytes32 marketId;
    bytes32 tickerGardenBaselineId;
    bytes32 quoteAssetConfigId;
    address marketRegistry;
    address protocolFeeVault;
    address graduationExecutor;
    address launchRouter;
    address creator;
    address beneficiaryAtCreation;
    address memeToken;
    address quoteAsset;
    uint256 phantomQuote;
    uint256 graduationThreshold;
    uint256 initialSupply;
    uint256 curveFeeBps;
    uint16 creatorTaxBps;
}

interface ICurveInitializationSource {
    function curveInitialization(address curve) external view returns (CurveInitialization memory);
}

interface ICurveMarketRegistryDependencies {
    function graduationExecutor() external view returns (address);
}

/// @notice Per-market tracked-reserve TickerGarden curve with exact native/ERC-20 settlement.
/// @dev The Factory exposes a transient read-only initialization snapshot so CREATE2 init code does not depend on
///      the Meme token address and create a circular address prediction.
contract TickerGardenCurve is ITickerGardenCurve, ReentrancyGuardTransient {
    uint8 private constant LAUNCH_PHASE_NOT_GRADUATED = 0;
    uint8 private constant LAUNCH_PHASE_POOL_CREATED = 1;
    bytes32 private constant CURVE_SWEEP_DOMAIN = keccak256("TICKERGARDEN_V1_CURVE_SWEEP");
    uint256 private constant CURVE_SWEEP_SCHEMA_VERSION = 1;

    bytes32 private immutable _marketId;
    bytes32 private immutable _tickerGardenBaselineId;
    bytes32 private immutable _quoteAssetConfigId;
    IMarketRegistryV1 private immutable _marketRegistry;
    IProtocolFeeVault private immutable _protocolFeeVault;
    IGraduationExecutor private immutable _graduationExecutor;
    address private immutable _launchRouter;
    address private immutable _creator;
    address private immutable _beneficiaryAtCreation;
    IERC20 private immutable _memeToken;
    address private immutable _quoteAsset;
    uint256 private immutable _phantomQuote;
    uint256 private immutable _graduationThreshold;
    uint256 private immutable _initialSupply;
    uint256 private immutable _curveFeeBps;
    uint16 private immutable _creatorTaxBps;
    uint256 public override accruedCreatorTax;
    uint256 private immutable _launchTimestamp;

    TickerGardenSupplyMath.TrackedReserves private _reserves;
    uint64 private _sweepNonce;
    bool private _hasExecutedTrade;
    bool private _completed;

    error UnauthorizedFactory(address caller, address expectedFactory);
    error InvalidInitialization();
    error InvalidInitialTokenBalance(uint256 expected, uint256 actual);
    error MarketBindingMismatch(bytes32 marketId);
    error MarketNotTradable(uint8 launchPhase, bool completed);
    error InvalidPaymentValue(uint256 expected, uint256 actual);
    error InvalidRecipient(address recipient);
    error SlippageExceeded(uint256 actual, uint256 minimum);
    error TransferCallFailed(address token);
    error InvalidTransferReturn(address token);
    error InexactBalanceDelta(address token, uint256 expected, uint256 actual);
    error NativeTransferFailed(address recipient, uint256 amount);
    error InsufficientTrackedQuote(uint256 available, uint256 required);
    error SweepNonceOverflow();
    error CurveFeeSweepAfterClose(bytes32 marketId);
    error AtomicGraduationNotCommitted(bytes32 marketId, uint8 launchPhase, bytes32 poolId);

    constructor(address factory_) {
        if (factory_ == address(0) || msg.sender != factory_ || factory_.code.length == 0) {
            revert UnauthorizedFactory(msg.sender, factory_);
        }
        CurveInitialization memory init = ICurveInitializationSource(factory_).curveInitialization(address(this));
        _validateInitialization(init, factory_);

        _marketId = init.marketId;
        _tickerGardenBaselineId = init.tickerGardenBaselineId;
        _quoteAssetConfigId = init.quoteAssetConfigId;
        _marketRegistry = IMarketRegistryV1(init.marketRegistry);
        _protocolFeeVault = IProtocolFeeVault(init.protocolFeeVault);
        _graduationExecutor = IGraduationExecutor(init.graduationExecutor);
        _launchRouter = init.launchRouter;
        _creator = init.creator;
        _beneficiaryAtCreation = init.beneficiaryAtCreation;
        _memeToken = IERC20(init.memeToken);
        _quoteAsset = init.quoteAsset;
        _phantomQuote = init.phantomQuote;
        _graduationThreshold = init.graduationThreshold;
        _initialSupply = init.initialSupply;
        _curveFeeBps = init.curveFeeBps;
        _creatorTaxBps = init.creatorTaxBps;
        _launchTimestamp = block.timestamp;
        _reserves = TickerGardenSupplyMath.initialize(init.initialSupply, init.phantomQuote, init.graduationThreshold);

        uint256 actualBalance = IERC20(init.memeToken).balanceOf(address(this));
        if (actualBalance != init.initialSupply) {
            revert InvalidInitialTokenBalance(init.initialSupply, actualBalance);
        }
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        override
        nonReentrant
        returns (uint256 tokensOut, uint256 quoteSpent)
    {
        _requireTradable();
        _requireRecipient(recipient);
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote = _buyQuote(quoteIn, minTokensOut, recipient, msg.sender);
        if (!quote.curveQuote.slippagePass) {
            revert SlippageExceeded(quote.curveQuote.tokensOut, minTokensOut);
        }

        _collectQuote(msg.sender, quoteIn);

        TickerGardenCurveMath.BuyQuote memory curveQuote = quote.curveQuote;
        _reserves.trackedQuote += curveQuote.quoteSpent;
        _reserves.accruedQuoteFees += curveQuote.fee + curveQuote.additionalQuoteFee + curveQuote.creatorTaxFee;
        accruedCreatorTax += curveQuote.creatorTaxFee;
        _reserves.trackedTokens -= curveQuote.tokensOut;
        _hasExecutedTrade = true;
        if (TickerGardenSupplyMath.sellableTokens(_reserves) == 0) _completed = true;

        _transferTokenExact(address(_memeToken), recipient, curveQuote.tokensOut);
        if (curveQuote.refund != 0) {
            _transferQuoteExact(msg.sender, curveQuote.refund);
            emit CurveBuyRefunded(msg.sender, curveQuote.refund);
        }

        emit CurveBuy(
            msg.sender,
            recipient,
            curveQuote.quoteSpent,
            curveQuote.tokensOut,
            curveQuote.fee,
            curveQuote.additionalQuoteFee + curveQuote.creatorTaxFee
        );
        if (_completed) {
            _finalizeLaunch();
            emit CurveCompleted(_marketId);
        }
        return (curveQuote.tokensOut, curveQuote.quoteSpent);
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
        external
        override
        nonReentrant
        returns (uint256 quoteOut, uint256 fee)
    {
        _requireTradable();
        _requireRecipient(recipient);
        TickerGardenCurveMath.SellQuote memory quote = _sellQuote(tokensIn, minQuoteOut);
        if (!quote.slippagePass) revert SlippageExceeded(quote.quoteOut, minQuoteOut);

        uint256 realReserve = _realQuoteReserve();
        if (quote.grossQuoteOut > realReserve) {
            revert InsufficientTrackedQuote(realReserve, quote.grossQuoteOut);
        }
        _collectTokenExact(address(_memeToken), msg.sender, tokensIn);

        _reserves.trackedTokens += tokensIn;
        _reserves.trackedQuote -= quote.quoteOut;
        _reserves.accruedQuoteFees += quote.fee + quote.additionalQuoteFee;
        accruedCreatorTax += quote.additionalQuoteFee;
        _hasExecutedTrade = true;

        _transferQuoteExact(recipient, quote.quoteOut);
        emit CurveSell(msg.sender, recipient, tokensIn, quote.quoteOut, quote.fee, quote.additionalQuoteFee);
        return (quote.quoteOut, quote.fee + quote.additionalQuoteFee);
    }

    function sweepCurveFees() external override nonReentrant returns (uint256 sweptAmount) {
        MarketView memory marketView = _requireRegisteredCurve();
        if (marketView.runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED) {
            revert CurveFeeSweepAfterClose(_marketId);
        }
        return _sweepCurveFees(marketView);
    }

    function _sweepCurveFees(MarketView memory marketView) private returns (uint256 sweptAmount) {
        sweptAmount = _reserves.accruedQuoteFees;
        if (sweptAmount == 0) return 0;
        if (_sweepNonce == type(uint64).max) revert SweepNonceOverflow();

        uint64 nextNonce = _sweepNonce + 1;
        bytes32 feeId = keccak256(
            abi.encode(
                CURVE_SWEEP_DOMAIN,
                CURVE_SWEEP_SCHEMA_VERSION,
                block.chainid,
                address(_protocolFeeVault),
                address(this),
                _marketId,
                marketView.runtime.sourceVersion,
                nextNonce,
                _quoteAsset,
                sweptAmount,
                accruedCreatorTax
            )
        );

        _sweepNonce = nextNonce;
        _reserves.accruedQuoteFees = 0;
        _reserves.trackedQuote -= sweptAmount;
        _protocolFeeVault.beginCurveCredit(
            _marketId, _quoteAsset, sweptAmount, accruedCreatorTax, marketView.runtime.sourceVersion, nextNonce, feeId
        );
        if (_quoteAsset == address(0)) {
            _protocolFeeVault.finalizeCurveCredit{value: sweptAmount}(
                _marketId,
                _quoteAsset,
                sweptAmount,
                accruedCreatorTax,
                marketView.runtime.sourceVersion,
                nextNonce,
                feeId
            );
        } else {
            _transferTokenExact(_quoteAsset, address(_protocolFeeVault), sweptAmount);
            _protocolFeeVault.finalizeCurveCredit(
                _marketId,
                _quoteAsset,
                sweptAmount,
                accruedCreatorTax,
                marketView.runtime.sourceVersion,
                nextNonce,
                feeId
            );
        }
        accruedCreatorTax = 0;
        emit CurveFeeTransferred(_marketId, nextNonce, feeId, sweptAmount);
    }

    function _finalizeLaunch() private {
        MarketView memory marketView = _requireRegisteredCurve();
        if (marketView.runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED) {
            revert AtomicGraduationNotCommitted(_marketId, marketView.runtime.launchPhase, marketView.runtime.poolId);
        }
        _sweepCurveFees(marketView);

        uint256 sweptQuote = _reserves.trackedQuote;
        uint256 sweptTokens = _reserves.trackedTokens;
        _validateActualGraduationPlan(sweptQuote, sweptTokens);
        _reserves.trackedQuote = 0;
        _reserves.trackedTokens = 0;

        _transferTokenExact(address(_memeToken), address(_graduationExecutor), sweptTokens);
        if (_quoteAsset == address(0)) {
            _graduationExecutor.graduateFromCurve{value: sweptQuote}(_marketId, sweptQuote, sweptTokens);
        } else {
            _transferTokenExact(_quoteAsset, address(_graduationExecutor), sweptQuote);
            _graduationExecutor.graduateFromCurve(_marketId, sweptQuote, sweptTokens);
        }

        MarketView memory committedMarket = _requireRegisteredCurve();
        if (
            committedMarket.runtime.launchPhase != LAUNCH_PHASE_POOL_CREATED
                || committedMarket.runtime.poolId == bytes32(0)
        ) {
            revert AtomicGraduationNotCommitted(
                _marketId, committedMarket.runtime.launchPhase, committedMarket.runtime.poolId
            );
        }
    }

    /// @dev Integer rounding across an arbitrary trade history may leave more Quote than the configuration-derived
    ///      terminal amount. Pool price and liquidity remain history-independent: all excess Quote is transferred to
    ///      the permanent Locker, while this check rolls back any impossible under-collateralized terminal state.
    function _validateActualGraduationPlan(uint256 sweptQuote, uint256 sweptTokens) private view {
        uint256 reserved = _reserves.reservedTokens;
        uint256 poolQuoteAmount =
            TickerGardenSupplyMath.canonicalGraduationQuote(_initialSupply, _phantomQuote, _graduationThreshold);
        if (sweptTokens != reserved || sweptQuote < poolQuoteAmount) revert InvalidInitialization();
        (uint256 poolMemeAmount,) =
            TickerGardenSupplyMath.graduationPartition(sweptTokens, poolQuoteAmount, _phantomQuote);
        PoolKey memory key = _marketRegistry.canonicalPoolKey(_marketId);
        GraduationPoolMath.derive(key, _quoteAsset, address(_memeToken), poolQuoteAmount, poolMemeAmount);
    }

    function quoteBuy(uint256 quoteIn, address recipient)
        external
        view
        override
        returns (uint256 tokensOut, uint256 quoteSpent, uint256 refund)
    {
        _requireTradable();
        _requireRecipient(recipient);
        TickerGardenCurveMath.BuyQuote memory quote = _buyQuote(quoteIn, 0, recipient, msg.sender).curveQuote;
        return (quote.tokensOut, quote.quoteSpent, quote.refund);
    }

    function quoteSell(uint256 tokensIn) external view override returns (uint256 quoteOut, uint256 fee) {
        _requireTradable();
        TickerGardenCurveMath.SellQuote memory quote = _sellQuote(tokensIn, 0);
        return (quote.quoteOut, quote.fee + quote.additionalQuoteFee);
    }

    function quoteAsset() external view override returns (address) {
        return _quoteAsset;
    }

    function getReserves() external view override returns (uint256 quoteReserve, uint256 tokenReserve) {
        if (_completed) return (0, 0);
        return TickerGardenSupplyMath.pricingReserves(_reserves, _phantomQuote);
    }

    function realQuoteReserve() external view override returns (uint256) {
        return _realQuoteReserve();
    }

    function sellableTokens() external view override returns (uint256) {
        if (_completed) return 0;
        return TickerGardenSupplyMath.sellableTokens(_reserves);
    }

    function reservedTokens() external view override returns (uint256) {
        return _reserves.reservedTokens;
    }

    function readyToGraduate() external view override returns (bool) {
        if (!_completed) return false;
        MarketView memory marketView = _marketRegistry.market(_marketId);
        return marketView.config.curve == address(this) && marketView.runtime.launchPhase == LAUNCH_PHASE_NOT_GRADUATED;
    }

    function creatorTaxBps() external view override returns (uint16) {
        return _creatorTaxBps;
    }

    function accruedCurveFees() external view override returns (uint256) {
        return _reserves.accruedQuoteFees;
    }

    function sweepNonce() external view override returns (uint64) {
        return _sweepNonce;
    }

    function _buyQuote(uint256 quoteIn, uint256 minTokensOut, address recipient, address caller)
        private
        view
        returns (TickerGardenAntiSnipe.AntiSnipeBuyQuote memory)
    {
        (uint256 quoteReserve, uint256 tokenReserve) = TickerGardenSupplyMath.pricingReserves(_reserves, _phantomQuote);
        address atomicFirstBuyRecipient = caller == _launchRouter && !_hasExecutedTrade ? recipient : address(0);
        TickerGardenAntiSnipe.AntiSnipeBuyQuote memory quote;
        quote.exempt = TickerGardenAntiSnipe.isExempt(
            recipient,
            caller,
            TickerGardenAntiSnipe.ExemptionContext(
                _creator, _beneficiaryAtCreation, _launchRouter, atomicFirstBuyRecipient
            )
        );
        (quote.rawSnipeBps, quote.effectiveSnipeBps) = TickerGardenAntiSnipe.effectiveSnipeBps(
            TickerGardenAntiSnipe.elapsedSince(block.timestamp, _launchTimestamp),
            quote.exempt,
            _curveFeeBps + _creatorTaxBps
        );
        quote.curveQuote = TickerGardenCurveMath.quoteBuyWithCreatorTax(
            quoteIn,
            quoteReserve,
            tokenReserve,
            _reserves.reservedTokens,
            _curveFeeBps,
            quote.effectiveSnipeBps,
            _creatorTaxBps,
            minTokensOut
        );
        return quote;
    }

    function _sellQuote(uint256 tokensIn, uint256 minQuoteOut)
        private
        view
        returns (TickerGardenCurveMath.SellQuote memory)
    {
        (uint256 quoteReserve, uint256 tokenReserve) = TickerGardenSupplyMath.pricingReserves(_reserves, _phantomQuote);
        return TickerGardenCurveMath.quoteSell(
            tokensIn, tokenReserve, quoteReserve, _curveFeeBps, _creatorTaxBps, minQuoteOut
        );
    }

    function _requireTradable() private view {
        MarketView memory marketView = _requireRegisteredCurve();
        if (marketView.runtime.launchPhase != LAUNCH_PHASE_NOT_GRADUATED || _completed) {
            revert MarketNotTradable(marketView.runtime.launchPhase, _completed);
        }
    }

    function _requireRegisteredCurve() private view returns (MarketView memory marketView) {
        marketView = _marketRegistry.market(_marketId);
        if (
            marketView.config.curve != address(this) || marketView.config.memeToken != address(_memeToken)
                || marketView.config.quoteAsset != _quoteAsset
                || marketView.config.tickerGardenBaselineId != _tickerGardenBaselineId
                || marketView.config.quoteAssetConfigId != _quoteAssetConfigId
                || marketView.config.creatorTaxBps != _creatorTaxBps
                || marketView.config.creatorRevenueBeneficiaryAtCreation != _beneficiaryAtCreation
        ) revert MarketBindingMismatch(_marketId);
    }

    function _realQuoteReserve() private view returns (uint256) {
        return _reserves.trackedQuote - _reserves.accruedQuoteFees;
    }

    function _collectQuote(address payer, uint256 amount) private {
        if (_quoteAsset == address(0)) {
            if (msg.value != amount) revert InvalidPaymentValue(amount, msg.value);
        } else {
            if (msg.value != 0) revert InvalidPaymentValue(0, msg.value);
            _collectTokenExact(_quoteAsset, payer, amount);
        }
    }

    function _collectTokenExact(address token, address payer, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        _strictTokenCall(token, abi.encodeCall(IERC20.transferFrom, (payer, address(this), amount)));
        uint256 afterBalance = IERC20(token).balanceOf(address(this));
        uint256 actual = afterBalance >= beforeBalance ? afterBalance - beforeBalance : type(uint256).max;
        if (actual != amount) revert InexactBalanceDelta(token, amount, actual);
    }

    function _transferQuoteExact(address recipient, uint256 amount) private {
        if (_quoteAsset == address(0)) {
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert NativeTransferFailed(recipient, amount);
        } else {
            _transferTokenExact(_quoteAsset, recipient, amount);
        }
    }

    function _transferTokenExact(address token, address recipient, uint256 amount) private {
        uint256 senderBefore = IERC20(token).balanceOf(address(this));
        uint256 recipientBefore = IERC20(token).balanceOf(recipient);
        _strictTokenCall(token, abi.encodeCall(IERC20.transfer, (recipient, amount)));
        uint256 senderAfter = IERC20(token).balanceOf(address(this));
        uint256 recipientAfter = IERC20(token).balanceOf(recipient);
        uint256 debit = senderBefore >= senderAfter ? senderBefore - senderAfter : type(uint256).max;
        uint256 credit = recipientAfter >= recipientBefore ? recipientAfter - recipientBefore : type(uint256).max;
        if (debit != amount) revert InexactBalanceDelta(token, amount, debit);
        if (credit != amount) revert InexactBalanceDelta(token, amount, credit);
    }

    function _strictTokenCall(address token, bytes memory data) private {
        (bool success, bytes memory result) = token.call(data);
        if (!success) revert TransferCallFailed(token);
        if (result.length != 32 || abi.decode(result, (uint256)) != 1) revert InvalidTransferReturn(token);
    }

    function _requireRecipient(address recipient) private view {
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient(recipient);
    }

    function _validateInitialization(CurveInitialization memory init, address factory_) private view {
        if (
            init.marketId == bytes32(0) || init.tickerGardenBaselineId == bytes32(0)
                || init.quoteAssetConfigId == bytes32(0) || init.marketRegistry.code.length == 0
                || init.protocolFeeVault.code.length == 0 || init.graduationExecutor.code.length == 0
                || init.launchRouter.code.length == 0 || init.creator == address(0)
                || init.beneficiaryAtCreation == address(0) || init.memeToken.code.length == 0 || init.phantomQuote == 0
                || init.graduationThreshold == 0 || init.initialSupply == 0 || init.creatorTaxBps > 500
                || init.curveFeeBps + uint256(init.creatorTaxBps) > 9_900
                || (init.quoteAsset != address(0) && init.quoteAsset.code.length == 0)
        ) revert InvalidInitialization();

        ITickerMemeTokenV1 token = ITickerMemeTokenV1(init.memeToken);
        if (
            token.marketId() != init.marketId || token.creator() != init.creator || token.factory() != factory_
                || token.initialSupply() != init.initialSupply || token.totalSupply() != init.initialSupply
                || ICurveMarketRegistryDependencies(init.marketRegistry).graduationExecutor() != init.graduationExecutor
        ) revert InvalidInitialization();
    }
}
