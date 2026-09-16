import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../../../spec/v1_beacon_proxy_templates.json", import.meta.url), "utf8")) as {
  immutableWordOffset: number;
  templates: { normalizedRuntime: string }[];
};

/** Match the complete reviewed program, normalizing only its fixed immutable address word. */
export function verifiedImmutableBeacon(runtime: string): string | undefined {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(runtime)) return undefined;
  const raw = runtime.slice(2).toLowerCase();
  const offset = catalog.immutableWordOffset * 2;
  const word = raw.slice(offset, offset + 64);
  if (word.length !== 64 || !word.startsWith("0".repeat(24)) || BigInt(`0x${word}`) === 0n) return undefined;
  const normalized = `0x${raw.slice(0, offset)}${"0".repeat(64)}${raw.slice(offset + 64)}`;
  if (!catalog.templates.some((template) => template.normalizedRuntime === normalized)) return undefined;
  return `0x${word.slice(24)}`;
}
