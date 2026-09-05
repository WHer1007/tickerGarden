import { HttpV1ReadOnlyRpc } from "./preflight.ts";
import { verifyV1TestnetDeploymentPlanLive, v1TestnetDeploymentPlan } from "./testnet-plan.ts";

const rpcUrl = process.env.ROBINHOOD_TESTNET_RPC_URL?.trim() ||
  String((v1TestnetDeploymentPlan.chain as Record<string, unknown>).rpcUrl);
const report = await verifyV1TestnetDeploymentPlanLive(
  v1TestnetDeploymentPlan,
  new HttpV1ReadOnlyRpc(rpcUrl),
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
