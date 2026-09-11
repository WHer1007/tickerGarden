import json
import unittest
import re
from spec.generate_v1_hash_vectors import keccak256
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "contracts" / "src" / "v1"
ARTIFACT_ROOT = ROOT / "contracts" / "out-v1"


class CurrentContractSurfaceTest(unittest.TestCase):
    def test_retired_source_surface_is_absent(self):
        source = "\n".join(
            path.read_text(encoding="utf-8")
            for path in SOURCE_ROOT.rglob("*.sol")
        )
        for token in (
            "TreasuryDistributorV1",
            "TreasuryClaimLeaf",
            "ProtocolFeeVaultRewardSettlement",
            "claimCreator(",
            "claimStaker(",
            "claimStakerFor(",
            "RAW_EXIT_DELAY",
            "settlementOperator(",
            "setSettlementOperator(",
            "settleRewards(",
            "settleHolderRewards(",
            "consumeForConversion(",
            "creditConversion(",
            "burnTreasury(",
            "recordRewardPrice(",
            "rewardPriceWindow",
        ):
            self.assertNotIn(token, source, token)

    def _abi(self, name):
        path = ARTIFACT_ROOT / f"{name}.sol" / f"{name}.json"
        self.assertTrue(path.exists(), f"missing freshly compiled artifact: {path}")
        return json.loads(path.read_text(encoding="utf-8"))["abi"]

    def test_current_compiled_abis_have_only_current_claim_and_conversion_surface(self):
        fee = {self._signature(entry): entry for entry in self._abi("ProtocolFeeVault") if entry.get("type") == "function"}
        holder = {self._signature(entry): entry for entry in self._abi("HolderRewardsDistributorV1") if entry.get("type") == "function"}
        gauge = {self._signature(entry): entry for entry in self._abi("MemeStockGauge") if entry.get("type") == "function"}
        allocation = {self._signature(entry): entry for entry in self._abi("AllocationManager") if entry.get("type") == "function"}
        vault = {self._signature(entry): entry for entry in self._abi("UserStockVault") if entry.get("type") == "function"}
        hook = {self._signature(entry): entry for entry in self._abi("TickerGardenMemeHook") if entry.get("type") == "function"}
        token = {self._signature(entry): entry for entry in self._abi("TickerMemeTokenV1") if entry.get("type") == "function"}

        self.assertIn("claimUserRewards(bytes32,uint8,uint32,bool,bool,uint256)", fee)
        self.assertIn("claimUserRewardAssets(bytes32,uint8,uint32,uint8,bool,bool,uint256)", fee)
        self.assertIn("consumeClaimableAssets(address,uint8)", gauge)
        self.assertIn("consumeUserRewardAssets(bytes32,address,uint8)", holder)
        self.assertIn("restoreUserMemeRewards(address,uint256)", gauge)
        self.assertIn("consumeClaimable(address)", gauge)
        self.assertEqual(len(gauge["consumeClaimable(address)"]["outputs"]), 2)
        self.assertNotIn("consumeClaimable(address,address)", gauge)
        self.assertIn("convertRewards(bytes32,uint256,uint256)", hook)
        self.assertIn("platformTreasury()", fee)
        for signature in fee | holder | gauge | allocation | vault | hook | token:
            self.assertNotIn("claimCreator", signature)
            self.assertNotIn("claimStaker", signature)
            self.assertNotIn("consumeForConversion", signature)
            self.assertNotIn("creditConversion", signature)
            self.assertNotIn("burnTreasury", signature)
            self.assertNotIn("setSettlementOperator", signature)
            self.assertNotIn("settlementOperator", signature)
            self.assertNotIn("settleRewards", signature)
            self.assertNotIn("settleHolderRewards", signature)
            self.assertNotIn("RAW_EXIT_DELAY", signature)

        rage_quit = gauge["rageQuit(address)"]
        self.assertEqual(len(rage_quit["outputs"]), 3)
        self.assertEqual(len(allocation["rageQuitRewardCutoff(bytes32,address)"]["outputs"]), 3)
        self.assertEqual(len(vault["rageQuitRewardCutoff(bytes32,address,bytes32)"]["outputs"]), 3)

    def test_factory_pins_exact_current_implementation_bytecode(self):
        factory = (SOURCE_ROOT / "modules/TickerGardenFactoryV1.sol").read_text()
        for constant, file, name in (
            ("TOKEN", "TickerGardenFactoryV1", "TickerMemeTokenV1Implementation"),
            ("CURVE", "TickerGardenFactoryV1", "TickerGardenCurveImplementation"),
            ("GAUGE", "MemeStockGauge", "MemeStockGauge"),
        ):
            artifact = json.loads((ARTIFACT_ROOT / f"{file}.sol/{name}.json").read_text())
            code = artifact["deployedBytecode"]["object"].removeprefix("0x")
            expected = "0x" + keccak256(bytes.fromhex(code)).hex()
            match = re.search(constant + r"_IMPLEMENTATION_CODEHASH\s*=\s*(0x[0-9a-fA-F]{64})", factory)
            self.assertIsNotNone(match, constant)
            self.assertEqual(match[1].lower(), expected, constant)

    @staticmethod
    def _signature(entry):
        types = [item["type"] for item in entry.get("inputs", [])]
        return f"{entry['name']}({','.join(types)})"


if __name__ == "__main__":
    unittest.main()
