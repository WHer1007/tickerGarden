import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendClientPath = resolve(websiteRoot, "../backend/src/generated/v2-client.ts");
const outputPath = resolve(websiteRoot, "src/v2/generated/read-api.ts");
const check = process.argv.includes("--check");
const backendClient = await readFile(backendClientPath, "utf8");
const output = backendClient.replace(
  "// Generated from openapi/v2.json by scripts/generate-openapi.mjs. Do not edit.",
  "// Synced from Backend's generated OpenAPI client by scripts/sync-v2-read-client.mjs. Do not edit.",
);

if (check) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== output) throw new Error("generated Backend read client is stale; run npm run generate:client");
} else {
  await writeFile(outputPath, output);
}
