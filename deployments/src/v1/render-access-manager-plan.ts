import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { deriveV1AccessManagerPlan, type V1AccessManagerPlanInput } from "./access-manager-plan.ts";

const inputPath = process.argv[2]?.trim();
if (!inputPath) {
  throw new Error("Usage: render-access-manager-plan.ts <signed-input.json>");
}

const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as V1AccessManagerPlanInput;
const plan = deriveV1AccessManagerPlan(input);
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
