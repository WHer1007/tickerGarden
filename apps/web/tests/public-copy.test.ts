import assert from "node:assert/strict";
import { test } from "node:test";
import { publicMessage } from "../src/ui/public-copy.ts";

test("implementation diagnostics use public product names without changing amounts or addresses", () => {
  assert.equal(publicMessage("VITE_V1_READ_API_URL is missing"), "Market data service is not configured");
  assert.equal(publicMessage("VITE_V1_TREASURY_PROOF_API_URL is missing"), "Reward proof service is not configured");
  assert.equal(publicMessage("UserStockVaultV1: V1 runtime is unavailable"), "UserStockVault: runtime is unavailable");
  const detail = "12.5 STOCK at 0x1111111111111111111111111111111111111111";
  assert.equal(publicMessage(detail), detail);
  assert.doesNotMatch(publicMessage("V1-EXEC-9 configuration mismatch"), /V1/);
});

test("market phase diagnostics use Growing and Bloomed without changing protocol identifiers", () => {
  assert.equal(publicMessage("not-graduated curve; graduated pool; ready to graduate"), "Growing curve; Bloomed pool; ready to bloom");
  const internal = "graduationThreshold readyToGraduate NOT_GRADUATED GraduationExecutor";
  assert.equal(publicMessage(internal), internal);
});

test("transport failures hide RPC URLs and calldata without hiding contract errors", () => {
  const raw='HTTP request failed. URL: https://rpc.example/private-key Request body: {"method":"eth_call"} Raw Call Arguments: 0x1234 Details: Failed to fetch';
  assert.equal(publicMessage(raw), 'Network connection unavailable. Please try again shortly.');
  assert.equal(publicMessage('Failed to fetch'), 'Network connection unavailable. Please try again shortly.');
  assert.equal(publicMessage('Contract reverted: InsufficientBalance'), 'Contract reverted: InsufficientBalance');
});
