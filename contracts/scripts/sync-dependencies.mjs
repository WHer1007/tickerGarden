import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const contractsRoot = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(new URL("dependencies.lock.json", contractsRoot), "utf8"));
const checkOnly = process.argv.includes("--check");

function run(command, args, cwd = contractsRoot) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

async function directoryExists(path) {
  try {
    await access(new URL(`${path}/.git`, contractsRoot));
    return true;
  } catch {
    return false;
  }
}

async function ensureRepository(name, path) {
  const dependency = lock.dependencies[name];
  if (!(await directoryExists(path))) {
    if (checkOnly) throw new Error(`${path} is missing`);
    run("git", ["clone", dependency.repository, path]);
    run("git", ["-C", path, "checkout", dependency.commit]);
  }

  const actual = run("git", ["-C", path, "rev-parse", "HEAD"]);
  if (actual !== dependency.commit) {
    throw new Error(`${path} drift: expected ${dependency.commit}, received ${actual}`);
  }
}

await ensureRepository("forge-std", "lib/forge-std");
await ensureRepository("openzeppelin-contracts", "lib/openzeppelin-contracts");
await ensureRepository("v4-periphery", "lib/v4-periphery");

if (!checkOnly) run("git", ["-C", "lib/v4-periphery", "submodule", "update", "--init", "--recursive"]);

for (const [name, path] of [
  ["v4-core", "lib/v4-periphery/lib/v4-core"],
  ["permit2", "lib/v4-periphery/lib/permit2"],
]) {
  const expected = lock.dependencies[name].commit;
  const actual = run("git", ["-C", path, "rev-parse", "HEAD"]);
  if (actual !== expected) throw new Error(`${path} drift: expected ${expected}, received ${actual}`);
}

console.log("contract dependency lock verified");

