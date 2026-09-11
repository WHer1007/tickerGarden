// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {TickerGardenAntiSnipe} from "../../../src/v1/libraries/TickerGardenAntiSnipe.sol";
import {TickerGardenCurveMath} from "../../../src/v1/libraries/TickerGardenCurveMath.sol";
import {TickerGardenSupplyMath} from "../../../src/v1/libraries/TickerGardenSupplyMath.sol";

/// @notice Machine-linked Solidity replay of frozen TickerGarden vectors plus directly observed runtime evidence.
contract V1TickerGardenDifferentialTest is Test {
    string private _vectors;
    string private _runtime;

    function setUp() public {
        string memory root = vm.projectRoot();
        _vectors = vm.readFile(string.concat(root, "/../spec/v1_pons_behavior_vectors.json"));
        _runtime = vm.readFile(string.concat(root, "/../spec/v1_pons_runtime_evidence.json"));
    }

    function test_machineVectorsBindApprovedRuntimeIdentityAndDeclareNoDifferences() public view {
        assertEq(_string(_vectors, ".baselineId"), _string(_runtime, ".baselineId"));
        assertEq(_string(_vectors, ".executionSpecId"), _string(_runtime, ".executionSpecId"));
        assertEq(_string(_runtime, ".status"), "APPROVED_RUNTIME_VECTORS");
        assertEq(_string(_vectors, ".reference.runtimeKeccak256"), _string(_runtime, ".factory.runtimeKeccak256"));
        assertTrue(vm.parseJsonBool(_vectors, ".differencePolicy.requireExplicitDifferenceId"));
        assertEq(vm.parseJsonStringArray(_vectors, ".differencePolicy.registeredDifferenceIds").length, 0);

        string[14] memory ids = [
            string("SUPPLY_NATIVE_CONFIG_0"),
            "SUPPLY_USDG_6_DECIMALS",
            "AMOUNT_OUT_INTEGER_FLOOR",
            "BUY_FEE_BEFORE_PRICING",
            "BUY_TWO_QUOTE_FEE_LEGS_FLOOR_SEPARATELY",
            "SELL_FEE_AFTER_GROSS_QUOTE",
            "TAIL_PARTIAL_FILL_AND_REFUND",
            "TAIL_PARTIAL_FILL_PRICE_BOUND_REVERT",
            "ANTI_SNIPE_RUNTIME_ELAPSED_0_CLIPPED",
            "ANTI_SNIPE_RUNTIME_ELAPSED_1",
            "ANTI_SNIPE_RUNTIME_ELAPSED_2",
            "ANTI_SNIPE_RUNTIME_ELAPSED_3_ZERO",
            "ANTI_SNIPE_AUTOMATIC_EXEMPTION_AT_LAUNCH",
            "GRADUATION_POOL_MEME_AND_LOCKED_EXCESS"
        ];
        for (uint256 i; i < ids.length; ++i) {
            assertEq(_string(_vectors, _path(i, ".id")), ids[i]);
        }

        assertEq(_number(_runtime, ".differentialVectorCount"), 14);
        string[14] memory runtimeIds = [
            string("RUNTIME_SUPPLY_NATIVE_CONFIG_0"),
            "RUNTIME_SUPPLY_USDG_CONFIG_0",
            "RUNTIME_AMOUNT_OUT_LAUNCH_BUY",
            "RUNTIME_BUY_FEE_BEFORE_PRICING",
            "RUNTIME_BUY_TWO_QUOTE_FEE_LEGS",
            "RUNTIME_SELL_FEE_AFTER_GROSS_QUOTE",
            "RUNTIME_TAIL_PARTIAL_FILL_AND_REFUND",
            "RUNTIME_PRICE_BOUND_REVERT",
            "RUNTIME_ANTI_SNIPE_ELAPSED_0",
            "RUNTIME_ANTI_SNIPE_ELAPSED_1",
            "RUNTIME_ANTI_SNIPE_ELAPSED_2",
            "RUNTIME_ANTI_SNIPE_ELAPSED_3",
            "RUNTIME_ANTI_SNIPE_CREATOR_EXEMPT",
            "RUNTIME_NATIVE_GRADUATION_PARTITION"
        ];
        for (uint256 i; i < runtimeIds.length; ++i) {
            assertEq(_string(_runtime, _runtimePath(i, ".id")), runtimeIds[i]);
        }
    }

    function test_supplyAndGraduationVectorsMatchFrozenReferenceOutputsExactly() public view {
        for (uint256 i; i < 2; ++i) {
            (uint256 reserved, uint256 sellable) = TickerGardenSupplyMath.supplyPartition(
                _number(_vectors, _path(i, ".inputs.supply")),
                _number(_vectors, _path(i, ".inputs.phantomQuote")),
                _number(_vectors, _path(i, ".inputs.graduationThreshold"))
            );
            assertEq(reserved, _number(_vectors, _path(i, ".outputs.reservedTokens")));
            assertEq(sellable, _number(_vectors, _path(i, ".outputs.sellableTokens")));
        }

        uint256 index = 13;
        (uint256 poolMeme, uint256 lockedExcess) = TickerGardenSupplyMath.graduationPartition(
            _number(_vectors, _path(index, ".inputs.sweptTokens")),
            _number(_vectors, _path(index, ".inputs.sweptQuote")),
            _number(_vectors, _path(index, ".inputs.phantomQuote"))
        );
        assertEq(poolMeme, _number(_vectors, _path(index, ".outputs.poolMemeAmount")));
        assertEq(lockedExcess, _number(_vectors, _path(index, ".outputs.lockedExcessMeme")));
    }

    function test_curveTradeVectorsMatchFrozenReferenceOutputsExactly() public view {
        uint256 amountOutIndex = 2;
        assertEq(
            TickerGardenCurveMath.amountOut(
                _number(_vectors, _path(amountOutIndex, ".inputs.amountIn")),
                _number(_vectors, _path(amountOutIndex, ".inputs.reserveIn")),
                _number(_vectors, _path(amountOutIndex, ".inputs.reserveOut")),
                _number(_vectors, _path(amountOutIndex, ".inputs.feeBps"))
            ),
            _number(_vectors, _path(amountOutIndex, ".outputs.amountOut"))
        );

        _assertBuy(3, false);
        _assertBuy(4, false);
        _assertSell(5);
        _assertBuy(6, true);

        uint256 slippageIndex = 7;
        assertEq(
            TickerGardenCurveMath.proportionalSlippagePass(
                _number(_vectors, _path(slippageIndex, ".inputs.quoteSpent")),
                _number(_vectors, _path(slippageIndex, ".inputs.minTokensOut")),
                _number(_vectors, _path(slippageIndex, ".inputs.quoteReceived")),
                _number(_vectors, _path(slippageIndex, ".inputs.tokensOut"))
            ),
            vm.parseJsonBool(_vectors, _path(slippageIndex, ".outputs.slippagePass"))
        );
    }

    function test_historicalAntiSnipeEvidenceIsInternallyConsistent() public view {
        for (uint256 offset; offset < 5; ++offset) {
            uint256 index = 8 + offset;
            uint256 elapsed = _number(_vectors, _path(index, ".inputs.elapsedSeconds"));
            bool exempt = vm.parseJsonBool(_vectors, _path(index, ".inputs.exempt"));
            uint256 feeBps = _number(_vectors, _path(index, ".inputs.feeBps"));
            assertEq(_number(_vectors, _path(index, ".inputs.creatorTaxBps")), 0);
            assertEq(_number(_vectors, _path(index, ".inputs.minimumNetBps")), 100);

            (uint256 rawBps, uint256 effectiveBps) = _historicalSnipe(elapsed, exempt, feeBps);
            assertEq(rawBps, _number(_vectors, _path(index, ".outputs.rawSnipeBps")));
            assertEq(effectiveBps, _number(_vectors, _path(index, ".outputs.effectiveSnipeBps")));

            uint256 runtimeIndex = exempt ? 0 : elapsed;
            string memory runtimeField = exempt ? ".creatorRecipientBps" : ".ordinaryRecipientBps";
            assertEq(
                rawBps,
                _number(
                    _runtime, string.concat(".antiSnipe.rawSchedule[", vm.toString(runtimeIndex), "]", runtimeField)
                )
            );

            TickerGardenCurveMath.BuyQuote memory quote = TickerGardenCurveMath.quoteBuy(
                _number(_vectors, _path(index, ".inputs.quoteReceived")),
                _number(_vectors, _path(index, ".inputs.quoteReserve")),
                _number(_vectors, _path(index, ".inputs.tokenReserve")),
                _number(_vectors, _path(index, ".inputs.reservedTokens")),
                feeBps,
                effectiveBps,
                0
            );
            assertEq(quote.fee, _number(_vectors, _path(index, ".outputs.fee")));
            assertEq(quote.additionalQuoteFee, _number(_vectors, _path(index, ".outputs.snipeFee")));
            assertEq(quote.netQuote, _number(_vectors, _path(index, ".outputs.netQuote")));
            assertEq(quote.tokensOut, _number(_vectors, _path(index, ".outputs.tokensOut")));
        }
    }

    function test_runtimeDifferentialSupplyAndGraduationOutputsMatchExactly() public view {
        for (uint256 i; i < 2; ++i) {
            (uint256 reserved, uint256 sellable) = TickerGardenSupplyMath.supplyPartition(
                _number(_runtime, _runtimePath(i, ".inputs.supply")),
                _number(_runtime, _runtimePath(i, ".inputs.phantomQuote")),
                _number(_runtime, _runtimePath(i, ".inputs.graduationThreshold"))
            );
            assertEq(reserved, _number(_runtime, _runtimePath(i, ".outputs.reservedTokens")));
            assertEq(sellable, _number(_runtime, _runtimePath(i, ".outputs.sellableTokens")));
        }

        uint256 index = 13;
        (uint256 poolMeme, uint256 lockedExcess) = TickerGardenSupplyMath.graduationPartition(
            _number(_runtime, _runtimePath(index, ".inputs.sweptTokens")),
            _number(_runtime, _runtimePath(index, ".inputs.sweptQuote")),
            _number(_runtime, _runtimePath(index, ".inputs.phantomQuote"))
        );
        assertEq(poolMeme, _number(_runtime, _runtimePath(index, ".outputs.poolMemeAmount")));
        assertEq(lockedExcess, _number(_runtime, _runtimePath(index, ".outputs.lockedExcessMeme")));
    }

    function test_runtimeDifferentialTradeAndRevertOutputsMatchExactly() public view {
        uint256 amountOutIndex = 2;
        assertEq(
            TickerGardenCurveMath.amountOut(
                _number(_runtime, _runtimePath(amountOutIndex, ".inputs.amountIn")),
                _number(_runtime, _runtimePath(amountOutIndex, ".inputs.reserveIn")),
                _number(_runtime, _runtimePath(amountOutIndex, ".inputs.reserveOut")),
                _number(_runtime, _runtimePath(amountOutIndex, ".inputs.feeBps"))
            ),
            _number(_runtime, _runtimePath(amountOutIndex, ".outputs.amountOut"))
        );

        _assertRuntimeBuy(3, false);
        _assertRuntimeBuy(4, false);
        _assertRuntimeSell(5);
        _assertRuntimeBuy(6, true);

        uint256 slippageIndex = 7;
        assertEq(
            TickerGardenCurveMath.proportionalSlippagePass(
                _number(_runtime, _runtimePath(slippageIndex, ".inputs.quoteSpent")),
                _number(_runtime, _runtimePath(slippageIndex, ".inputs.minTokensOut")),
                _number(_runtime, _runtimePath(slippageIndex, ".inputs.quoteReceived")),
                _number(_runtime, _runtimePath(slippageIndex, ".inputs.tokensOut"))
            ),
            vm.parseJsonBool(_runtime, _runtimePath(slippageIndex, ".outputs.slippagePass"))
        );
        assertEq(
            uint256(uint32(bytes4(vm.parseJsonBytes(_runtime, _runtimePath(slippageIndex, ".provenance.revertData"))))),
            uint256(uint32(0x71c4efed))
        );
    }

    function test_historicalRuntimeAntiSnipeScheduleMatchesEvidence() public view {
        for (uint256 index = 8; index < 13; ++index) {
            uint256 elapsed = _number(_runtime, _runtimePath(index, ".inputs.elapsedSeconds"));
            bool exempt = vm.parseJsonBool(_runtime, _runtimePath(index, ".inputs.exempt"));
            (uint256 rawBps,) = _historicalSnipe(elapsed, exempt, 100);
            assertEq(rawBps, _number(_runtime, _runtimePath(index, ".outputs.rawSnipeBps")));

            uint256 observationIndex = _number(_runtime, _runtimePath(index, ".provenance.observationIndex"));
            string memory observedField = exempt ? ".creatorRecipientBps" : ".ordinaryRecipientBps";
            assertEq(
                rawBps,
                _number(
                    _runtime,
                    string.concat(".antiSnipe.rawSchedule[", vm.toString(observationIndex), "]", observedField)
                )
            );
        }
    }

    // Archived external runtime evidence predates the approved five-second product policy.
    // Current production boundaries are covered independently by TickerGardenAntiSnipeTest.
    function _historicalSnipe(uint256 elapsed, bool exempt, uint256 feeBps)
        private
        pure
        returns (uint256 raw, uint256 effective)
    {
        raw = exempt || elapsed >= 3 ? 0 : elapsed == 0 ? 9900 : elapsed == 1 ? 618 : 19;
        effective = raw < 9900 - feeBps ? raw : 9900 - feeBps;
    }

    function _assertBuy(uint256 index, bool checkNetRequired) private view {
        TickerGardenCurveMath.BuyQuote memory quote = TickerGardenCurveMath.quoteBuy(
            _number(_vectors, _path(index, ".inputs.quoteReceived")),
            _number(_vectors, _path(index, ".inputs.quoteReserve")),
            _number(_vectors, _path(index, ".inputs.tokenReserve")),
            _number(_vectors, _path(index, ".inputs.reservedTokens")),
            _number(_vectors, _path(index, ".inputs.feeBps")),
            _number(_vectors, _path(index, ".inputs.additionalQuoteFeeBps")),
            _number(_vectors, _path(index, ".inputs.minTokensOut"))
        );
        if (checkNetRequired) {
            assertEq(quote.netRequired, _number(_vectors, _path(index, ".outputs.netRequired")));
        } else {
            assertEq(quote.netRequired, 0);
        }
        assertEq(quote.quoteSpent, _number(_vectors, _path(index, ".outputs.quoteSpent")));
        assertEq(quote.fee, _number(_vectors, _path(index, ".outputs.fee")));
        assertEq(quote.additionalQuoteFee, _number(_vectors, _path(index, ".outputs.additionalQuoteFee")));
        if (!checkNetRequired) {
            assertEq(quote.netQuote, _number(_vectors, _path(index, ".outputs.netQuote")));
        }
        assertEq(quote.tokensOut, _number(_vectors, _path(index, ".outputs.tokensOut")));
        assertEq(quote.refund, _number(_vectors, _path(index, ".outputs.refund")));
        assertEq(quote.partialFill, vm.parseJsonBool(_vectors, _path(index, ".outputs.partialFill")));
        if (checkNetRequired) {
            assertEq(quote.slippagePass, vm.parseJsonBool(_vectors, _path(index, ".outputs.slippagePass")));
        }
    }

    function _assertSell(uint256 index) private view {
        TickerGardenCurveMath.SellQuote memory quote = TickerGardenCurveMath.quoteSell(
            _number(_vectors, _path(index, ".inputs.tokensIn")),
            _number(_vectors, _path(index, ".inputs.tokenReserve")),
            _number(_vectors, _path(index, ".inputs.quoteReserve")),
            _number(_vectors, _path(index, ".inputs.feeBps")),
            _number(_vectors, _path(index, ".inputs.additionalQuoteFeeBps")),
            _number(_vectors, _path(index, ".inputs.minQuoteOut"))
        );
        assertEq(quote.grossQuoteOut, _number(_vectors, _path(index, ".outputs.grossQuoteOut")));
        assertEq(quote.fee, _number(_vectors, _path(index, ".outputs.fee")));
        assertEq(quote.additionalQuoteFee, _number(_vectors, _path(index, ".outputs.additionalQuoteFee")));
        assertEq(quote.quoteOut, _number(_vectors, _path(index, ".outputs.quoteOut")));
    }

    function _assertRuntimeBuy(uint256 index, bool tail) private view {
        TickerGardenCurveMath.BuyQuote memory quote = TickerGardenCurveMath.quoteBuy(
            _number(_runtime, _runtimePath(index, ".inputs.quoteReceived")),
            _number(_runtime, _runtimePath(index, ".inputs.quoteReserve")),
            _number(_runtime, _runtimePath(index, ".inputs.tokenReserve")),
            _number(_runtime, _runtimePath(index, ".inputs.reservedTokens")),
            _number(_runtime, _runtimePath(index, ".inputs.feeBps")),
            _number(_runtime, _runtimePath(index, ".inputs.additionalQuoteFeeBps")),
            _number(_runtime, _runtimePath(index, ".inputs.minTokensOut"))
        );
        if (tail) assertEq(quote.netRequired, _number(_runtime, _runtimePath(index, ".outputs.netRequired")));
        assertEq(quote.quoteSpent, _number(_runtime, _runtimePath(index, ".outputs.quoteSpent")));
        assertEq(quote.fee, _number(_runtime, _runtimePath(index, ".outputs.fee")));
        assertEq(quote.additionalQuoteFee, _number(_runtime, _runtimePath(index, ".outputs.additionalQuoteFee")));
        if (!tail) assertEq(quote.netQuote, _number(_runtime, _runtimePath(index, ".outputs.netQuote")));
        assertEq(quote.tokensOut, _number(_runtime, _runtimePath(index, ".outputs.tokensOut")));
        assertEq(quote.refund, _number(_runtime, _runtimePath(index, ".outputs.refund")));
        assertEq(quote.partialFill, vm.parseJsonBool(_runtime, _runtimePath(index, ".outputs.partialFill")));
        if (tail) {
            assertEq(quote.slippagePass, vm.parseJsonBool(_runtime, _runtimePath(index, ".outputs.slippagePass")));
        }
    }

    function _assertRuntimeSell(uint256 index) private view {
        TickerGardenCurveMath.SellQuote memory quote = TickerGardenCurveMath.quoteSell(
            _number(_runtime, _runtimePath(index, ".inputs.tokensIn")),
            _number(_runtime, _runtimePath(index, ".inputs.tokenReserve")),
            _number(_runtime, _runtimePath(index, ".inputs.quoteReserve")),
            _number(_runtime, _runtimePath(index, ".inputs.feeBps")),
            _number(_runtime, _runtimePath(index, ".inputs.additionalQuoteFeeBps")),
            _number(_runtime, _runtimePath(index, ".inputs.minQuoteOut"))
        );
        assertEq(quote.grossQuoteOut, _number(_runtime, _runtimePath(index, ".outputs.grossQuoteOut")));
        assertEq(quote.fee, _number(_runtime, _runtimePath(index, ".outputs.fee")));
        assertEq(quote.additionalQuoteFee, _number(_runtime, _runtimePath(index, ".outputs.additionalQuoteFee")));
        assertEq(quote.quoteOut, _number(_runtime, _runtimePath(index, ".outputs.quoteOut")));
    }

    function _path(uint256 index, string memory suffix) private pure returns (string memory) {
        return string.concat(".vectors[", vm.toString(index), "]", suffix);
    }

    function _runtimePath(uint256 index, string memory suffix) private pure returns (string memory) {
        return string.concat(".differentialVectors[", vm.toString(index), "]", suffix);
    }

    function _number(string memory json, string memory path) private pure returns (uint256) {
        try vm.parseJsonString(json, path) returns (string memory value) {
            return vm.parseUint(value);
        } catch {
            return vm.parseJsonUint(json, path);
        }
    }

    function _string(string memory json, string memory path) private pure returns (string memory) {
        return vm.parseJsonString(json, path);
    }
}
