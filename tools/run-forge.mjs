import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = path.join(repositoryRoot, "contracts");
const forgeArguments = process.argv.slice(2);

if (forgeArguments.length === 0) {
  throw new Error("usage: node tools/run-forge.mjs <forge arguments>");
}

const executableCandidates = [
  process.env.FOUNDRY_FORGE,
  "forge",
  path.join(homedir(), ".foundry", "bin", "forge"),
].filter(Boolean);

for (const foundryExecutable of executableCandidates) {
  const result = spawnSync(foundryExecutable, forgeArguments, {
    cwd: contractsRoot,
    env: { ...process.env, FOUNDRY_PROFILE: "v2" },
    stdio: "inherit",
  });

  if (result.error?.code === "ENOENT") continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

throw new Error(
  "forge was not found. Install Foundry or set FOUNDRY_FORGE to the forge executable path.",
);
