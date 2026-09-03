import json
import hashlib
import re
import subprocess
import unittest
from pathlib import Path

from spec.generate_v2_hash_vectors import keccak256
from spec.v2_reference_model import (
    ACTIVATION_DELAY_SECONDS,
    ACTIVATION_WHEEL_SIZE,
    ActivationSlot,
    BPS_DENOMINATOR,
    COMPONENT_SALT_DOMAIN_LABEL,
    FEE_PIPS,
    INT128_MAX,
    INDEX_PRECISION,
    LP_SHARE_BPS,
    MAX_ACCOUNTING_AMOUNT,
    MAX_LIFETIME_FEE_CREDITS,
    MIN_SUPPORTED_ASSET_DECIMALS,
    PIPS_DENOMINATOR,
    STAKE_SATURATION_WHOLE_TOKENS,
    UINT64_MAX,
    UINT256_MAX,
    accumulator_lifetime_bound,
    add_activation_bucket,
    checked_add_uint256,
    credit_pool_index,
    current_snipe_tax_bps,
    curve_amount_in,
    curve_amount_out,
    derive_component_salt,
    empty_activation_wheel,
    effective_snipe_tax_bps,
    graduation_seed,
    maximum_post_graduation_fee_base,
    minimum_nonzero_stock_position,
    mul_div_ceil,
    mul_div_floor,
    partition_curve_fee,
    partition_graduation_tokens,
    partition_pool_fee,
    partition_supply,
    predict_create2_address,
    process_mature_activations,
    product_lte,
    quote_economics_hash,
    quote_curve_buy,
    quote_curve_sell,
    remove_activation_position,
    schedule_new_pending,
    settle_user_reward,
    stake_saturation_amount,
)


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent


def load(name):
    with (ROOT / name).open(encoding="utf-8") as handle:
        return json.load(handle)


