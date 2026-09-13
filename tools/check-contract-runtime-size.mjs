import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

export const EIP170_LIMIT = 24_576;
export const MODULE_BUDGETS = Object.freeze({ Factory: 24_000, FeeVault: 23_500 });

export function checkRuntimeSize(runtimeBytes, budget = EIP170_LIMIT) {
  if (!Number.isInteger(runtimeBytes) || runtimeBytes <= 0) throw new Error("runtime size must be a positive integer");
  if (!Number.isInteger(budget) || budget <= 0) throw new Error("budget must be a positive integer");
  if (runtimeBytes > EIP170_LIMIT) throw new Error(`runtime size ${runtimeBytes} exceeds EIP-170 limit ${EIP170_LIMIT}`);
  if (runtimeBytes > budget) throw new Error(`runtime size ${runtimeBytes} exceeds budget ${budget}`);
  return { runtimeBytes, budget, headroom: budget - runtimeBytes };
}

function readRuntimeBytes(file) {
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  const hex = artifact.deployedBytecode?.object;
  if (typeof hex !== "string" || hex.length < 3 || !hex.startsWith("0x") || hex.length % 2 || !/^0x[0-9a-f]+$/i.test(hex)) {
    throw new Error(`invalid deployed runtime bytecode in ${file}`);
  }
  return (hex.length - 2) / 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const aliases = {TickerGardenFactoryV1:"Factory",ProtocolFeeVault:"FeeVault"};
  const modules = fs.readdirSync(path.join(root,"contracts/src/v1/modules")).filter(x=>x.endsWith(".sol")).sort().map(file=>{
    const module = file.slice(0,-4);
    return [aliases[module] ?? module, path.join(root,"contracts/out-v1",file,module+".json")];
  });
  try {
    for (const [name, file] of modules) {
      const result = checkRuntimeSize(readRuntimeBytes(file), MODULE_BUDGETS[name] ?? EIP170_LIMIT);
      console.log(`${name}: ${result.runtimeBytes} bytes (headroom ${result.headroom})`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
