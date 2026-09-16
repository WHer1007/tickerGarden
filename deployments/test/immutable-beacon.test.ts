import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifiedImmutableBeacon } from "../src/v1/immutable-beacon.ts";

test("both complete Beacon programs reject every non-address byte mutation", () => {
  const catalog = JSON.parse(readFileSync(new URL("../../spec/v1_beacon_proxy_templates.json", import.meta.url), "utf8"));
  const beacon = `0x${"11".repeat(20)}`;
  for (const template of catalog.templates) {
    const raw = Buffer.from(template.normalizedRuntime.slice(2), "hex");
    Buffer.from(beacon.slice(2), "hex").copy(raw, 41);
    assert.equal(verifiedImmutableBeacon(`0x${raw.toString("hex")}`), beacon);
    assert.equal(verifiedImmutableBeacon(`0x${raw.toString("hex")}00`), undefined);
    for (let index = 0; index < raw.length; index++) {
      if (index >= 41 && index <= 60) continue;
      const changed = Buffer.from(raw);
      changed[index] = changed[index]! ^ 1;
      assert.equal(verifiedImmutableBeacon(`0x${changed.toString("hex")}`), undefined, `byte ${index}`);
    }
  }
});