class V2ExecutionSpecTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load("v2_execution_manifest.json")
        cls.permissions = load("v2_permissions_matrix.json")
        cls.abi = load("v2_abi_surface.json")
        cls.canonical_abi = load("v2_canonical_abi.json")
        cls.hash_schemas = load("v2_hash_schemas.json")
        cls.external_evidence = load("v2_g0_external_evidence.json")
        cls.g0_recommendations = load("v2_g0_recommendations.json")
        cls.pons_vectors = load("v2_pons_behavior_vectors.json")
        cls.pons_runtime_evidence = load("v2_pons_runtime_evidence.json")
        cls.initial_quote_configs = load("v2_initial_quote_configs.json")
        cls.numeric_bounds = load("v2_numeric_bounds.json")
        cls.official_stock_catalog = load("v2_rh_official_stock_catalog.snapshot.json")
        cls.official_stock_catalog_raw = (ROOT / "v2_rh_official_stock_catalog.source.json").read_bytes()

    def test_spec_ids_match(self):
        expected = "V2-EXEC-3"
        self.assertEqual(self.manifest["executionSpecId"], expected)
        self.assertEqual(self.permissions["executionSpecId"], expected)
        self.assertEqual(self.abi["executionSpecId"], expected)
        self.assertEqual(self.canonical_abi["executionSpecId"], expected)

    def test_pons_vectors_match_reference_model_and_bind_runtime_evidence(self):
        vectors = self.pons_vectors
        runtime = self.pons_runtime_evidence
        self.assertEqual(vectors["baselineId"], runtime["baselineId"])
        self.assertEqual(vectors["executionSpecId"], runtime["executionSpecId"])
        self.assertEqual(runtime["status"], "APPROVED_RUNTIME_VECTORS")
        self.assertEqual(
            vectors["reference"]["runtimeKeccak256"],
            runtime["factory"]["runtimeKeccak256"],
        )
        self.assertTrue(vectors["differencePolicy"]["requireExplicitDifferenceId"])
        self.assertEqual(vectors["differencePolicy"]["registeredDifferenceIds"], [])
        self.assertEqual(len(vectors["vectors"]), 14)
        self.assertEqual(
            len({vector["id"] for vector in vectors["vectors"]}),
            len(vectors["vectors"]),
        )

        runtime_schedule = {
            entry["elapsedSeconds"]: entry
            for entry in runtime["antiSnipe"]["rawSchedule"]
        }

        def integers(values):
            return {
                key: int(value) if isinstance(value, str) and value.isdigit() else value
                for key, value in values.items()
            }

        for vector in vectors["vectors"]:
            inputs = integers(vector["inputs"])
            expected = integers(vector["outputs"])
            kind = vector["kind"]

            if kind == "supplyPartition":
                result = partition_supply(
                    inputs["supply"],
                    inputs["phantomQuote"],
                    inputs["graduationThreshold"],
                )
                actual = {
                    "reservedTokens": result.reserved,
                    "sellableTokens": result.sellable,
                }
            elif kind == "amountOut":
                actual = {
                    "amountOut": curve_amount_out(
                        inputs["amountIn"],
                        inputs["reserveIn"],
                        inputs["reserveOut"],
                        inputs["feeBps"],
                    )
                }
            elif kind == "buy":
                result = quote_curve_buy(
                    inputs["quoteReceived"],
                    inputs["quoteReserve"],
                    inputs["tokenReserve"],
                    inputs["reservedTokens"],
                    inputs["feeBps"],
                    inputs["additionalQuoteFeeBps"],
                    inputs["minTokensOut"],
                )
                actual = {
                    "netRequired": result.net_required,
                    "quoteSpent": result.quote_spent,
                    "fee": result.fee,
                    "additionalQuoteFee": result.additional_quote_fee,
                    "netQuote": result.net_quote,
                    "tokensOut": result.tokens_out,
                    "refund": result.refund,
                    "partialFill": result.partial_fill,
                    "slippagePass": result.slippage_pass,
                }
            elif kind == "sell":
                result = quote_curve_sell(
                    inputs["tokensIn"],
                    inputs["tokenReserve"],
                    inputs["quoteReserve"],
                    inputs["feeBps"],
                    inputs["additionalQuoteFeeBps"],
                    inputs["minQuoteOut"],
                )
                actual = {
                    "grossQuoteOut": result.gross_quote_out,
                    "fee": result.fee,
                    "additionalQuoteFee": result.additional_quote_fee,
                    "quoteOut": result.quote_out,
                }
            elif kind == "partialFillSlippage":
                actual = {
                    "slippagePass": product_lte(
                        inputs["quoteSpent"],
                        inputs["minTokensOut"],
                        inputs["quoteReceived"],
                        inputs["tokensOut"],
                    )
                }
            elif kind == "antiSnipeBuy":
                raw = current_snipe_tax_bps(
                    inputs["elapsedSeconds"], inputs["exempt"]
                )
                effective = effective_snipe_tax_bps(
                    raw,
                    inputs["feeBps"],
                    inputs["creatorTaxBps"],
                    inputs["minimumNetBps"],
                )
                result = quote_curve_buy(
                    inputs["quoteReceived"],
                    inputs["quoteReserve"],
                    inputs["tokenReserve"],
                    inputs["reservedTokens"],
                    inputs["feeBps"],
                    effective,
                    0,
                )
                actual = {
                    "rawSnipeBps": raw,
                    "effectiveSnipeBps": effective,
                    "fee": result.fee,
                    "snipeFee": result.additional_quote_fee,
                    "netQuote": result.net_quote,
                    "tokensOut": result.tokens_out,
                }
                observed = runtime_schedule[inputs["elapsedSeconds"]]
                observed_bps = (
                    observed["creatorRecipientBps"]
                    if inputs["exempt"]
                    else observed["ordinaryRecipientBps"]
                )
                self.assertEqual(raw, observed_bps, vector["id"])
            elif kind == "graduationPartition":
                result = partition_graduation_tokens(
                    inputs["sweptQuote"],
                    inputs["phantomQuote"],
                    inputs["sweptTokens"],
                )
                actual = {
                    "poolMemeAmount": result.pool_meme_amount,
                    "lockedExcessMeme": result.locked_excess_meme,
                }
            else:
                self.fail(f"unhandled Pons vector kind: {kind}")

            self.assertEqual(
                {key: actual[key] for key in expected},
                expected,
                vector["id"],
            )

        runtime_vectors = runtime["differentialVectors"]
        self.assertEqual(runtime["differentialVectorCount"], 14)
        self.assertEqual(len(runtime_vectors), runtime["differentialVectorCount"])
        self.assertEqual(len({vector["id"] for vector in runtime_vectors}), 14)

        for vector in runtime_vectors:
            self.assertIn(
                vector["provenance"]["type"],
                {
                    "FACTORY_STATE",
                    "RECEIPT_LOG",
                    "RECEIPT_LOG_REPLAY",
                    "PINNED_ETH_CALL_PAIR",
                    "PINNED_RUNTIME_OBSERVATION",
                },
            )
            inputs = integers(vector["inputs"])
            expected = integers(vector["outputs"])
            kind = vector["kind"]

            if kind == "supplyPartition":
                result = partition_supply(
                    inputs["supply"],
                    inputs["phantomQuote"],
                    inputs["graduationThreshold"],
                )
                actual = {
                    "reservedTokens": result.reserved,
                    "sellableTokens": result.sellable,
                }
            elif kind == "amountOut":
                actual = {
                    "amountOut": curve_amount_out(
                        inputs["amountIn"],
                        inputs["reserveIn"],
                        inputs["reserveOut"],
                        inputs["feeBps"],
                    )
                }
            elif kind == "buy":
                result = quote_curve_buy(
                    inputs["quoteReceived"],
                    inputs["quoteReserve"],
                    inputs["tokenReserve"],
                    inputs["reservedTokens"],
                    inputs["feeBps"],
                    inputs["additionalQuoteFeeBps"],
                    inputs["minTokensOut"],
                )
                actual = {
                    "netRequired": result.net_required,
                    "quoteSpent": result.quote_spent,
                    "fee": result.fee,
                    "additionalQuoteFee": result.additional_quote_fee,
                    "netQuote": result.net_quote,
                    "tokensOut": result.tokens_out,
                    "refund": result.refund,
                    "partialFill": result.partial_fill,
                    "slippagePass": result.slippage_pass,
                }
            elif kind == "sell":
                result = quote_curve_sell(
                    inputs["tokensIn"],
                    inputs["tokenReserve"],
                    inputs["quoteReserve"],
                    inputs["feeBps"],
                    inputs["additionalQuoteFeeBps"],
                    inputs["minQuoteOut"],
                )
                actual = {
                    "grossQuoteOut": result.gross_quote_out,
                    "fee": result.fee,
                    "additionalQuoteFee": result.additional_quote_fee,
                    "quoteOut": result.quote_out,
                }
            elif kind == "partialFillSlippage":
                actual = {
                    "slippagePass": product_lte(
                        inputs["quoteSpent"],
                        inputs["minTokensOut"],
                        inputs["quoteReceived"],
                        inputs["tokensOut"],
                    )
                }
                self.assertTrue(
                    vector["provenance"]["passingReturnData"].endswith(
                        f"{inputs['tokensOut']:064x}"
                    )
                )
                self.assertEqual(
                    vector["provenance"]["revertData"][:10], "0x71c4efed"
                )
            elif kind == "antiSnipeSchedule":
                raw = current_snipe_tax_bps(
                    inputs["elapsedSeconds"], inputs["exempt"]
                )
                actual = {"rawSnipeBps": raw}
                observed = runtime_schedule[
                    vector["provenance"]["observationIndex"]
                ]
                observed_bps = (
                    observed["creatorRecipientBps"]
                    if inputs["exempt"]
                    else observed["ordinaryRecipientBps"]
                )
                self.assertEqual(raw, observed_bps, vector["id"])
            elif kind == "graduationPartition":
                result = partition_graduation_tokens(
                    inputs["sweptQuote"],
                    inputs["phantomQuote"],
                    inputs["sweptTokens"],
                )
                actual = {
                    "poolMemeAmount": result.pool_meme_amount,
                    "lockedExcessMeme": result.locked_excess_meme,
                }
            else:
                self.fail(f"unhandled runtime differential kind: {kind}")

            self.assertEqual(
                {key: actual[key] for key in expected},
                expected,
                vector["id"],
            )

    def test_readiness_state_is_unique_derived_and_fail_closed(self):
        readiness = self.manifest["readiness"]
        states = [
            "SPEC_FROZEN_NOT_DEPLOYABLE",
            "IMPLEMENTATION_ALLOWED",
            "DEPLOYMENT_ELIGIBLE",
            "PRODUCTION_READY",
        ]
        self.assertEqual(readiness["stateOrder"], states)
        self.assertEqual(
            readiness["allowedTransitions"],
            [[states[index], states[index + 1]] for index in range(len(states) - 1)],
        )
        gate_sets = readiness["gateSets"]
        if gate_sets["implementation"]["open"]:
            derived = states[0]
        elif gate_sets["deployment"]["open"]:
            derived = states[1]
        elif gate_sets["production"]["open"]:
            derived = states[2]
        else:
            derived = states[3]
        self.assertEqual(derived, readiness["state"])
        self.assertEqual(self.manifest["status"], readiness["state"])
        index = states.index(derived)
        self.assertEqual(readiness["implementationAllowed"], index >= 1)
        self.assertEqual(readiness["deploymentEligible"], index >= 2)
        self.assertEqual(readiness["productionReady"], index == 3)
        self.assertNotIn("openProductionBlockers", self.manifest)

        all_gates = [
            gate
            for group in ("implementation", "deployment", "production")
            for gate in gate_sets[group]["open"]
        ]
        self.assertEqual(len(all_gates), len(set(all_gates)))
        implementation_open = set(gate_sets["implementation"]["open"])
        self.assertEqual(implementation_open, set())
        self.assertNotIn("V2-P-005", implementation_open)
        self.assertNotIn("V2-P-007", implementation_open)
        self.assertNotIn("V2-G0-PONS-RUNTIME-VECTORS-01", implementation_open)
        self.assertNotIn("V2-G0-PRODUCTION-QUOTES-01", implementation_open)
        self.assertNotIn("V2-G0-BATCH-01", implementation_open)
        self.assertIn("V2-DEPLOY-ABI-DIFF-01", gate_sets["deployment"]["open"])
        self.assertIn("V2-PROD-SOAK-72H-01", gate_sets["production"]["open"])
        for relative in ("README.md", "website/src/App.jsx", "V2_READINESS_AND_DEPLOYMENT_GATES.md"):
            surface = (PROJECT_ROOT / relative).read_text(encoding="utf-8")
            self.assertIn(readiness["state"], surface, relative)

    def test_production_placeholder_policy_is_scoped_and_fail_closed(self):
        policy = self.manifest["readiness"]["placeholderPolicy"]
        self.assertEqual(policy["scopeGlob"], "deployments/manifests/*.production.json")
        self.assertTrue(policy["failClosed"])
        rejected = set(policy["reject"])
        self.assertTrue(
            {
                "NULL",
                "EMPTY_STRING",
                "EMPTY_ARRAY",
                "ZERO_ADDRESS_OR_HASH_UNLESS_PATH_ALLOWLISTED",
                "REPEATED_OR_LOW_ENTROPY_ADDRESS_OR_HASH",
                "REFERENCE_FIXTURE_VALUE",
            }.issubset(rejected)
        )
        rules = policy["allowedZeroRules"]
        native = next(
            item for item in rules if item["pathPattern"] == "$.quoteAssets.*.tokenAddress"
        )
        self.assertEqual(native["requiresSibling"], {"field": "assetKind", "equals": "NATIVE"})
        self.assertEqual(
            {(item["file"], item["jsonPointer"]) for item in policy["referenceFixtureScopes"]},
            {
                ("spec/v2_hash_schemas.json", "/vectors"),
                ("spec/v2_pons_behavior_vectors.json", "/create2"),
            },
        )

    def test_emergency_external_abi_and_chain_computation_are_identical(self):
        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        controller = {
            entry["signature"]: entry for entry in modules["MarketController"]["functions"]
        }
        emergency = controller["activateEmergencyExit(bytes32)"]
        self.assertEqual(emergency["returns"], "(uint32,uint64,bytes32)")
        self.assertNotIn("activateEmergencyExit(bytes32,uint64,bytes32)", controller)

        canonical = {
            (entry["module"], entry["displaySignature"]): entry
            for entry in self.canonical_abi["mutations"]
        }
        self.assertEqual(
            canonical[("MarketController", "activateEmergencyExit(bytes32)")]["selector"],
            "0x9ec5b30d",
        )
        permission = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        external = permission[("MarketController", "activateEmergencyExit(bytes32)")]
        self.assertEqual(external["caller"], "RECOVERY_ROLE")
        self.assertEqual(external["delaySeconds"], 86400)
        self.assertEqual(external["stateDelaySeconds"], 86400)

        vault = {
            entry["signature"]: entry for entry in modules["ProtocolFeeVault"]["functions"]
        }
        self.assertEqual(
            vault["freezeRecoveryCaps(bytes32,uint32,uint64,bytes32)"]["caller"],
            "MARKET_CONTROLLER",
        )
        self.assertEqual(
            vault["freezeRecoveryCaps(bytes32,uint32,uint64,bytes32)"]["returns"],
            "(uint256,uint256)",
        )
        self.assertIn("recoverySnapshot(bytes32,uint32)", vault)
        self.assertIn(
            "RecoveryCapsFrozen(bytes32 indexed marketId,uint32 indexed recoveryEpoch,uint64 snapshotBlock,bytes32 stateHash,address quoteAsset,uint256 quoteCap,address memeAsset,uint256 memeCap)",
            modules["ProtocolFeeVault"]["events"],
        )
        self.assertEqual(
            self.manifest["recovery"]["externalArgumentsComputedOnChain"],
            ["recoveryEpoch", "snapshotBlock", "stateHash"],
        )
        self.assertEqual(
            self.manifest["recovery"]["atomicOrder"][-2],
            "COMMIT_REGISTRY_EMERGENCY_LAST",
        )
        hook_disable = permission[("TickerGardenMemeHook", "disablePool(bytes32)")]
        self.assertIn("BEFORE_REGISTRY_COMMIT", hook_disable["precondition"])

        execution = (PROJECT_ROOT / "V2_EXECUTION_SPEC.md").read_text(encoding="utf-8")
        section = execution.split("### 13.6", 1)[1].split("## 14", 1)[0]
        self.assertIn("activateEmergencyExit(bytes32 marketId)", section)
        self.assertNotIn("activateEmergencyExit(bytes32 marketId,", section)
        lifecycle = (PROJECT_ROOT / "V2_EMERGENCY_RECOVERY_LIFECYCLE.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("returns (uint32 recoveryEpoch, uint64 snapshotBlock, bytes32 stateHash)", lifecycle)

    def test_launch_fee_is_immutable_for_this_factory_and_spec(self):
        launch = self.manifest["launch"]
        self.assertEqual(int(launch["initialLaunchFeeRawNative"]), 500_000_000_000_000)
        self.assertEqual(
            launch["launchFeeMutability"], "IMMUTABLE_PER_FACTORY_AND_EXECUTION_SPEC"
        )
        self.assertEqual(
            launch["launchFeeChangePolicy"], "DEPLOY_NEW_FACTORY_AND_NEW_EXECUTION_SPEC_ID"
        )
        all_mutations = {
            entry["signature"]
            for module in self.abi["modules"]
            for entry in module.get("functions", [])
            if entry["mutability"] not in {"view", "pure"}
        }
        self.assertFalse(any("launchFee" in signature for signature in all_mutations))
        governance = self.g0_recommendations["recommendations"][
            "V2-G0-LAUNCH-FEE-GOVERNANCE-01"
        ]
        self.assertEqual(governance["status"], "APPROVED_IMMUTABLE_PER_FACTORY")
        self.assertFalse(governance["setterAllowed"])

    def test_graduation_entrypoints_event_owners_and_template_mode_are_unique(self):
        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        permission = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        graduation_functions = {
            entry["signature"]: entry for entry in modules["GraduationExecutor"]["functions"]
        }
        self.assertEqual(
            graduation_functions["graduateFromCurve(bytes32)"]["caller"],
            "EXACT_REGISTERED_CURVE",
        )
        self.assertIn(
            "Swept_AND_ACTIVE",
            permission[("GraduationExecutor", "retryGraduation(bytes32)")]["precondition"],
        )
        curve_events = set(modules["PonsCompatibleCurve"]["events"])
        executor_events = set(modules["GraduationExecutor"]["events"])
        self.assertTrue(any(event.startswith("LaunchSwept(") for event in curve_events))
        self.assertTrue(any(event.startswith("AutoGraduationFailed(") for event in curve_events))
        self.assertFalse(any(event.startswith("LaunchSwept(") for event in executor_events))
        self.assertFalse(any(event.startswith("AutoGraduationFailed(") for event in executor_events))
        self.assertTrue(any(event.startswith("PoolGraduated(") for event in executor_events))
        self.assertEqual(modules["LaunchAndBuyRouter"]["events"], [])
        self.assertTrue(any(event.startswith("CurveFeeTransferred(") for event in curve_events))
        self.assertFalse(any(event.startswith("CurveFeesSwept(") for event in curve_events))
        self.assertTrue(
            any(event.startswith("CurveFeesSwept(") for event in modules["ProtocolFeeVault"]["events"])
        )

        template = modules["LaunchTemplateRegistry"]["structs"]["LaunchTemplate"]
        self.assertIn("bytes32 launchLockerCodeHash", template)
        self.assertEqual(
            self.manifest["templateDeployment"]["componentKinds"],
            ["TOKEN", "CURVE", "GAUGE", "LOCKER"],
        )
        self.assertEqual(
            self.manifest["templateDeployment"]["launchLockerCustodyScope"],
            "ONE_IMMUTABLE_LOCKER_PER_MARKET",
        )
        factory = {
            entry["signature"]: entry for entry in modules["TickerGardenFactoryV2"]["functions"]
        }
        self.assertEqual(
            factory["predictMarketAddresses(address,CreateMarketParams)"]["returns"],
            "(bytes32,address,address,address,address)",
        )
        locker = {entry["signature"] for entry in modules["LaunchLocker"]["functions"]}
        self.assertIn("compoundLockedFees()", locker)
        self.assertNotIn("compoundLockedFees(bytes32)", locker)
        required_errors = set(self.abi["requiredErrors"])
        for error in (
            "InvalidLaunchFee(uint256,uint256)",
            "UnauthorizedMarketCurve(address,address)",
            "GraduationNotRetryable(bytes32,uint8,uint8)",
            "LaunchLockerAddressCollision(address)",
            "RecoveryCapsAlreadyFrozen(bytes32,uint32)",
            "RecoveryCapSnapshotMismatch(bytes32,uint32)",
            "EmergencyStateHashMismatch(bytes32,bytes32)",
        ):
            self.assertIn(error, required_errors)

    def test_fee_and_hook_constants(self):
        fee = self.manifest["postGraduationFee"]
        pool = self.manifest["canonicalPool"]
        self.assertEqual(fee["feePips"] * 100, fee["pipsDenominator"])
        self.assertEqual(fee["lpShareBps"] * 5, fee["bpsDenominator"])
        self.assertEqual(pool["poolKeyFee"], 0)
        self.assertEqual(pool["requiredSlot0LpFee"], 0)
        self.assertEqual(pool["requiredPackedProtocolFee"], 0)
        self.assertEqual(pool["hookPermissionMaskDecimal"], 0x2044)
        self.assertEqual(
            set(pool["hookPermissions"]),
            {"BEFORE_INITIALIZE", "AFTER_SWAP", "AFTER_SWAP_RETURNS_DELTA"},
        )

    def test_manifest_matches_vendored_uniswap_hook_flags(self):
        hooks_path = (
            PROJECT_ROOT
            / "contracts/lib/v4-periphery/lib/v4-core/src/libraries/Hooks.sol"
        )
        source = hooks_path.read_text(encoding="utf-8")
        expected = {
            "BEFORE_INITIALIZE_FLAG": 1 << 13,
            "AFTER_SWAP_FLAG": 1 << 6,
            "AFTER_SWAP_RETURNS_DELTA_FLAG": 1 << 2,
        }
        found = {}
        for name, value in expected.items():
            pattern = rf"{name}\s*=\s*1\s*<<\s*(\d+)"
            match = re.search(pattern, source)
            self.assertIsNotNone(match, name)
            found[name] = 1 << int(match.group(1))
            self.assertEqual(found[name], value)
        self.assertEqual(
            sum(found.values()),
            self.manifest["canonicalPool"]["hookPermissionMaskDecimal"],
        )

    def test_manifest_dependency_pins_match_contract_lock(self):
        with (PROJECT_ROOT / "contracts/dependencies.lock.json").open(encoding="utf-8") as handle:
            lock = json.load(handle)
        deps = lock["dependencies"]
        manifest_deps = self.manifest["dependencies"]
        self.assertEqual(deps["v4-core"]["commit"], manifest_deps["uniswapV4Core"]["commit"])
        self.assertEqual(
            deps["v4-periphery"]["commit"],
            manifest_deps["uniswapV4Periphery"]["commit"],
        )
        self.assertEqual(
            deps["openzeppelin-contracts"]["commit"],
            manifest_deps["openzeppelinContracts"]["commit"],
        )
        self.assertEqual(lock["toolchain"]["solcVersion"], manifest_deps["solidity"])
        self.assertEqual(lock["toolchain"]["evmVersion"], manifest_deps["evmVersion"])

    def test_integer_fee_partition_and_linear_staker_bucket_conserve(self):
        saturation = 10
        for base in range(0, 100_001):
            total_fee = base * 10_000 // 1_000_000
            lp_amount = total_fee * 2_000 // 10_000
            non_lp = total_fee - lp_amount
            self.assertEqual(lp_amount + non_lp, total_fee)

            for active_stock in (0, 1, 2, 5, 9, 10, 11, INT128_MAX):
                effective = min(active_stock, saturation)
                staker = non_lp * effective // (2 * saturation)
                remaining = non_lp - staker
                creator = remaining // 2
                platform = remaining - creator
                self.assertEqual(creator + staker + platform, non_lp)
                self.assertEqual(
                    staker,
                    non_lp * min(active_stock, saturation) // (2 * saturation),
                )

    def test_activation_wheel_is_bounded_and_collision_safe(self):
        activation = self.manifest["activation"]
        self.assertGreater(activation["wheelSize"], activation["delaySeconds"])
        self.assertEqual(activation["scanCountPerWrite"], activation["wheelSize"])
        self.assertFalse(activation["historicalTimeScan"])
        self.assertEqual(activation["maxPendingPerUserMarket"], 1)

        size = activation["wheelSize"]
        delay = activation["delaySeconds"]
        for now in range(0, 200):
            live_generations = list(range(now + 1, now + delay + 1))
            slots = [generation % size for generation in live_generations]
            self.assertEqual(len(slots), len(set(slots)))

    def test_terminal_states_have_no_outgoing_transition(self):
        transitions = self.manifest["transitions"]
        for terminal in ("PoolCreated", "Rescued"):
            self.assertFalse(any(source == terminal for source, _ in transitions["LaunchPhase"]))
        self.assertFalse(
            any(source == "EMERGENCY_EXIT" for source, _ in transitions["MarketStatus"])
        )
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["AssetStatus"]))
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["QuoteStatus"]))
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["BaselineStatus"]))
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["LaunchTemplateStatus"]))

    def test_market_registry_is_the_only_canonical_market_authority(self):
        authority = self.manifest["stateAuthority"]
        self.assertEqual(authority["canonicalModule"], "MarketRegistryV2")
        self.assertEqual(authority["initialRuntime"]["sourceVersion"], 1)
        self.assertEqual(authority["initialRuntime"]["launchPhase"], "NotGraduated")
        self.assertEqual(authority["initialRuntime"]["marketStatus"], "ACTIVE")

        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        self.assertIn("MarketRegistryV2", modules)
        registry = modules["MarketRegistryV2"]
        self.assertEqual(
            set(registry["structs"]["MarketRuntime"]),
            {
                "bytes32 poolId",
                "uint32 sourceVersion",
                "uint32 recoveryEpoch",
                "uint64 sweptAt",
                "uint64 statusSince",
                "uint64 restrictedSince",
                "uint8 launchPhase",
                "uint8 marketStatus",
            },
        )
        self.assertNotIn("MarketView", modules["TickerGardenFactoryV2"].get("structs", {}))
        factory_functions = {
            item["signature"] for item in modules["TickerGardenFactoryV2"]["functions"]
        }
        self.assertNotIn("market(bytes32)", factory_functions)
        self.assertNotIn("marketIdByToken(address)", factory_functions)

    def test_market_registry_mutations_match_exact_state_graph(self):
        authority = self.manifest["stateAuthority"]
        mutations = {entry["function"]: entry for entry in authority["mutations"]}
        self.assertEqual(
            set(mutations),
            {
                "registerMarket(bytes32,MarketConfig)",
                "markSwept(bytes32)",
                "commitPoolCreated(bytes32,bytes32)",
                "markRescued(bytes32)",
                "setMarketPaused(bytes32,bytes32)",
                "setMarketActive(bytes32)",
                "setMarketRetired(bytes32,bytes32)",
                "commitEmergencyExit(bytes32,uint64,bytes32)",
            },
        )
        launch_edges = {
            tuple(entry["transition"])
            for entry in authority["mutations"]
            if "transition" in entry
            and entry["transition"][0] in self.manifest["states"]["LaunchPhase"]
        }
        self.assertEqual(launch_edges, {tuple(edge) for edge in self.manifest["transitions"]["LaunchPhase"]})

        market_edges = set()
        for entry in authority["mutations"]:
            candidates = entry.get("transitions", [entry["transition"]] if "transition" in entry else [])
            for edge in candidates:
                if edge[0] in self.manifest["states"]["MarketStatus"]:
                    market_edges.add(tuple(edge))
        self.assertEqual(market_edges, {tuple(edge) for edge in self.manifest["transitions"]["MarketStatus"]})
        self.assertEqual(mutations["markRescued(bytes32)"]["minimumDelaySecondsFromSweptAt"], 604800)

    def test_market_registry_has_no_generic_or_governance_write_path(self):
        authority = self.manifest["stateAuthority"]
        forbidden = set(authority["forbidden"])
        self.assertIn("GENERIC_MARKET_SETTER", forbidden)
        self.assertIn("ARBITRARY_FEE_SOURCE_SETTER", forbidden)
        self.assertIn("GOVERNANCE_DIRECT_REGISTRY_MUTATION", forbidden)
        for entry in authority["mutations"]:
            self.assertNotIn(entry["caller"], {"PROTOCOL_ADMIN_ROLE", "PAUSE_GUARDIAN_ROLE", "RECOVERY_ROLE"})

        permission_rows = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        for entry in authority["mutations"]:
            self.assertIn(("MarketRegistryV2", entry["function"]), permission_rows)

    def test_sensitive_permissions_have_required_delays(self):
        rows = {(row["module"], row["signature"]): row for row in self.permissions["functions"]}
        self.assertEqual(rows[("MarketController", "pauseMarket(bytes32,bytes32)")]["delaySeconds"], 0)
        self.assertEqual(rows[("MarketController", "unpauseMarket(bytes32)")]["delaySeconds"], 86400)
        self.assertEqual(rows[("MarketController", "retireMarket(bytes32,bytes32)")]["delaySeconds"], 172800)
        self.assertEqual(
            rows[("MarketController", "activateEmergencyExit(bytes32)")]["delaySeconds"],
            86400,
        )
        self.assertEqual(
            rows[("ProtocolFeeVault", "proposeRecoveryRoot(bytes32,uint32,address,bytes32,uint256)")]["delaySeconds"],
            86400,
        )

    def test_no_duplicate_mutating_abi_signatures_per_module(self):
        for module in self.abi["modules"]:
            signatures = [entry["signature"] for entry in module.get("functions", [])]
            self.assertEqual(len(signatures), len(set(signatures)), module["module"])

    def test_every_mutating_abi_function_has_permission_row(self):
        permission_rows = {
            (entry["module"], entry["signature"])
            for entry in self.permissions["functions"]
        }
        missing = []
        for module in self.abi["modules"]:
            for entry in module.get("functions", []):
                if entry["mutability"] in {"view", "pure"}:
                    continue
                key = (module["module"], entry["signature"])
                if key not in permission_rows:
                    missing.append(key)
        self.assertEqual(missing, [])

    def test_canonical_abi_is_reproducible(self):
        generated = subprocess.run(
            ["python3", str(ROOT / "generate_v2_canonical_abi.py")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        self.assertEqual(json.loads(generated), self.canonical_abi)
        for row in self.canonical_abi["mutations"]:
            self.assertRegex(row["selector"], r"^0x[0-9a-f]{8}$")
        by_module = {}
        for row in self.canonical_abi["mutations"]:
            by_module.setdefault(row["module"], []).append(row["selector"])
        for module, selectors in by_module.items():
            self.assertEqual(len(selectors), len(set(selectors)), module)
        self.assertEqual(
            len(self.canonical_abi["events"]),
            sum(len(module.get("events", [])) for module in self.abi["modules"]),
        )
        event_topics = {}
        for row in self.canonical_abi["events"]:
            self.assertRegex(row["topic0"], r"^0x[0-9a-f]{64}$")
            key = (row["module"], row["canonicalSignature"])
            self.assertNotIn(key, event_topics)
            event_topics[key] = row["topic0"]

    def test_solidity_mutation_draft_is_reproducible(self):
        generated = subprocess.run(
            ["python3", str(ROOT / "generate_v2_solidity_draft.py")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        committed = (ROOT / "interfaces/IV2MutationSurfaceDraft.sol").read_text(
            encoding="utf-8"
        )
        self.assertEqual(generated, committed)

    def test_compiled_solidity_interfaces_are_reproducible_and_complete(self):
        generated = subprocess.run(
            ["python3", str(ROOT / "generate_v2_interfaces.py")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        committed = (
            PROJECT_ROOT / "contracts/src/v2/interfaces/IV2Protocol.sol"
        ).read_text(encoding="utf-8")
        self.assertEqual(generated, committed)
        for module in self.abi["modules"]:
            self.assertIn(f"interface I{module['module']} {{", committed)
            for event in module.get("events", []):
                self.assertIn(f"event {event[:event.index('(')]}(", committed)
            for function in module.get("functions", []):
                self.assertIn(f"function {function['signature'][:function['signature'].index('(')]}(", committed)
        for required_error in self.abi["requiredErrors"]:
            self.assertIn(f"error {required_error[:required_error.index('(')]}(", committed)

    def test_mutation_caller_and_delay_schema_are_exact(self):
        permission_rows = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        canonical_rows = {
            (entry["module"], entry["displaySignature"]): entry
            for entry in self.canonical_abi["mutations"]
        }
        allowed_callers = {
            "PUBLIC",
            "PROTOCOL_ADMIN_ROLE",
            "PAUSE_GUARDIAN_ROLE",
            "UNPAUSE_ROLE",
            "RECOVERY_ROLE",
            "FACTORY_MODULE",
            "LAUNCH_ROUTER_MODULE",
            "GRADUATION_MODULE",
            "ALLOCATION_MODULE",
            "POOL_MANAGER",
            "ACTIVE_FEE_SOURCE",
            "EXACT_REGISTERED_CURVE",
            "MARKET_CONTROLLER",
            "ALLOCATION_MODULE_OR_FEE_VAULT",
            "FEE_VAULT",
            "CURRENT_CREATOR_BENEFICIARY",
        }
        for module in self.abi["modules"]:
            for function in module.get("functions", []):
                if function["mutability"] in {"view", "pure"}:
                    continue
                key = (module["module"], function["signature"])
                permission = permission_rows[key]
                canonical = canonical_rows[key]
                self.assertEqual(function["caller"], permission["caller"], key)
                self.assertEqual(canonical["caller"], permission["caller"], key)
                self.assertEqual(canonical["executionDelaySeconds"], permission["delaySeconds"], key)
                self.assertEqual(canonical["stateDelaySeconds"], permission.get("stateDelaySeconds", 0), key)
                self.assertEqual(canonical["precondition"], permission.get("precondition", "NONE"), key)
                self.assertIn(canonical["caller"], allowed_callers, key)
                self.assertNotIn("_DELAYED", canonical["caller"])
                self.assertNotIn("SELF_ONLY", canonical["caller"])

    def test_rescue_uses_state_delay_not_access_delay(self):
        rows = {
            (entry["module"], entry["displaySignature"]): entry
            for entry in self.canonical_abi["mutations"]
        }
        for key in (
            ("GraduationExecutor", "rescueSweptLaunch(bytes32)"),
            ("MarketRegistryV2", "markRescued(bytes32)"),
        ):
            row = rows[key]
            self.assertEqual(row["executionDelaySeconds"], 0)
            self.assertEqual(row["stateDelaySeconds"], 604800)
            self.assertEqual(row["stateDelayAnchor"], "MARKET_RUNTIME_SWEPT_AT")
            self.assertIn("SWEPT_AT_PLUS_604800", row["precondition"])

    def test_struct_aliases_expand_to_canonical_tuples(self):
        rows = {
            (entry["module"], entry["displaySignature"]): entry
            for entry in self.canonical_abi["mutations"]
        }
        quote = rows[("ApprovedQuoteRegistry", "addQuoteConfig(bytes32,QuoteAssetConfig)")]
        self.assertEqual(
            quote["canonicalSignature"],
            "addQuoteConfig(bytes32,(bytes32,address,uint8,uint256,uint256,bytes32,uint8))",
        )
        factory = rows[("TickerGardenFactoryV2", "createMarket(CreateMarketParams)")]
        self.assertNotIn("CreateMarketParams", factory["canonicalSignature"])
        pool = rows[("TickerGardenMemeHook", "registerExpectedPool(bytes32,PoolKey,uint32)")]
        self.assertEqual(
            pool["canonicalSignature"],
            "registerExpectedPool(bytes32,(address,address,uint24,int24,address),uint32)",
        )

    def test_composed_calls_preserve_outer_identity(self):
        rows = {
            (entry["module"], entry["displaySignature"]): entry
            for entry in self.canonical_abi["mutations"]
        }
        create_for = rows[
            ("TickerGardenFactoryV2", "createMarketFor(address,CreateMarketParams)")
        ]
        self.assertEqual(create_for["caller"], "LAUNCH_ROUTER_MODULE")
        self.assertEqual(
            create_for["precondition"], "CREATOR_EQUALS_ROUTER_OUTER_MSG_SENDER"
        )
        deposit_for = rows[
            ("UserStockVault", "depositStockFor(address,uint256)")
        ]
        self.assertEqual(deposit_for["caller"], "ALLOCATION_MODULE")
        self.assertEqual(deposit_for["recipient"], "fixed_user_internal_balance")
        self.assertIn("OUTER_MSG_SENDER", deposit_for["precondition"])
        all_signatures = {entry["displaySignature"] for entry in rows.values()}
        self.assertFalse(any("tx.origin" in signature for signature in all_signatures))
        self.assertNotIn("launchAndBuyFor(address,CreateMarketParams,uint256,uint256,address)", all_signatures)

    def test_creator_revenue_epoch_freezes_historical_attribution(self):
        policy = self.manifest["creatorRevenue"]
        self.assertEqual(policy["initialEpoch"], 1)
        self.assertEqual(policy["invalidEpoch"], 0)
        self.assertEqual(policy["curveBoundary"], "ATOMIC_SWEEP_OLD_EPOCH_BEFORE_INCREMENT")
        self.assertEqual(policy["curveAccruedRequiredAfterBoundary"], 0)
        self.assertEqual(
            policy["creatorLiabilityKey"], ["marketId", "creatorEpoch", "feeAsset"]
        )
        self.assertFalse(policy["administratorOverride"])
        self.assertFalse(policy["arbitraryClaimRecipient"])

        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        creator_functions = {
            entry["signature"] for entry in modules["CreatorRevenueRegistry"]["functions"]
        }
        self.assertIn("initializeCreatorRevenueEpoch(bytes32,address)", creator_functions)
        self.assertIn("currentCreatorEpoch(bytes32)", creator_functions)
        self.assertIn("creatorBeneficiaryAt(bytes32,uint32)", creator_functions)

        vault_functions = {
            entry["signature"] for entry in modules["ProtocolFeeVault"]["functions"]
        }
        self.assertIn("claimCreator(bytes32,uint32,address)", vault_functions)
        self.assertIn("creatorLiability(bytes32,uint32,address)", vault_functions)
        self.assertNotIn("claimCreator(bytes32,address)", vault_functions)

        permissions = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        transfer = permissions[
            ("CreatorRevenueRegistry", "transferCreatorRevenueBeneficiary(bytes32,address)")
        ]
        self.assertEqual(transfer["caller"], "CURRENT_CREATOR_BENEFICIARY")
        self.assertIn("ATOMIC_OLD_EPOCH_SWEEP", transfer["precondition"])
        claim = permissions[
            ("ProtocolFeeVault", "claimCreator(bytes32,uint32,address)")
        ]
        self.assertEqual(claim["recipient"], "stored_creator_epoch_beneficiary")

    def test_emergency_recovery_requires_finalized_root(self):
        recovery = self.manifest["recovery"]
        self.assertEqual(recovery["snapshotBlockRule"], "EMERGENCY_ACTIVATION_BLOCK_MINUS_ONE")
        self.assertEqual(recovery["rootChallengeSeconds"], 172800)
        self.assertEqual(recovery["rootFinalization"], "PERMISSIONLESS_AFTER_CHALLENGE")
        self.assertFalse(recovery["activeRootMutable"])
        self.assertEqual(recovery["leafEncoding"], "DOUBLE_KECCAK256_ABI_ENCODE")
        self.assertEqual(recovery["nodeHashing"], "COMMUTATIVE_SORTED_PAIR_KECCAK256")

        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        vault_functions = {
            entry["signature"] for entry in modules["ProtocolFeeVault"]["functions"]
        }
        self.assertNotIn(
            "publishRecoveryRoot(bytes32,uint32,address,bytes32,uint256)", vault_functions
        )
        self.assertIn(
            "proposeRecoveryRoot(bytes32,uint32,address,bytes32,uint256)", vault_functions
        )
        self.assertIn(
            "cancelRecoveryRoot(bytes32,uint32,address,uint32)", vault_functions
        )
        self.assertIn(
            "finalizeRecoveryRoot(bytes32,uint32,address,uint32)", vault_functions
        )
        permissions = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        finalize = permissions[
            ("ProtocolFeeVault", "finalizeRecoveryRoot(bytes32,uint32,address,uint32)")
        ]
        self.assertEqual(finalize["caller"], "PUBLIC")
        self.assertEqual(finalize["stateDelaySeconds"], 172800)
        self.assertEqual(finalize["stateDelayAnchor"], "RECOVERY_ROOT_PROPOSED_AT")

    def test_typed_hash_schemas_are_reproducible_and_domain_separated(self):
        generated = subprocess.run(
            ["python3", str(ROOT / "generate_v2_hash_vectors.py")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        self.assertEqual(json.loads(generated), self.hash_schemas)
        schemas = self.hash_schemas["schemas"]
        expected_names = {
            "launchTemplateHash",
            "ponsBaselineHash",
            "expectedEconomics",
            "marketId",
            "componentSalt",
            "feePolicyHash",
            "v4FeeId",
            "curveFeeId",
            "emergencyStateHash",
            "recoveryLeafInner",
            "quoteEconomicsHash",
        }
        self.assertEqual(set(schemas), expected_names)
        domains = [entry["domain"] for entry in schemas.values()]
        self.assertEqual(len(domains), len(set(domains)))
        for schema in schemas.values():
            self.assertEqual(schema["fields"][0:2], ["bytes32 domain", "uint256 schemaVersion"])
        vectors = {entry["schema"]: entry for entry in self.hash_schemas["vectors"]}
        self.assertEqual(set(vectors), expected_names)
        self.assertTrue(all(len(entry["result"]) == 66 for entry in vectors.values()))
        self.assertNotEqual(
            vectors["recoveryLeafInner"]["innerHash"],
            vectors["recoveryLeafInner"]["result"],
        )
        self.assertEqual(vectors["expectedEconomics"]["inputs"]["schemaVersion"], "2")
        self.assertEqual(vectors["ponsBaselineHash"]["inputs"]["schemaVersion"], "1")
        self.assertEqual(vectors["feePolicyHash"]["inputs"]["schemaVersion"], "2")
        self.assertEqual(vectors["quoteEconomicsHash"]["inputs"]["schemaVersion"], "1")

        template_fields = self.hash_schemas["schemas"]["launchTemplateHash"]["fields"]
        self.assertEqual(
            template_fields,
            [
                "bytes32 domain",
                "uint256 schemaVersion",
                "address memeTokenImplementation",
                "bytes32 memeTokenCodeHash",
                "address curveImplementation",
                "bytes32 curveCodeHash",
                "address gaugeImplementation",
                "bytes32 gaugeCodeHash",
                "address graduatedHook",
                "bytes32 hookCodeHash",
                "address graduationExecutor",
                "address launchLockerImplementation",
                "bytes32 launchLockerCodeHash",
                "bytes32 feePolicyId",
                "bytes32 executionSpecId",
            ],
        )
        self.assertEqual(
            self.hash_schemas["schemas"]["ponsBaselineHash"]["fields"],
            [
                "bytes32 domain",
                "uint256 schemaVersion",
                "uint256 referenceChainId",
                "address referenceFactory",
                "bytes32 referenceFactoryCodeHash",
                "uint256 launchConfigId",
                "uint256 supply",
                "uint256 curveFeeBps",
                "uint24 poolFee",
                "int24 tickSpacing",
                "bytes32 behaviorVectorRoot",
            ],
        )
    def test_expected_economics_has_no_self_reference_or_mutable_identity(self):
        fields = {
            declaration.split(" ", 1)[1]
            for declaration in self.hash_schemas["schemas"]["expectedEconomics"]["fields"]
        }
        forbidden = set(self.hash_schemas["forbiddenFieldsInExpectedEconomics"])
        self.assertTrue(fields.isdisjoint(forbidden))
        market_fields = {
            declaration.split(" ", 1)[1]
            for declaration in self.hash_schemas["schemas"]["marketId"]["fields"]
        }
        for required in (
            "chainId",
            "factory",
            "creator",
            "creatorRevenueBeneficiaryAtCreation",
            "creatorSalt",
            "expectedEconomics",
            "nameHash",
            "symbolHash",
            "metadataUriHash",
        ):
            self.assertIn(required, market_fields)

    def test_market_registry_exposes_canonical_pool_discovery(self):
        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        registry_functions = {
            entry["signature"] for entry in modules["MarketRegistryV2"]["functions"]
        }
        self.assertIn("canonicalPoolKey(bytes32)", registry_functions)
        self.assertIn("canonicalPoolId(bytes32)", registry_functions)
        self.assertIn("marketIdByToken(address)", registry_functions)
        self.assertIn("activeFeeSource(bytes32)", registry_functions)
        template_functions = {
            entry["signature"] for entry in modules["LaunchTemplateRegistry"]["functions"]
        }
        self.assertIn("addLaunchTemplate(bytes32,LaunchTemplate)", template_functions)
        self.assertIn("launchTemplateHash(bytes32)", template_functions)

        v4_fields = [
            declaration.split(" ", 1)[1]
            for declaration in self.hash_schemas["schemas"]["v4FeeId"]["fields"]
        ]
        self.assertEqual(self.manifest["feeIdentity"]["fields"], v4_fields)

    def test_migration_and_timing_have_one_execution_order(self):
        timing = self.manifest["migrationAndTiming"]
        self.assertEqual(timing["migrationAmount"], "EXACT_SAME_RAW_STOCK_AMOUNT")
        self.assertEqual(timing["migrationScope"], "SAME_USER_SAME_ASSET_UID_SAME_VAULT")
        self.assertEqual(
            timing["sourceOrder"], "CHECKPOINT_SETTLE_MATERIALIZE_THEN_REMOVE_ACTIVE"
        )
        self.assertEqual(
            timing["targetOrder"], "CHECKPOINT_SETTLE_THEN_ADD_OR_MERGE_PENDING"
        )
        self.assertFalse(timing["overlappingRewardWeight"])
        self.assertEqual(timing["targetActivationDelaySeconds"], 30)
        self.assertEqual(timing["targetWholePositionLockResetSeconds"], 86400)
        self.assertFalse(timing["sourceUnlockReset"])
        self.assertEqual(timing["rescueDelaySeconds"], 604800)
        self.assertEqual(timing["emergencyDelayAnchor"], "restrictedSince")
        self.assertIn("PRESERVE_PAUSED_TO_RETIRED", timing["restrictedSinceRule"])

        permissions = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        migration = permissions[
            ("AllocationManager", "migrateAllocation(bytes32,bytes32,uint256)")
        ]
        self.assertIn("EXACT_AMOUNT_NO_OVERLAP", migration["precondition"])
        emergency = permissions[("MarketController", "activateEmergencyExit(bytes32)")]
        self.assertEqual(
            emergency["stateDelayAnchor"], "MARKET_RUNTIME_RESTRICTED_SINCE"
        )
        rescue = permissions[("GraduationExecutor", "rescueSweptLaunch(bytes32)")]
        self.assertEqual(rescue["stateDelayAnchor"], "MARKET_RUNTIME_SWEPT_AT")
        self.assertIn("ANY_MARKET_STATUS", rescue["precondition"])

    def test_no_arbitrary_recipient_surface(self):
        self.assertFalse(self.abi["policy"]["arbitraryRecipientAllowed"])
        forbidden = set(self.permissions["forbiddenCapabilities"])
        self.assertIn("ARBITRARY_RECIPIENT_CLAIM", forbidden)
        self.assertIn("ARBITRARY_RECIPIENT_WITHDRAW", forbidden)
        for module in self.abi["modules"]:
            for entry in module.get("functions", []):
                signature = entry["signature"]
                self.assertNotIn("claimTo(", signature)
                self.assertNotIn("withdrawTo(", signature)

    def test_external_g0_evidence_is_fixed_block_and_not_silently_approved(self):
        evidence = self.external_evidence
        self.assertEqual(evidence["status"], "OBSERVED_NOT_APPROVED")
        self.assertEqual(evidence["chain"]["chainId"], 4663)
        self.assertEqual(evidence["chain"]["snapshotBlock"], 52289586)
        self.assertRegex(evidence["chain"]["snapshotBlockHash"], r"^0x[0-9a-f]{64}$")

        candidates = evidence["factoryCandidates"]
        self.assertEqual(len(candidates), 2)
        self.assertNotEqual(candidates[0]["address"], candidates[1]["address"])
        self.assertNotEqual(
            candidates[0]["runtimeKeccak256"], candidates[1]["runtimeKeccak256"]
        )
        self.assertNotEqual(
            candidates[0]["launchEnabled"], candidates[1]["launchEnabled"]
        )
        self.assertTrue(all(candidate["usdG"]["approvedPairToken"] for candidate in candidates))
        self.assertTrue(all(candidate["usdG"]["expectedDecimals"] == 6 for candidate in candidates))

        quote = evidence["quoteAssetEvidence"]
        self.assertEqual(quote["officialRobinhoodStablecoin"]["symbol"], "USDG")
        self.assertFalse(quote["officialUsdcListed"])
        self.assertEqual(quote["classification"], "BLOCKING_PRODUCT_SOURCE_CONFLICT")
        self.assertTrue(all(gate["status"] == "BLOCKED" for gate in evidence["gates"].values()))

    def test_reference_supply_partition_matches_observed_quote_ratios(self):
        supply = 10**27
        expected_reserved = 285714285714285714285714285
        expected_sellable = 714285714285714285714285715
        for phantom, threshold in (
            (1_680_000_000_000_000_000, 4_200_000_000_000_000_000),
            (3_236_000_000, 8_090_000_000),
        ):
            partition = partition_supply(supply, phantom, threshold)
            self.assertEqual(partition.reserved, expected_reserved)
            self.assertEqual(partition.sellable, expected_sellable)
            self.assertEqual(partition.reserved + partition.sellable, supply)

    def test_pons_behavior_vectors_match_independent_integer_model(self):
        for vector in self.pons_vectors["vectors"]:
            inputs = {key: int(value) for key, value in vector["inputs"].items()}
            outputs = vector["outputs"]
            kind = vector["kind"]
            if kind == "supplyPartition":
                result = partition_supply(
                    inputs["supply"],
                    inputs["phantomQuote"],
                    inputs["graduationThreshold"],
                )
                self.assertEqual(result.reserved, int(outputs["reservedTokens"]))
                self.assertEqual(result.sellable, int(outputs["sellableTokens"]))
            elif kind == "amountOut":
                self.assertEqual(
                    curve_amount_out(
                        inputs["amountIn"],
                        inputs["reserveIn"],
                        inputs["reserveOut"],
                        inputs["feeBps"],
                    ),
                    int(outputs["amountOut"]),
                )
            elif kind == "buy":
                result = quote_curve_buy(
                    inputs["quoteReceived"],
                    inputs["quoteReserve"],
                    inputs["tokenReserve"],
                    inputs["reservedTokens"],
                    inputs["feeBps"],
                    inputs["additionalQuoteFeeBps"],
                    inputs["minTokensOut"],
                )
                self.assertEqual(result.quote_spent, int(outputs["quoteSpent"]))
                self.assertEqual(result.fee, int(outputs["fee"]))
                self.assertEqual(
                    result.additional_quote_fee,
                    int(outputs["additionalQuoteFee"]),
                )
                self.assertEqual(result.tokens_out, int(outputs["tokensOut"]))
                self.assertEqual(result.refund, int(outputs["refund"]))
                self.assertEqual(result.partial_fill, outputs["partialFill"])
                if "netQuote" in outputs:
                    self.assertEqual(result.net_quote, int(outputs["netQuote"]))
                if "netRequired" in outputs:
                    self.assertEqual(result.net_required, int(outputs["netRequired"]))
                if "slippagePass" in outputs:
                    self.assertEqual(result.slippage_pass, outputs["slippagePass"])
            elif kind == "sell":
                result = quote_curve_sell(
                    inputs["tokensIn"],
                    inputs["tokenReserve"],
                    inputs["quoteReserve"],
                    inputs["feeBps"],
                    inputs["additionalQuoteFeeBps"],
                    inputs["minQuoteOut"],
                )
                self.assertEqual(result.gross_quote_out, int(outputs["grossQuoteOut"]))
                self.assertEqual(result.fee, int(outputs["fee"]))
                self.assertEqual(
                    result.additional_quote_fee,
                    int(outputs["additionalQuoteFee"]),
                )
                self.assertEqual(result.quote_out, int(outputs["quoteOut"]))
            elif kind == "partialFillSlippage":
                self.assertEqual(
                    product_lte(
                        inputs["quoteSpent"],
                        inputs["minTokensOut"],
                        inputs["quoteReceived"],
                        inputs["tokensOut"],
                    ),
                    outputs["slippagePass"],
                )
            elif kind == "antiSnipeBuy":
                raw_snipe_bps = current_snipe_tax_bps(
                    inputs["elapsedSeconds"], bool(inputs["exempt"])
                )
                effective_snipe_bps = effective_snipe_tax_bps(
                    raw_snipe_bps,
                    inputs["feeBps"],
                    inputs["creatorTaxBps"],
                    inputs["minimumNetBps"],
                )
                result = quote_curve_buy(
                    inputs["quoteReceived"],
                    inputs["quoteReserve"],
                    inputs["tokenReserve"],
                    inputs["reservedTokens"],
                    inputs["feeBps"],
                    effective_snipe_bps,
                )
                self.assertEqual(raw_snipe_bps, outputs["rawSnipeBps"])
                self.assertEqual(
                    effective_snipe_bps, outputs["effectiveSnipeBps"]
                )
                self.assertEqual(result.fee, int(outputs["fee"]))
                self.assertEqual(
                    result.additional_quote_fee, int(outputs["snipeFee"])
                )
                self.assertEqual(result.net_quote, int(outputs["netQuote"]))
                self.assertEqual(result.tokens_out, int(outputs["tokensOut"]))
            elif kind == "graduationPartition":
                result = partition_graduation_tokens(
                    inputs["sweptQuote"],
                    inputs["phantomQuote"],
                    inputs["sweptTokens"],
                )
                self.assertEqual(
                    result.pool_meme_amount, int(outputs["poolMemeAmount"])
                )
                self.assertEqual(
                    result.locked_excess_meme,
                    int(outputs["lockedExcessMeme"]),
                )
            else:
                self.fail(f"unhandled Pons vector kind: {kind}")

    def test_runtime_evidence_fixes_anti_snipe_and_full_graduation_outputs(self):
        evidence = self.pons_runtime_evidence
        self.assertEqual(evidence["status"], "APPROVED_RUNTIME_VECTORS")
        self.assertEqual(evidence["executionSpecId"], "V2-EXEC-3")
        self.assertEqual(
            evidence["factory"]["runtimeKeccak256"],
            self.pons_vectors["reference"]["runtimeKeccak256"],
        )

        mismatch = evidence["sourceMismatch"]
        self.assertEqual(
            (
                mismatch["ponsDocsObservedWindowSeconds"],
                mismatch["ponsRepositorySourceDefaultWindowSeconds"],
                mismatch["activeRuntimeWindowSeconds"],
            ),
            (5, 15, 3),
        )
        self.assertIn("DO_NOT_INFER", mismatch["decision"])

        anti_snipe = evidence["antiSnipe"]
        self.assertEqual(
            anti_snipe["automaticExemptions"],
            self.manifest["launch"]["antiSnipe"]["automaticExemptions"],
        )
        self.assertEqual(
            anti_snipe["automaticExemptions"],
            self.g0_recommendations["recommendations"]["V2-G0-ANTI-SNIPE-01"][
                "automaticExemptions"
            ],
        )
        observed = [
            entry["ordinaryRecipientBps"] for entry in anti_snipe["rawSchedule"]
        ]
        self.assertEqual(observed, [9900, 618, 19, 0])
        self.assertEqual(
            [
                current_snipe_tax_bps(entry["elapsedSeconds"])
                for entry in anti_snipe["rawSchedule"]
            ],
            observed,
        )
        self.assertEqual(
            [
                effective_snipe_tax_bps(
                    raw,
                    anti_snipe["feeBps"],
                    anti_snipe["creatorTaxBpsObserved"],
                    anti_snipe["minimumNetBps"],
                )
                for raw in observed
            ],
            anti_snipe["tickerGardenEffectiveScheduleBps"],
        )
        self.assertEqual(current_snipe_tax_bps(0, exempt=True), 0)

        traces = evidence["graduationTraces"]
        self.assertEqual({trace["quoteKind"] for trace in traces}, {"NATIVE", "ERC20"})
        for trace in traces:
            sweep = trace["sweep"]
            pool = trace["poolCreation"]
            partition = partition_graduation_tokens(
                int(sweep["sweptQuote"]),
                int(trace["phantomQuote"]),
                int(sweep["sweptTokens"]),
            )
            self.assertEqual(partition.pool_meme_amount, int(pool["poolMemeAmount"]))
            self.assertEqual(
                partition.locked_excess_meme, int(pool["lockedExcessMeme"])
            )
            self.assertEqual(
                partition.pool_meme_amount + partition.locked_excess_meme,
                int(sweep["sweptTokens"]),
            )
            seed = graduation_seed(
                trace["token"],
                trace["quoteAsset"],
                trace["tickSpacing"],
                int(sweep["sweptQuote"]),
                partition.pool_meme_amount,
            )
            self.assertEqual(seed.quote_is_currency0, pool["quoteIsCurrency0"])
            self.assertEqual(seed.sqrt_price_x96, int(pool["sqrtPriceX96"]))
            self.assertEqual(seed.tick_lower, pool["tickLower"])
            self.assertEqual(seed.tick_upper, pool["tickUpper"])
            self.assertEqual(seed.liquidity, int(pool["liquidity"]))
            self.assertEqual(sweep["status"], 1)
            self.assertEqual(pool["status"], 1)
            self.assertEqual(sweep["resultingPhase"], "Swept")
            self.assertEqual(pool["resultingPhase"], "PoolCreated")
            self.assertLess(sweep["block"], pool["block"])
            self.assertNotEqual(pool["caller"], pool["creator"])

        exceptions = evidence["exceptionSemantics"]
        self.assertEqual(exceptions["retry"], "PERMISSIONLESS_FROM_Swept_ONLY")
        self.assertEqual(exceptions["rescueDelaySeconds"], 604800)

    def test_initial_quote_configs_are_content_addressed_and_fail_closed(self):
        artifact = self.initial_quote_configs
        self.assertEqual(artifact["status"], "APPROVED_INITIAL_RELEASE_CONFIGS")
        self.assertEqual(artifact["chainId"], 4663)
        self.assertEqual(artifact["scope"]["initialReleaseQuoteCount"], 2)
        configs = {entry["label"]: entry for entry in artifact["configs"]}
        self.assertEqual(set(configs), {"NATIVE_ETH_V1", "USDG_V1"})

        ids = set()
        for config in configs.values():
            expected_hash = quote_economics_hash(
                artifact["chainId"],
                artifact["ponsBaselineId"],
                config["quoteAsset"],
                config["quoteDecimals"],
                int(config["phantomQuote"]),
                int(config["graduationThreshold"]),
            )
            self.assertEqual(config["quoteAssetConfigId"], expected_hash)
            self.assertEqual(config["economicsHash"], expected_hash)
            self.assertRegex(config["ponsPreviewLaunchEconomics"], r"^0x[0-9a-f]{64}$")
            self.assertEqual(config["status"], "ACTIVE")
            ids.add(expected_hash)
        self.assertEqual(len(ids), 2)

        native = configs["NATIVE_ETH_V1"]
        self.assertEqual(native["quoteAsset"], "0x" + "00" * 20)
        self.assertEqual(native["quoteDecimals"], 18)
        self.assertFalse(native["assetReview"]["upgradeable"])

        usdg = configs["USDG_V1"]
        self.assertEqual(
            usdg["quoteAsset"], "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
        )
        self.assertEqual(usdg["quoteDecimals"], 6)
        self.assertEqual(int(usdg["phantomQuote"]), 3_236_000_000)
        self.assertEqual(int(usdg["graduationThreshold"]), 8_090_000_000)
        review = usdg["assetReview"]
        self.assertTrue(review["upgradeable"])
        self.assertTrue(review["exactBalanceDeltaRequired"])
        self.assertTrue(review["preDeploymentFingerprintRecaptureRequired"])
        self.assertFalse(review["feeOnTransferAccepted"])
        self.assertFalse(review["rebasingAccepted"])

    def test_official_stock_catalog_covers_the_dynamic_robinhood_universe(self):
        catalog = self.official_stock_catalog
        self.assertEqual(
            catalog["status"],
            "ELIGIBILITY_POLICY_APPROVED_IDENTITY_SNAPSHOT_OBSERVED",
        )
        self.assertEqual(catalog["chainId"], 4663)
        self.assertEqual(
            catalog["source"]["url"], "https://api.robinhood.com/rhj/assets"
        )
        policy = catalog["policy"]
        self.assertFalse(policy["runtimeHttpDependency"])
        self.assertFalse(policy["catalogCountIsProtocolCap"])
        self.assertTrue(policy["futureOfficialAssetsEligibleUnderSameRule"])
        self.assertTrue(policy["allActiveAssetsSelectableAsStakingBase"])
        self.assertEqual(policy["marketStakingBaseCardinality"], "EXACTLY_ONE_ASSET_UID")
        self.assertEqual(
            policy["stakingBaseSelectedBy"],
            "MARKET_CREATOR_AT_MARKET_CREATION",
        )
        self.assertTrue(policy["stakingBaseImmutableAfterCreation"])
        self.assertTrue(policy["sameStockMayBackUnlimitedMarkets"])
        self.assertFalse(policy["stockPriceRequired"])
        self.assertFalse(policy["stockPriceOracleDependency"])
        self.assertFalse(policy["priceFeedCoverageAffectsEligibility"])
        self.assertFalse(policy["backingTargetRequired"])
        self.assertEqual(
            policy["productionRegistration"],
            "PER_ASSET_TIMELOCKED_REGISTRY_CALLS_NO_BATCH_ABI",
        )

        assets = catalog["assets"]
        summary = catalog["summary"]
        self.assertEqual(len(assets), 194)
        self.assertEqual(summary["assetCount"], len(assets))
        self.assertEqual(summary["uniqueAssetUidCount"], len(assets))
        self.assertEqual(summary["uniqueTokenCount"], len(assets))
        self.assertEqual(summary["stockDecimalsCounts"], {"18": 194})
        self.assertEqual(
            summary["officialStatusCounts"], {"ASSET_STATUS_ACTIVE": 194}
        )
        self.assertTrue(catalog["source"]["rawResponseArchived"])
        self.assertEqual(catalog["source"]["rawResponseArchive"], "v2_rh_official_stock_catalog.source.json")
        self.assertEqual(
            "0x" + hashlib.sha256(self.official_stock_catalog_raw).hexdigest(),
            catalog["source"]["responseSha256"],
        )
        self.assertEqual(
            len(self.official_stock_catalog_raw), catalog["source"]["responseBytes"]
        )
        self.assertEqual(
            catalog["chainSnapshot"]["finality"],
            "OBSERVATION_NOT_PRODUCTION_FINALITY",
        )
        self.assertEqual(
            catalog["upgradeabilityEvidence"][
                "recognizedImmutableBeaconProxyCount"
            ],
            194,
        )
        self.assertTrue(summary["allImplementationFingerprintsPassed"])
        self.assertTrue(summary["allIdentityChecksPassed"])
        normalized = json.dumps(
            assets, sort_keys=True, separators=(",", ":")
        ).encode()
        self.assertEqual(
            summary["normalizedCatalogKeccak256"],
            "0x" + keccak256(normalized).hex(),
        )
        for asset in assets:
            self.assertRegex(asset["assetUid"], r"^0x[0-9a-f]{64}$")
            self.assertRegex(asset["stockToken"], r"^0x[0-9a-f]{40}$")
            self.assertRegex(asset["runtimeKeccak256"], r"^0x[0-9a-f]{64}$")
            self.assertEqual(asset["stockDecimals"], 18)
            self.assertEqual(asset["officialStatus"], "ASSET_STATUS_ACTIVE")
            self.assertTrue(asset["eligibleByOfficialIdentity"])
            self.assertTrue(asset["enabledForNewMarketsCandidate"])
            self.assertTrue(asset["onchainUidVerified"])
            self.assertTrue(asset["onchainDecimalsVerified"])
            self.assertTrue(asset["implementationFingerprintVerified"])
            self.assertRegex(asset["upgradeability"]["beacon"], r"^0x[0-9a-f]{40}$")
            self.assertRegex(asset["upgradeability"]["implementation"], r"^0x[0-9a-f]{40}$")

        manifest_policy = self.manifest["officialStockAdmission"]
        self.assertEqual(manifest_policy["observedAssetCount"], len(assets))
        self.assertFalse(manifest_policy["catalogCountIsProtocolCap"])
        self.assertTrue(manifest_policy["futureOfficialAssetsEligibleUnderSameRule"])
        self.assertTrue(manifest_policy["allObservedActiveAssetsSelectableAsStakingBase"])
        self.assertTrue(manifest_policy["sameStockMayBackUnlimitedMarkets"])
        self.assertEqual(
            manifest_policy["stakingBaseSelectedBy"],
            "MARKET_CREATOR_AT_MARKET_CREATION",
        )
        self.assertFalse(manifest_policy["stockPriceRequired"])
        self.assertFalse(manifest_policy["stockPriceOracleDependency"])
        self.assertFalse(manifest_policy["backingTargetRequired"])
        self.assertFalse(manifest_policy["priceFeedCoverageAffectsEligibility"])
        recommendation = self.g0_recommendations["recommendations"][
            "V2-G0-OFFICIAL-STOCK-BASE-01"
        ]
        self.assertEqual(
            recommendation["eligibilityStatus"],
            "APPROVED_ALL_ROBINHOOD_OFFICIAL_STOCK_TOKENS",
        )
        self.assertTrue(recommendation["allObservedActiveAssetsSelectableAsStakingBase"])
        self.assertTrue(recommendation["sameStockMayBackUnlimitedMarkets"])
        self.assertFalse(recommendation["stockPriceRequired"])
        self.assertFalse(recommendation["backingTargetRequired"])

    def test_stock_base_selection_is_price_free_and_abi_closed(self):
        modules = {module["module"]: module for module in self.abi["modules"]}
        active_machine_surface = json.dumps(
            {
                "abi": self.abi,
                "canonicalAbi": self.canonical_abi,
                "hashSchemas": self.hash_schemas,
                "permissions": self.permissions,
            },
            sort_keys=True,
        ).lower()
        for forbidden in (
            "backingtarget",
            "targetusd18",
            "stockprice",
            "pricefeed",
            "chainlink",
        ):
            self.assertNotIn(forbidden, active_machine_surface)

        registry = modules["OfficialStockRegistryV2"]
        registry_signatures = {
            function["signature"] for function in registry["functions"]
        }
        self.assertIn(
            "registerAsset(bytes32,address,uint8,address)", registry_signatures
        )
        self.assertFalse(
            any("backingtarget" in signature.lower() for signature in registry_signatures)
        )
        self.assertEqual(
            registry["structs"]["AssetView"],
            [
                "address stockToken",
                "address userStockVault",
                "uint8 tokenDecimals",
                "uint8 status",
            ],
        )
        self.assertEqual(
            registry["events"][0],
            "AssetRegistered(bytes32 indexed assetUid,address indexed stockToken,address indexed userStockVault,uint8 tokenDecimals)",
        )

        market_config = modules["MarketRegistryV2"]["structs"]["MarketConfig"]
        self.assertIn("bytes32 assetUid", market_config)
        self.assertIn("uint256 stakeSaturationAmount", market_config)
        create_params = modules["TickerGardenFactoryV2"]["structs"][
            "CreateMarketParams"
        ]
        self.assertFalse(
            any("stakeSaturation" in declaration for declaration in create_params)
        )
        self.assertFalse(
            any("backingTarget" in declaration for declaration in market_config)
        )
        economics_fields = self.hash_schemas["schemas"]["expectedEconomics"][
            "fields"
        ]
        self.assertIn("uint256 stakeSaturationAmount", economics_fields)
        self.assertFalse(
            any("backingTarget" in declaration for declaration in economics_fields)
        )

        fee_event = next(
            event
            for event in modules["ProtocolFeeVault"]["events"]
            if event.startswith("FeeBucketsCredited(")
        )
        self.assertIn("uint256 activeStock", fee_event)
        self.assertIn("uint256 stakeSaturationAmount", fee_event)
        self.assertNotIn("backingTarget", fee_event)
        market_created_event = next(
            event
            for event in modules["TickerGardenFactoryV2"]["events"]
            if event.startswith("MarketCreated(")
        )
        self.assertIn("uint256 stakeSaturationAmount", market_created_event)

        policy = self.manifest["officialStockAdmission"]
        self.assertEqual(policy["marketStakingBaseCardinality"], "EXACTLY_ONE_ASSET_UID")
        self.assertTrue(policy["stakingBaseImmutableAfterCreation"])
        self.assertFalse(policy["stockPriceRequired"])
        self.assertFalse(policy["priceFeedCoverageAffectsEligibility"])

        fee = self.manifest["postGraduationFee"]
        self.assertEqual(
            fee["stakerEligibility"],
            "ACTIVE_STOCK_LINEAR_SATURATION",
        )
        self.assertEqual(fee["stakeSaturationWholeTokens"], 10)
        self.assertEqual(
            fee["stakerFormula"],
            "floor(nonLpAmount*effectiveActiveStock/(2*stakeSaturationAmount))",
        )
        self.assertEqual(fee["stakerReleaseMode"], "LINEAR_CAPPED")

        fee_policy_fields = self.hash_schemas["schemas"]["feePolicyHash"][
            "fields"
        ]
        self.assertIn("uint256 stakeSaturationWholeTokens", fee_policy_fields)
        self.assertIn("uint8 stakerReleaseMode", fee_policy_fields)

    def test_generic_numeric_domain_matches_bounds_and_extreme_values(self):
        bounds = self.numeric_bounds
        self.assertEqual(bounds["status"], "APPROVED_GENERIC_NUMERIC_DOMAIN")
        domains = bounds["solidityDomains"]
        self.assertEqual(int(domains["uint256Max"]), UINT256_MAX)
        self.assertEqual(int(domains["int128Max"]), INT128_MAX)
        self.assertEqual(MIN_SUPPORTED_ASSET_DECIMALS, 6)
        self.assertEqual(MAX_ACCOUNTING_AMOUNT, INT128_MAX)
        self.assertEqual(MAX_LIFETIME_FEE_CREDITS, 2**48 - 1)
        self.assertEqual(STAKE_SATURATION_WHOLE_TOKENS, 10)
        self.assertEqual(stake_saturation_amount(6), 10_000_000)
        self.assertEqual(
            stake_saturation_amount(18), 10_000_000_000_000_000_000
        )
        recorded_saturation = bounds["stakeSaturation"]
        self.assertEqual(recorded_saturation["wholeTokens"], 10)
        self.assertEqual(
            int(recorded_saturation["minimumRawAt6Decimals"]),
            stake_saturation_amount(6),
        )
        self.assertEqual(
            int(recorded_saturation["maximumRawAt18Decimals"]),
            stake_saturation_amount(18),
        )

        self.assertEqual(minimum_nonzero_stock_position(6), 500_001)
        self.assertEqual(
            minimum_nonzero_stock_position(18), 500_000_000_000_000_001
        )
        with self.assertRaises(ValueError):
            minimum_nonzero_stock_position(5)
        with self.assertRaises(ValueError):
            minimum_nonzero_stock_position(19)
        with self.assertRaises(ValueError):
            stake_saturation_amount(5)
        with self.assertRaises(ValueError):
            stake_saturation_amount(19)

        proof = accumulator_lifetime_bound()
        recorded = bounds["accumulatorProof"]
        self.assertEqual(proof.minimum_active_stock, int(recorded["minimumActiveStock"]))
        self.assertEqual(
            proof.maximum_accumulator_delta,
            int(recorded["maximumAccumulatorDelta"]),
        )
        self.assertEqual(proof.maximum_accumulator, int(recorded["maximumAccumulator"]))
        self.assertEqual(
            proof.uint256_headroom_factor, int(recorded["uint256HeadroomFactor"])
        )
        self.assertGreaterEqual(proof.uint256_headroom_factor, 1)

        maximum_base = maximum_post_graduation_fee_base()
        self.assertEqual(maximum_base, int(bounds["feeBounds"]["maximumPostGraduationFeeBase"]))
        saturation = stake_saturation_amount(18)
        maximum_partition = partition_pool_fee(
            maximum_base, INT128_MAX, saturation
        )
        self.assertEqual(maximum_partition.total, INT128_MAX)
        with self.assertRaises(ValueError):
            partition_pool_fee(maximum_base + 1, INT128_MAX, saturation)

        self.assertEqual(checked_add_uint256(UINT256_MAX), UINT256_MAX)
        with self.assertRaises(ValueError):
            checked_add_uint256(UINT256_MAX, 1)
        self.assertEqual(mul_div_floor(UINT256_MAX, UINT256_MAX, UINT256_MAX), UINT256_MAX)
        self.assertEqual(mul_div_ceil(1, 1, 2), 1)
        self.assertTrue(product_lte(UINT256_MAX, UINT256_MAX, UINT256_MAX, UINT256_MAX))

        _, due = schedule_new_pending(
            empty_activation_wheel(), UINT64_MAX - ACTIVATION_DELAY_SECONDS, 1
        )
        self.assertEqual(due, UINT64_MAX)
        with self.assertRaises(ValueError):
            schedule_new_pending(
                empty_activation_wheel(),
                UINT64_MAX - ACTIVATION_DELAY_SECONDS + 1,
                1,
            )
        self.assertFalse(
            bounds["configurationDependency"][
                "stockPriceOrBackingTargetRequired"
            ]
        )
        self.assertFalse(
            bounds["configurationDependency"]["stockPriceOrUsdNotionalRequired"]
        )
        self.assertFalse(
            bounds["configurationDependency"][
                "observedOfficialStockCountIsProtocolCap"
            ]
        )

    def test_batch_operations_are_absent_from_initial_release_abi(self):
        batch = self.manifest["batchOperations"]
        self.assertFalse(batch["initialReleaseScope"])
        self.assertFalse(batch["batchAbiAllowed"])
        self.assertTrue(batch["singleMarketEntryPointsPermanent"])
        signatures = [
            entry["signature"]
            for module in self.abi["modules"]
            for entry in module.get("functions", [])
        ]
        canonical_mutations = [
            entry["canonicalSignature"]
            for entry in self.canonical_abi["mutations"]
        ]
        self.assertFalse(
            [signature for signature in signatures + canonical_mutations if "batch" in signature.lower()]
        )

    def test_curve_exact_output_rounding_and_invalid_zero_output(self):
        self.assertEqual(curve_amount_in(66_667, 1_000, 400_000), 201)
        with self.assertRaises(ValueError):
            curve_amount_out(1, 10**30, 1)

    def test_launch_and_buy_value_semantics_have_no_artificial_one_percent_cap(self):
        launch = self.pons_vectors["launch"]
        fee = int(launch["launchFeeRaw"])
        native = launch["nativeLaunchAndBuy"]
        self.assertEqual(
            int(native["requiredMsgValueRaw"]),
            fee + int(native["firstBuyAmountRaw"]),
        )
        erc20 = launch["erc20LaunchAndBuy"]
        self.assertEqual(int(erc20["requiredMsgValueRaw"]), fee)
        self.assertTrue(erc20["requiresTokenApproval"])
        self.assertIsNone(launch["firstBuyGraduationShareCapBps"])

    def test_create2_component_vectors_are_domain_separated_and_reproducible(self):
        vector = self.pons_vectors["create2"]
        self.assertEqual(vector["domainLabel"], COMPONENT_SALT_DOMAIN_LABEL)
        seen_salts = set()
        seen_addresses = set()
        for component in vector["components"]:
            salt = derive_component_salt(
                vector["chainId"],
                vector["factory"],
                vector["marketId"],
                component["kindLabel"],
            )
            self.assertEqual("0x" + salt.hex(), component["componentSalt"])
            predicted = predict_create2_address(
                component["deployer"], salt, component["initCodeHash"]
            )
            self.assertEqual(predicted, component["predictedAddress"])
            seen_salts.add(salt)
            seen_addresses.add(predicted)
        self.assertEqual(len(seen_salts), len(vector["components"]))
        self.assertEqual(len(seen_addresses), len(vector["components"]))
        self.assertEqual(
            [component["kindLabel"] for component in vector["components"]],
            ["CURVE", "TOKEN", "GAUGE", "LOCKER"],
        )
        self.assertEqual(vector["components"][-1]["deployer"], vector["graduationDeployer"])
        self.assertTrue(
            all(
                component["deployer"] == vector["launchDeployer"]
                for component in vector["components"][:-1]
            )
        )

    def test_graduation_events_expose_each_supply_partition(self):
        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        curve_events = set(modules["PonsCompatibleCurve"]["events"])
        graduation_events = set(modules["GraduationExecutor"]["events"])
        self.assertIn(
            "LaunchSwept(bytes32 indexed marketId,address indexed quoteAsset,uint256 sweptQuote,uint256 sweptTokens,uint64 sweptAt)",
            curve_events,
        )
        self.assertIn(
            "PoolGraduated(bytes32 indexed marketId,bytes32 indexed poolId,address indexed launchLocker,uint256 sweptQuote,uint256 sweptTokens,uint256 poolMemeAmount,uint256 lockedExcessMeme,uint32 sourceVersion)",
            graduation_events,
        )

    def test_reference_model_constants_match_execution_manifest(self):
        fee = self.manifest["postGraduationFee"]
        self.assertEqual(FEE_PIPS, fee["feePips"])
        self.assertEqual(PIPS_DENOMINATOR, fee["pipsDenominator"])
        self.assertEqual(LP_SHARE_BPS, fee["lpShareBps"])
        self.assertEqual(BPS_DENOMINATOR, fee["bpsDenominator"])
        self.assertEqual(
            STAKE_SATURATION_WHOLE_TOKENS,
            fee["stakeSaturationWholeTokens"],
        )
        self.assertEqual(INDEX_PRECISION, 10**27)

    def test_reference_fee_model_matches_examples_and_conserves(self):
        active = partition_pool_fee(
            base=1_000, active_stock=5, saturation_amount=10
        )
        self.assertEqual(
            (active.creator, active.staker, active.platform, active.lp),
            (3, 2, 3, 2),
        )
        full = partition_pool_fee(
            base=1_000, active_stock=10, saturation_amount=10
        )
        self.assertEqual(
            (full.creator, full.staker, full.platform, full.lp),
            (2, 4, 2, 2),
        )
        empty = partition_pool_fee(
            base=1_000, active_stock=0, saturation_amount=10
        )
        self.assertEqual(
            (empty.creator, empty.staker, empty.platform, empty.lp), (4, 0, 4, 2)
        )

        for base in range(0, 100_001):
            for active_stock in (0, 1, 5, 9, 10, 11, INT128_MAX):
                result = partition_pool_fee(base, active_stock, 10)
                self.assertEqual(result.lp + result.non_lp, result.total)
                self.assertEqual(
                    result.creator + result.staker + result.platform,
                    result.non_lp,
                )
                self.assertEqual(
                    result.staker,
                    result.non_lp * min(active_stock, 10) // 20,
                )

        for total in range(0, 1_001):
            curve = partition_curve_fee(total)
            self.assertEqual(curve.creator + curve.platform, total)
            self.assertGreaterEqual(curve.platform, curve.creator)

    def test_reference_accumulator_preserves_scaled_numerator(self):
        remainder = 9
        for reward, active in ((7, 10), (11, 1), (13, 37), (0, 3)):
            credit = credit_pool_index(reward, active, remainder)
            self.assertEqual(
                reward * INDEX_PRECISION + remainder,
                credit.accumulator_delta * active + credit.new_index_remainder,
            )
            self.assertGreaterEqual(credit.new_index_remainder, 0)
            self.assertLess(credit.new_index_remainder, active)
            remainder = credit.new_index_remainder

    def test_reference_user_settlement_preserves_subunit_remainder(self):
        settlement = settle_user_reward(
            active_stock=3,
            current_accumulator=INDEX_PRECISION // 2,
            accumulator_paid=0,
            previous_claimable=7,
            previous_user_remainder=INDEX_PRECISION - 1,
        )
        scaled_entitlement = 3 * (INDEX_PRECISION // 2) + INDEX_PRECISION - 1
        expected_new, expected_remainder = divmod(scaled_entitlement, INDEX_PRECISION)
        self.assertEqual(settlement.newly_claimable, expected_new)
        self.assertEqual(settlement.total_claimable, 7 + expected_new)
        self.assertEqual(settlement.new_user_remainder, expected_remainder)
        self.assertEqual(settlement.new_accumulator_paid, INDEX_PRECISION // 2)

    def test_reference_model_rejects_invalid_domains(self):
        with self.assertRaises(ValueError):
            partition_supply(1, 0, 1)
        with self.assertRaises(ValueError):
            partition_pool_fee(1, -1, 10)
        with self.assertRaises(ValueError):
            partition_pool_fee(1, 1, 0)
        with self.assertRaises(ValueError):
            credit_pool_index(1, 0, 0)
        with self.assertRaises(ValueError):
            settle_user_reward(1, 0, 1, 0, 0)

    def test_g0_register_separates_approved_direction_from_open_deployment_inputs(self):
        register = self.g0_recommendations
        self.assertEqual(register["executionSpecId"], "V2-EXEC-3")
        self.assertEqual(
            register["status"], "PRODUCT_DIRECTION_APPROVED_IMPLEMENTATION_ALLOWED"
        )
        expected = {
            "V2-G0-PONS-BASELINE-01",
            "V2-G0-PONS-QUOTE-01",
            "V2-G0-PONS-DIFF-01",
            "V2-G0-OFFICIAL-STOCK-BASE-01",
            "V2-G0-LAUNCH-FRICTION-01",
            "V2-G0-LAUNCH-FEE-GOVERNANCE-01",
            "V2-G0-ANTI-SNIPE-01",
            "V2-G0-BATCH-01",
        }
        recommendations = register["recommendations"]
        self.assertEqual(set(recommendations), expected)
        self.assertEqual(
            recommendations["V2-G0-PONS-BASELINE-01"]["status"],
            "APPROVED_BEHAVIOR_REFERENCE",
        )
        self.assertEqual(
            recommendations["V2-G0-PONS-DIFF-01"]["status"],
            "APPROVED_DIFFERENCE_MATRIX",
        )
        quote = recommendations["V2-G0-PONS-QUOTE-01"]
        self.assertTrue(quote["nativeQuoteSupported"])
        self.assertTrue(quote["erc20QuoteSupported"])
        self.assertEqual(len(quote["productionQuoteConfigs"]), 2)
        self.assertEqual(
            {entry["label"] for entry in quote["productionQuoteConfigs"]},
            {"NATIVE_ETH_V1", "USDG_V1"},
        )
        self.assertEqual(quote["productionListStatus"], "APPROVED_NATIVE_AND_USDG")
        self.assertEqual(quote["observedExampleConfigs"][0]["symbol"], "USDG")
        stock_base = recommendations["V2-G0-OFFICIAL-STOCK-BASE-01"]
        self.assertEqual(
            stock_base["status"],
            "APPROVED_ALL_OBSERVED_ACTIVE_OFFICIAL_STOCKS_USER_SELECTABLE",
        )
        self.assertEqual(stock_base["observedAssetCount"], 194)
        self.assertFalse(stock_base["catalogCountIsProtocolCap"])
        self.assertTrue(stock_base["allObservedActiveAssetsSelectableAsStakingBase"])
        self.assertFalse(stock_base["stockPriceRequired"])
        self.assertFalse(stock_base["backingTargetRequired"])
        self.assertEqual(stock_base["stakeSaturationWholeTokens"], 10)
        launch_fee = recommendations["V2-G0-LAUNCH-FRICTION-01"]
        self.assertEqual(launch_fee["asset"], "NATIVE")
        self.assertEqual(int(launch_fee["amountRaw"]), 500_000_000_000_000)
        self.assertEqual(
            launch_fee["mutability"], "IMMUTABLE_PER_FACTORY_AND_EXECUTION_SPEC"
        )
        anti_snipe = recommendations["V2-G0-ANTI-SNIPE-01"]
        self.assertIsNone(anti_snipe["maxShareBpsOfGraduationThreshold"])
        self.assertFalse(anti_snipe["arbitraryTeamExemptionArray"])
        self.assertEqual(anti_snipe["runtimeAntiSnipeVectorStatus"], "VERIFIED")
        self.assertEqual(anti_snipe["rawBpsByElapsedSecond"], [9900, 618, 19])
        batch = recommendations["V2-G0-BATCH-01"]
        self.assertEqual(batch["status"], "APPROVED_OUT_OF_SCOPE_V2_INITIAL_RELEASE")
        self.assertFalse(batch["batchEntryPoints"])
        self.assertIsNone(batch["maxMarketsPerCall"])

    def test_activation_reference_constants_match_manifest(self):
        activation = self.manifest["activation"]
        self.assertEqual(ACTIVATION_DELAY_SECONDS, activation["delaySeconds"])
        self.assertEqual(ACTIVATION_WHEEL_SIZE, activation["wheelSize"])

    def test_activation_reference_processes_boundary_before_new_fee(self):
        wheel = empty_activation_wheel()
        wheel = add_activation_bucket(wheel, generation=130, amount=7, refs=1)
        before, processed_before = process_mature_activations(wheel, now=129)
        self.assertEqual(before, wheel)
        self.assertEqual(processed_before, ())

        after, processed_at = process_mature_activations(wheel, now=130)
        self.assertEqual(
            processed_at[0],
            type(processed_at[0])(generation=130, amount=7, refs=1),
        )
        self.assertEqual(after[130 % ACTIVATION_WHEEL_SIZE], ActivationSlot())

    def test_activation_reference_proves_live_window_has_no_slot_collision(self):
        for now in range(0, 256):
            wheel = empty_activation_wheel()
            for generation in range(now + 1, now + ACTIVATION_DELAY_SECONDS):
                wheel = add_activation_bucket(wheel, generation, amount=1)
            wheel, due = schedule_new_pending(wheel, now, amount=1)
            self.assertEqual(due, now + ACTIVATION_DELAY_SECONDS)
            live = [slot.generation for slot in wheel if slot.generation]
            self.assertEqual(len(live), len(set(g % ACTIVATION_WHEEL_SIZE for g in live)))

    def test_activation_reference_aggregates_and_removes_by_ref(self):
        wheel = empty_activation_wheel()
        wheel = add_activation_bucket(wheel, 62, amount=5)
        wheel = add_activation_bucket(wheel, 62, amount=9)
        slot = wheel[62 % ACTIVATION_WHEEL_SIZE]
        self.assertEqual((slot.amount, slot.refs), (14, 2))
        wheel = remove_activation_position(wheel, 62, amount=5)
        slot = wheel[62 % ACTIVATION_WHEEL_SIZE]
        self.assertEqual((slot.amount, slot.refs), (9, 1))
        wheel = remove_activation_position(wheel, 62, amount=9)
        self.assertEqual(wheel[62 % ACTIVATION_WHEEL_SIZE], ActivationSlot())

    def test_activation_reference_fails_closed_on_corrupt_collision(self):
        wheel = add_activation_bucket(empty_activation_wheel(), 33, amount=1)
        with self.assertRaisesRegex(ValueError, "ActivationSlotCollision"):
            add_activation_bucket(wheel, 65, amount=1)


if __name__ == "__main__":
    unittest.main()
