import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HttpV1ReadOnlyRpc } from "../deployments/src/v1/preflight.ts";
import { loadV1TestnetDeploymentPlan, verifyV1TestnetDeploymentPlanLive } from "../deployments/src/v1/testnet-plan.ts";
const plan = loadV1TestnetDeploymentPlan("arbitrum-sepolia");
const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() || plan.chain.rpcUrl;
// Verify chain, pinned header hashes, exact dependency code, and bindings before Foundry reads state.
console.log(JSON.stringify(await verifyV1TestnetDeploymentPlanLive(plan, new HttpV1ReadOnlyRpc(rpc))));
const result = spawnSync(process.execPath, ["tools/run-forge.mjs", "test", "--match-path",
  "test/v1/fork/V1ArbitrumSepoliaForkE2E.t.sol", "--fork-url", rpc,
  "--fork-block-number", plan.chain.latestSnapshot.number, "-vv"],
  { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
