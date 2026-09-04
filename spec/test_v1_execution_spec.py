import json
import hashlib
import re
import subprocess
import unittest
from pathlib import Path

from spec.generate_v1_hash_vectors import keccak256
from spec.v1_reference_model import (
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
    MINIMUM_SAFE_ALLOCATION_RAW,
    MIN_SUPPORTED_ASSET_DECIMALS,
    PIPS_DENOMINATOR,
    PLATFORM_NON_LP_SHARE_BPS,
    STAKER_NON_LP_SHARE_BPS,
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
    validate_minimum_allocation,
)


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent


def load(name):
    with (ROOT / name).open(encoding="utf-8") as handle:
        return json.load(handle)


class V1ExecutionSpecTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load("v1_execution_manifest.json")
        cls.permissions = load("v1_permissions_matrix.json")
        cls.abi = load("v1_abi_surface.json")
        cls.canonical_abi = load("v1_canonical_abi.json")
        cls.hash_schemas = load("v1_hash_schemas.json")
        cls.external_evidence = load("v1_g0_external_evidence.json")
        cls.g0_recommendations = load("v1_g0_recommendations.json")
        cls.pons_vectors = load("v1_pons_behavior_vectors.json")
        cls.pons_runtime_evidence = load("v1_pons_runtime_evidence.json")
        cls.initial_quote_configs = load("v1_initial_quote_configs.json")
        cls.numeric_bounds = load("v1_numeric_bounds.json")
        cls.treasury_manifest = load("v1_treasury_execution_manifest.json")
        cls.official_stock_catalog = load("v1_rh_official_stock_catalog.snapshot.json")
        cls.official_stock_catalog_raw = (ROOT / "v1_rh_official_stock_catalog.source.json").read_bytes()

    def test_spec_ids_match(self):
        expected = "V1-EXEC-8"
        self.assertEqual(self.manifest["executionSpecId"], expected)
        self.assertEqual(self.permissions["executionSpecId"], expected)
        self.assertEqual(self.abi["executionSpecId"], expected)
        self.assertEqual(self.canonical_abi["executionSpecId"], expected)

    def test_treasury_access_manager_surface_is_explicit_and_matches_permissions(self):
        treasury = self.treasury_manifest
        access = treasury["accessManager"]
        self.assertTrue(treasury["v1Compatibility"]["changesV1Contracts"])
        self.assertTrue(treasury["v1Compatibility"]["changesV1Abi"])
        self.assertEqual(
            access["bindings"],
            {
                "authority": "IMMUTABLE_SHARED_V1_ACCESS_MANAGER",
                "marketRegistry": "IMMUTABLE_CANONICAL_MARKET_REGISTRY_V1",
                "livePreflightRequired": True,
            },
        )
        self.assertEqual(
            {
                role["roleName"]: (
                    role["roleId"],
                    role["executionDelaySeconds"],
                )
                for role in access["roles"]
            },
            {
                "PROTOCOL_ADMIN_ROLE": ("1", 172800),
                "PAUSE_GUARDIAN_ROLE": ("2", 0),
                "ROOT_PUBLISHER_ROLE": ("4", 0),
                "ROOT_REVIEW_ROLE": ("5", 0),
            },
        )

        declared = {
            row["signature"]: (
                row["caller"],
                row.get("executionDelaySeconds", 0),
            )
            for row in access["restrictedFunctions"] + access["directFunctions"]
        }
        permissions = {
            row["signature"]: (row["caller"], row["delaySeconds"])
            for row in self.permissions["functions"]
            if row["module"] == "TreasuryDistributorV1"
        }
        self.assertEqual(declared, permissions)
        self.assertEqual(
            {row["signature"] for row in access["restrictedFunctions"]},
            {
                "registerMarket(bytes32,address,address,bytes32)",
                "setRootServiceFee(address,uint128)",
                "publishRoot(bytes32,uint32,bytes32,bytes32,uint256,uint32,uint256)",
                "cancelPendingRoot(bytes32,uint32,bytes32)",
            },
        )
        direct = {row["signature"]: row["caller"] for row in access["directFunctions"]}
        self.assertEqual(direct["activateMarket(bytes32)"], "PUBLIC")
        self.assertTrue(access["handoff"]["dedicatedRootSafesRequired"])
        self.assertTrue(access["handoff"]["rootSafesMustNotAliasCoreSafes"])
        self.assertTrue(access["handoff"]["selectorAssignmentsFrozenBeforeProduction"])
        self.assertTrue(access["handoff"]["bootstrapAdminRenouncedLast"])

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
        self.assertNotIn("V1-P-005", implementation_open)
        self.assertNotIn("V1-P-007", implementation_open)
        self.assertNotIn("V1-G0-PONS-RUNTIME-VECTORS-01", implementation_open)
        self.assertNotIn("V1-G0-PRODUCTION-QUOTES-01", implementation_open)
        self.assertNotIn("V1-G0-BATCH-01", implementation_open)
        self.assertIn("V1-DEPLOY-ABI-DIFF-01", gate_sets["deployment"]["open"])
        self.assertIn("V1-PROD-SOAK-72H-01", gate_sets["production"]["open"])
        for relative in (
            "README.md",
            "website-fruit-tree/README.md",
            "V1_READINESS_AND_DEPLOYMENT_GATES.md",
        ):
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
                ("spec/v1_hash_schemas.json", "/vectors"),
                ("spec/v1_pons_behavior_vectors.json", "/create2"),
            },
        )

    def test_post_deployment_market_intervention_surface_is_absent(self):
        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        self.assertNotIn("MarketController", modules)
        removed = {
            "setMarketPaused(bytes32,bytes32)",
            "setMarketActive(bytes32)",
            "setMarketRetired(bytes32,bytes32)",
            "commitEmergencyExit(bytes32,uint64,bytes32)",
            "disablePool(bytes32)",
            "disableForEmergency(uint32,uint64,bytes32)",
            "forceReleaseAllocation(bytes32,bytes32)",
            "freezeRecoveryCaps(bytes32,uint32,uint64,bytes32)",
            "proposeRecoveryRoot(bytes32,uint32,address,bytes32,uint256)",
            "cancelRecoveryRoot(bytes32,uint32,address,uint32)",
            "finalizeRecoveryRoot(bytes32,uint32,address,uint32)",
            "claimRecovery(bytes32,uint32,address,uint256,bytes32[])",
        }
        present = {
            item["signature"]
            for module in self.abi["modules"]
            for item in module.get("functions", [])
        }
        self.assertTrue(removed.isdisjoint(present))
        self.assertNotIn("recovery", self.manifest)
        autonomy = self.manifest["marketAutonomy"]
        self.assertFalse(autonomy["postDeploymentAdministrativeState"])
        self.assertFalse(autonomy["pauseEntrypoint"])
        self.assertFalse(autonomy["retireEntrypoint"])
        self.assertFalse(autonomy["takeoverEntrypoint"])

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
            "V1-G0-LAUNCH-FEE-GOVERNANCE-01"
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
            "EXACT_REGISTERED_GAUGE",
        )
        self.assertIn(
            "Swept_AND_NOT_RESCUED",
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
            entry["signature"]: entry for entry in modules["TickerGardenFactoryV1"]["functions"]
        }
        self.assertEqual(
            factory["predictMarketAddresses(address,CreateMarketParams)"]["returns"],
            "(bytes32,address,address,address,address)",
        )
        self.assertEqual(
            factory["runtimeBindings()"]["returns"],
            "(address,address,address,address,address,address,address,address)",
        )
        locker = {entry["signature"] for entry in modules["LaunchLocker"]["functions"]}
        self.assertNotIn("compoundLockedFees()", locker)
        self.assertNotIn("compoundLockedFees(bytes32)", locker)
        required_errors = set(self.abi["requiredErrors"])
        for error in (
            "InvalidLaunchFee(uint256,uint256)",
            "UnauthorizedMarketCurve(address,address)",
            "GraduationNotRetryable(bytes32,uint8)",
            "LaunchLockerAddressCollision(address)",
            "RageQuitRewardSettlementPending(address,bytes32,uint256)",
            "NoRageQuitRewardSettlement(address,bytes32)",
        ):
            self.assertIn(error, required_errors)

    def test_fee_and_hook_constants(self):
        fee = self.manifest["postGraduationFee"]
        pool = self.manifest["canonicalPool"]
        self.assertEqual(fee["feePips"] * 100, fee["pipsDenominator"])
        self.assertEqual(fee["lpShareBps"], 0)
        self.assertEqual(pool["lpDistribution"], "NONE")
        self.assertEqual(pool["hookFeeDestination"], "PROTOCOL_FEE_VAULT_FULL_AMOUNT")
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

    def test_integer_fee_partition_and_fixed_active_staker_bucket_conserve(self):
        for base in range(0, 100_001):
            for active_stock in (0, 1, 2, 5, 9, 10, 11, INT128_MAX):
                partition = partition_pool_fee(base, active_stock)
                self.assertEqual(partition.lp + partition.non_lp, partition.total)
                self.assertEqual(
                    partition.creator + partition.staker + partition.platform,
                    partition.non_lp,
                )
                expected_staker = (
                    partition.non_lp * STAKER_NON_LP_SHARE_BPS // BPS_DENOMINATOR
                    if active_stock
                    else 0
                )
                self.assertEqual(partition.staker, expected_staker)
                self.assertEqual(
                    partition.platform,
                    partition.non_lp * PLATFORM_NON_LP_SHARE_BPS // BPS_DENOMINATOR,
                )
                self.assertEqual(partition.lp, 0)

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
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["AssetStatus"]))
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["QuoteStatus"]))
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["BaselineStatus"]))
        self.assertFalse(any(source == "RETIRED" for source, _ in transitions["LaunchTemplateStatus"]))

    def test_market_registry_is_the_only_canonical_market_authority(self):
        authority = self.manifest["stateAuthority"]
        self.assertEqual(authority["canonicalModule"], "MarketRegistryV1")
        self.assertEqual(authority["initialRuntime"]["sourceVersion"], 1)
        self.assertEqual(authority["initialRuntime"]["launchPhase"], "NotGraduated")
        self.assertEqual(authority["marketAdministrativeState"], "ABSENT")

        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        self.assertIn("MarketRegistryV1", modules)
        registry = modules["MarketRegistryV1"]
        self.assertEqual(
            set(registry["structs"]["MarketRuntime"]),
            {
                "bytes32 poolId",
                "uint32 sourceVersion",
                "uint64 sweptAt",
                "uint8 launchPhase",
            },
        )
        self.assertNotIn("MarketView", modules["TickerGardenFactoryV1"].get("structs", {}))
        factory_functions = {
            item["signature"] for item in modules["TickerGardenFactoryV1"]["functions"]
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
            },
        )
        launch_edges = {
            tuple(entry["transition"])
            for entry in authority["mutations"]
            if "transition" in entry
            and entry["transition"][0] in self.manifest["states"]["LaunchPhase"]
        }
        self.assertEqual(launch_edges, {tuple(edge) for edge in self.manifest["transitions"]["LaunchPhase"]})

        self.assertEqual(mutations["markRescued(bytes32)"]["minimumDelaySecondsFromSweptAt"], 604800)

    def test_market_lifecycle_has_no_administrative_state_product(self):
        authority = self.manifest["stateAuthority"]
        self.assertNotIn("MarketStatus", self.manifest["states"])
        self.assertNotIn("MarketStatus", self.manifest["transitions"])
        self.assertEqual(authority["marketAdministrativeState"], "ABSENT")
        self.assertIn("POST_DEPLOYMENT_MARKET_INTERVENTION", authority["forbidden"])

    def test_market_registry_has_no_generic_or_governance_write_path(self):
        authority = self.manifest["stateAuthority"]
        forbidden = set(authority["forbidden"])
        self.assertIn("GENERIC_MARKET_SETTER", forbidden)
        self.assertIn("ARBITRARY_FEE_SOURCE_SETTER", forbidden)
        self.assertIn("GOVERNANCE_DIRECT_REGISTRY_MUTATION", forbidden)
        for entry in authority["mutations"]:
            self.assertNotIn(entry["caller"], {"PROTOCOL_ADMIN_ROLE", "PAUSE_GUARDIAN_ROLE", "UNPAUSE_ROLE"})

        permission_rows = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        for entry in authority["mutations"]:
            self.assertIn(("MarketRegistryV1", entry["function"]), permission_rows)

    def test_sensitive_permissions_have_required_delays(self):
        rows = {(row["module"], row["signature"]): row for row in self.permissions["functions"]}
        self.assertEqual(rows[("OfficialStockRegistryV1", "pauseAsset(bytes32,bytes32)")]["delaySeconds"], 0)
        self.assertEqual(rows[("OfficialStockRegistryV1", "unpauseAsset(bytes32)")]["delaySeconds"], 86400)
        self.assertEqual(rows[("OfficialStockRegistryV1", "retireAsset(bytes32,bytes32)")]["delaySeconds"], 172800)

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
            ["python3", str(ROOT / "generate_v1_canonical_abi.py")],
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
            ["python3", str(ROOT / "generate_v1_solidity_draft.py")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        committed = (ROOT / "interfaces/IV1MutationSurfaceDraft.sol").read_text(
            encoding="utf-8"
        )
        self.assertEqual(generated, committed)

    def test_compiled_solidity_interfaces_are_reproducible_and_complete(self):
        generated = subprocess.run(
            ["python3", str(ROOT / "generate_v1_interfaces.py")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        committed = (
            PROJECT_ROOT / "contracts/src/v1/interfaces/IV1Protocol.sol"
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
            "FACTORY_MODULE",
            "LAUNCH_ROUTER_MODULE",
            "GRADUATION_MODULE",
            "ALLOCATION_MODULE",
            "POOL_MANAGER",
            "ACTIVE_FEE_SOURCE",
            "EXACT_REGISTERED_CURVE",
            "ALLOCATION_MODULE_OR_FEE_VAULT",
            "EXACT_REGISTERED_GAUGE",
            "FEE_VAULT",
            "CURRENT_CREATOR_BENEFICIARY",
            "TREASURY_DISTRIBUTOR_MODULE",
            "CURRENT_MEME_HOLDER",
            "ROOT_PUBLISHER_ROLE",
            "ROOT_REVIEW_ROLE",
            "SERVICE_BENEFICIARY",
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
            ("MarketRegistryV1", "markRescued(bytes32)"),
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
        factory = rows[("TickerGardenFactoryV1", "createMarket(CreateMarketParams)")]
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
            ("TickerGardenFactoryV1", "createMarketFor(address,CreateMarketParams)")
        ]
        self.assertEqual(create_for["caller"], "LAUNCH_ROUTER_MODULE")
        self.assertEqual(
            create_for["precondition"], "CREATOR_EQUALS_ROUTER_OUTER_MSG_SENDER"
        )
        deposit_for = rows[
            ("UserStockVault", "depositStockFor(bytes32,address,uint256)")
        ]
        self.assertEqual(deposit_for["caller"], "ALLOCATION_MODULE")
        self.assertEqual(deposit_for["recipient"], "fixed_user_internal_balance")
        self.assertIn("OUTER_MSG_SENDER", deposit_for["precondition"])
        all_signatures = {entry["displaySignature"] for entry in rows.values()}
        self.assertFalse(any("tx.origin" in signature for signature in all_signatures))
        self.assertNotIn("launchAndBuyFor(address,CreateMarketParams,uint256,uint256,address)", all_signatures)

    def test_multi_asset_vault_is_schema_singleton_and_asset_scoped(self):
        policy = self.manifest["vault"]
        self.assertEqual(
            policy["custodyScope"],
            "ONE_MULTI_ASSET_USER_STOCK_VAULT_PER_VAULT_SCHEMA_VERSION",
        )
        self.assertEqual(policy["initialDeploymentCount"], 1)
        self.assertEqual(
            policy["schemaUniqueness"],
            "OFFICIAL_STOCK_REGISTRY_ENFORCES_ONE_CANONICAL_VAULT_PER_SCHEMA",
        )
        self.assertEqual(policy["assetKey"], "EXPLICIT_CANONICAL_ASSET_UID")
        self.assertEqual(policy["allocationKey"], "ASSET_UID_USER_MARKET_ID")
        self.assertFalse(policy["onchainAssetEnumeration"])

        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        vault_functions = {
            entry["signature"] for entry in modules["UserStockVault"]["functions"]
        }
        self.assertTrue(
            {
                "depositStock(bytes32,uint256)",
                "withdrawFreeStock(bytes32,uint256)",
                "rageQuit(bytes32,bytes32)",
                "allocation(bytes32,address,bytes32)",
                "totalDeposited(bytes32)",
                "totalAllocated(bytes32)",
                "vaultIdentity()",
            }.issubset(vault_functions)
        )
        self.assertFalse(any(signature.startswith("batch") for signature in vault_functions))

        registry_functions = {
            entry["signature"]
            for entry in modules["OfficialStockRegistryV1"]["functions"]
        }
        self.assertIn("vaultSchemaId(address)", registry_functions)
        self.assertIn("vaultForSchema(bytes32)", registry_functions)
        self.assertIn(
            "StockVaultRegistered(address indexed userStockVault,bytes32 indexed schemaId,address indexed marketRegistry,address allocationManager)",
            modules["OfficialStockRegistryV1"]["events"],
        )
        for event in modules["UserStockVault"]["events"]:
            self.assertIn("bytes32 indexed assetUid", event)

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

    def test_market_autonomy_keeps_rage_quit_and_removes_reward_migration(self):
        autonomy = self.manifest["marketAutonomy"]
        self.assertEqual(autonomy["userPrincipalEscape"], "PER_MARKET_RAGE_QUIT_ALWAYS_AVAILABLE")
        self.assertFalse(autonomy["feeVaultRewardMigrationEntrypoint"])
        modules = {entry["module"]: entry for entry in self.abi["modules"]}
        vault_functions = {
            entry["signature"] for entry in modules["ProtocolFeeVault"]["functions"]
        }
        self.assertFalse(any("Recovery" in signature for signature in vault_functions))
        user_vault_functions = {
            entry["signature"] for entry in modules["UserStockVault"]["functions"]
        }
        self.assertIn("rageQuit(bytes32,bytes32)", user_vault_functions)

    def test_typed_hash_schemas_are_reproducible_and_domain_separated(self):
        generated = subprocess.run(
            ["python3", str(ROOT / "generate_v1_hash_vectors.py")],
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
        self.assertEqual(vectors["expectedEconomics"]["inputs"]["schemaVersion"], "3")
        self.assertEqual(vectors["ponsBaselineHash"]["inputs"]["schemaVersion"], "1")
        self.assertEqual(vectors["feePolicyHash"]["inputs"]["schemaVersion"], "4")
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
            entry["signature"] for entry in modules["MarketRegistryV1"]["functions"]
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

    def test_allocation_and_timing_have_one_execution_order(self):
        timing = self.manifest["allocationAndTiming"]
        self.assertEqual(
            timing["normalDirections"], ["DEPOSIT_OR_INCREASE", "FULL_WITHDRAWAL"]
        )
        self.assertFalse(timing["partialDecreaseAllowed"])
        self.assertFalse(timing["migrationAllowed"])
        self.assertEqual(timing["normalWithdrawalAmount"], "FULL_USER_MARKET_ALLOCATION")
        self.assertIn("REMOVE_FULL_POSITION", timing["normalWithdrawalOrder"])
        self.assertEqual(timing["activationDelaySeconds"], 30)
        self.assertEqual(timing["increaseWholePositionLockResetSeconds"], 86400)
        self.assertEqual(timing["rescueDelaySeconds"], 604800)

        permissions = {
            (entry["module"], entry["signature"]): entry
            for entry in self.permissions["functions"]
        }
        signatures = {
            signature
            for module, signature in permissions
            if module == "AllocationManager"
        }
        self.assertNotIn("decreaseAllocation(bytes32,uint256)", signatures)
        self.assertNotIn("migrateAllocation(bytes32,bytes32,uint256)", signatures)
        self.assertIn("FULL_POSITION_ONLY", permissions[("AllocationManager", "closeAllocation(bytes32)")]["precondition"])
        rescue = permissions[("GraduationExecutor", "rescueSweptLaunch(bytes32)")]
        self.assertEqual(rescue["stateDelayAnchor"], "MARKET_RUNTIME_SWEPT_AT")
        self.assertEqual(
            rescue["precondition"],
            "Swept_AND_BLOCK_TIMESTAMP_GTE_SWEPT_AT_PLUS_604800",
        )

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
        self.assertEqual(evidence["executionSpecId"], "V1-EXEC-3")
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
            self.g0_recommendations["recommendations"]["V1-G0-ANTI-SNIPE-01"][
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
        self.assertEqual(catalog["source"]["rawResponseArchive"], "v1_rh_official_stock_catalog.source.json")
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
            "V1-G0-OFFICIAL-STOCK-BASE-01"
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

        registry = modules["OfficialStockRegistryV1"]
        registry_signatures = {
            function["signature"] for function in registry["functions"]
        }
        self.assertIn(
            "registerAsset(bytes32,address,uint8,address,uint256,StockTokenFingerprint)",
            registry_signatures,
        )
        self.assertIn(
            "acceptAssetImplementation(bytes32,address,bytes32,bytes32)",
            registry_signatures,
        )
        self.assertIn("assetIdentityCurrent(bytes32)", registry_signatures)
        self.assertIn(
            "setMinimumAllocation(bytes32,uint256,bytes32)", registry_signatures
        )
        self.assertIn("minimumAllocation(bytes32)", registry_signatures)
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
        self.assertIn(
            "AssetRegistered(bytes32 indexed assetUid,address indexed stockToken,address indexed userStockVault,uint8 tokenDecimals)",
            registry["events"],
        )

        market_config = modules["MarketRegistryV1"]["structs"]["MarketConfig"]
        self.assertIn("bytes32 assetUid", market_config)
        self.assertFalse(
            any("stakeSaturation" in declaration for declaration in market_config)
        )
        create_params = modules["TickerGardenFactoryV1"]["structs"][
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
        self.assertFalse(
            any("stakeSaturation" in declaration for declaration in economics_fields)
        )
        self.assertFalse(
            any("backingTarget" in declaration for declaration in economics_fields)
        )

        fee_event = next(
            event
            for event in modules["ProtocolFeeVault"]["events"]
            if event.startswith("FeeBucketsCredited(")
        )
        self.assertIn("uint256 activeStock", fee_event)
        self.assertNotIn("stakeSaturation", fee_event)
        self.assertNotIn("backingTarget", fee_event)
        market_created_event = next(
            event
            for event in modules["TickerGardenFactoryV1"]["events"]
            if event.startswith("MarketCreated(")
        )
        self.assertNotIn("stakeSaturation", market_created_event)

        policy = self.manifest["officialStockAdmission"]
        self.assertEqual(policy["marketStakingBaseCardinality"], "EXACTLY_ONE_ASSET_UID")
        self.assertTrue(policy["stakingBaseImmutableAfterCreation"])
        self.assertFalse(policy["stockPriceRequired"])
        self.assertFalse(policy["priceFeedCoverageAffectsEligibility"])
        self.assertEqual(
            policy["minimumAllocationPolicy"],
            "PER_ASSET_TIMELOCKED_ADMIN_CONFIGURATION",
        )

        fee = self.manifest["postGraduationFee"]
        self.assertEqual(
            fee["stakerEligibility"],
            "ANY_POSITIVE_ACTIVE_STOCK",
        )
        self.assertEqual(fee["stakerNonLpShareBps"], 3_000)
        self.assertEqual(fee["platformNonLpShareBps"], 3_000)
        self.assertEqual(
            fee["stakerFormula"],
            "activeStock==0?0:floor(nonLpAmount*3000/10000)",
        )
        self.assertEqual(
            fee["stakerReleaseMode"], "FIXED_BINARY_BY_ACTIVE_STOCK"
        )

        fee_policy_fields = self.hash_schemas["schemas"]["feePolicyHash"][
            "fields"
        ]
        self.assertIn("uint16 stakerNonLpShareBps", fee_policy_fields)
        self.assertIn("uint16 platformNonLpShareBps", fee_policy_fields)
        self.assertFalse(
            any("stakeSaturation" in declaration for declaration in fee_policy_fields)
        )

    def test_generic_numeric_domain_matches_bounds_and_extreme_values(self):
        bounds = self.numeric_bounds
        self.assertEqual(bounds["status"], "APPROVED_GENERIC_NUMERIC_DOMAIN")
        self.assertEqual(bounds["assetAdmission"]["minimumDecimals"], 6)
        self.assertEqual(bounds["assetAdmission"]["maximumDecimals"], 18)
        domains = bounds["solidityDomains"]
        self.assertEqual(int(domains["uint256Max"]), UINT256_MAX)
        self.assertEqual(int(domains["int128Max"]), INT128_MAX)
        self.assertEqual(MIN_SUPPORTED_ASSET_DECIMALS, 6)
        self.assertEqual(MAX_ACCOUNTING_AMOUNT, INT128_MAX)
        self.assertEqual(MAX_LIFETIME_FEE_CREDITS, 2**48 - 1)
        self.assertEqual(STAKER_NON_LP_SHARE_BPS, 3_000)
        self.assertEqual(PLATFORM_NON_LP_SHARE_BPS, 3_000)
        self.assertEqual(MINIMUM_SAFE_ALLOCATION_RAW, 414)
        self.assertEqual(
            int(bounds["assetAdmission"]["minimumAllocationSafetyFloorRaw"]),
            MINIMUM_SAFE_ALLOCATION_RAW,
        )
        self.assertEqual(validate_minimum_allocation(6, 500_000), 500_000)
        self.assertEqual(validate_minimum_allocation(18, 10 * 10**18), 10 * 10**18)
        with self.assertRaises(ValueError):
            validate_minimum_allocation(5, 500_000)
        with self.assertRaises(ValueError):
            validate_minimum_allocation(19, 500_000)
        with self.assertRaises(ValueError):
            validate_minimum_allocation(6, MINIMUM_SAFE_ALLOCATION_RAW - 1)

        registry_source = (
            PROJECT_ROOT / "contracts/src/v1/modules/OfficialStockRegistryV1.sol"
        ).read_text(encoding="utf-8")
        allocation_source = (
            PROJECT_ROOT / "contracts/src/v1/shared/AllocationManagerIncreases.sol"
        ).read_text(encoding="utf-8")
        market_registry_source = (
            PROJECT_ROOT / "contracts/src/v1/modules/MarketRegistryV1.sol"
        ).read_text(encoding="utf-8")
        self.assertIn("MIN_TOKEN_DECIMALS = 6", registry_source)
        self.assertIn("MAX_TOKEN_DECIMALS = 18", registry_source)
        self.assertIn("MINIMUM_SAFE_ALLOCATION_RAW = 414", registry_source)
        self.assertIn("assetView.tokenDecimals < 6", allocation_source)
        self.assertIn("assetView.tokenDecimals > 18", allocation_source)
        self.assertIn("asset.tokenDecimals < 6", market_registry_source)
        self.assertIn("asset.tokenDecimals > 18", market_registry_source)
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
        self.assertTrue(recorded["forfeitureRedistributionLiabilityProofComplete"])
        self.assertEqual(
            recorded["forfeitureRedistributionAccumulatorFormalProofStatus"],
            "AUDIT_RESIDUAL_MULTI_USER_CHAINED_REMAINDER_NORMALIZATION",
        )

        maximum_base = maximum_post_graduation_fee_base()
        self.assertEqual(maximum_base, int(bounds["feeBounds"]["maximumPostGraduationFeeBase"]))
        maximum_partition = partition_pool_fee(maximum_base, INT128_MAX)
        self.assertEqual(maximum_partition.total, INT128_MAX)
        with self.assertRaises(ValueError):
            partition_pool_fee(maximum_base + 1, INT128_MAX)

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
        self.assertEqual(STAKER_NON_LP_SHARE_BPS, fee["stakerNonLpShareBps"])
        self.assertEqual(PLATFORM_NON_LP_SHARE_BPS, fee["platformNonLpShareBps"])
        self.assertEqual(INDEX_PRECISION, 10**27)

    def test_reference_fee_model_matches_examples_and_conserves(self):
        active = partition_pool_fee(base=1_000, active_stock=1)
        self.assertEqual(
            (active.creator, active.staker, active.platform, active.lp),
            (4, 3, 3, 0),
        )
        large = partition_pool_fee(base=1_000, active_stock=INT128_MAX)
        self.assertEqual(
            (large.creator, large.staker, large.platform, large.lp),
            (4, 3, 3, 0),
        )
        empty = partition_pool_fee(base=1_000, active_stock=0)
        self.assertEqual(
            (empty.creator, empty.staker, empty.platform, empty.lp), (7, 0, 3, 0)
        )

        for base in range(0, 100_001):
            for active_stock in (0, 1, 5, 9, 10, 11, INT128_MAX):
                result = partition_pool_fee(base, active_stock)
                self.assertEqual(result.lp + result.non_lp, result.total)
                self.assertEqual(
                    result.creator + result.staker + result.platform,
                    result.non_lp,
                )
                self.assertEqual(
                    result.staker,
                    0 if active_stock == 0 else result.non_lp * 3_000 // 10_000,
                )
                self.assertEqual(result.platform, result.non_lp * 3_000 // 10_000)

        for total in range(0, 1_001):
            curve = partition_curve_fee(total)
            self.assertEqual(curve.creator + curve.platform, total)
            self.assertEqual(curve.platform, total * 3_000 // 10_000)
            self.assertGreaterEqual(curve.creator, curve.platform)

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
            partition_pool_fee(1, -1)
        with self.assertRaises(ValueError):
            credit_pool_index(1, 0, 0)
        with self.assertRaises(ValueError):
            settle_user_reward(1, 0, 1, 0, 0)

    def test_g0_register_separates_approved_direction_from_open_deployment_inputs(self):
        register = self.g0_recommendations
        self.assertEqual(register["executionSpecId"], "V1-EXEC-3")
        self.assertEqual(
            register["status"], "PRODUCT_DIRECTION_APPROVED_IMPLEMENTATION_ALLOWED"
        )
        expected = {
            "V1-G0-PONS-BASELINE-01",
            "V1-G0-PONS-QUOTE-01",
            "V1-G0-PONS-DIFF-01",
            "V1-G0-OFFICIAL-STOCK-BASE-01",
            "V1-G0-LAUNCH-FRICTION-01",
            "V1-G0-LAUNCH-FEE-GOVERNANCE-01",
            "V1-G0-ANTI-SNIPE-01",
            "V1-G0-BATCH-01",
        }
        recommendations = register["recommendations"]
        self.assertEqual(set(recommendations), expected)
        self.assertEqual(
            recommendations["V1-G0-PONS-BASELINE-01"]["status"],
            "APPROVED_BEHAVIOR_REFERENCE",
        )
        self.assertEqual(
            recommendations["V1-G0-PONS-DIFF-01"]["status"],
            "APPROVED_DIFFERENCE_MATRIX",
        )
        quote = recommendations["V1-G0-PONS-QUOTE-01"]
        self.assertTrue(quote["nativeQuoteSupported"])
        self.assertTrue(quote["erc20QuoteSupported"])
        self.assertEqual(len(quote["productionQuoteConfigs"]), 2)
        self.assertEqual(
            {entry["label"] for entry in quote["productionQuoteConfigs"]},
            {"NATIVE_ETH_V1", "USDG_V1"},
        )
        self.assertEqual(quote["productionListStatus"], "APPROVED_NATIVE_AND_USDG")
        self.assertEqual(quote["observedExampleConfigs"][0]["symbol"], "USDG")
        stock_base = recommendations["V1-G0-OFFICIAL-STOCK-BASE-01"]
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
        launch_fee = recommendations["V1-G0-LAUNCH-FRICTION-01"]
        self.assertEqual(launch_fee["asset"], "NATIVE")
        self.assertEqual(int(launch_fee["amountRaw"]), 500_000_000_000_000)
        self.assertEqual(
            launch_fee["mutability"], "IMMUTABLE_PER_FACTORY_AND_EXECUTION_SPEC"
        )
        anti_snipe = recommendations["V1-G0-ANTI-SNIPE-01"]
        self.assertIsNone(anti_snipe["maxShareBpsOfGraduationThreshold"])
        self.assertFalse(anti_snipe["arbitraryTeamExemptionArray"])
        self.assertEqual(anti_snipe["runtimeAntiSnipeVectorStatus"], "VERIFIED")
        self.assertEqual(anti_snipe["rawBpsByElapsedSecond"], [9900, 618, 19])
        batch = recommendations["V1-G0-BATCH-01"]
        self.assertEqual(batch["status"], "APPROVED_OUT_OF_SCOPE_V1_INITIAL_RELEASE")
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
