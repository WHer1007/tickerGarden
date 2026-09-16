import { HttpV1ReadOnlyRpc } from "./preflight.ts";
import { verifyV1TestnetDeploymentPlanLive, loadV1TestnetDeploymentPlan } from "./testnet-plan.ts";

const target = process.env.V1_TESTNET_TARGET ?? "robinhood-testnet";
const plan = loadV1TestnetDeploymentPlan(target);
const rpcUrl = (target === "arbitrum-sepolia" ? process.env.ARBITRUM_SEPOLIA_RPC_URL : process.env.ROBINHOOD_TESTNET_RPC_URL)?.trim()
  || String((plan.chain as Record<string, unknown>).rpcUrl);
const report = await verifyV1TestnetDeploymentPlanLive(plan, new HttpV1ReadOnlyRpc(rpcUrl));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
