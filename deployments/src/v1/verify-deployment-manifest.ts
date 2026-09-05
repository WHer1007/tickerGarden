import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { HttpV1ReadOnlyRpc, preflightV1Deployment } from "./preflight.ts";

const manifestPath = process.argv[2]?.trim();
if (!manifestPath) {
  throw new Error("Usage: verify-deployment-manifest.ts <deployed-manifest.json>");
}

const rpcUrl = process.env.V1_DEPLOYMENT_RPC_URL?.trim();
if (!rpcUrl) throw new Error("V1_DEPLOYMENT_RPC_URL is required");

const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as unknown;
const report = await preflightV1Deployment(manifest, new HttpV1ReadOnlyRpc(rpcUrl));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
