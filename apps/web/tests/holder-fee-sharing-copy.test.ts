import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const create = read("../src/pages/create.ts");
const rewards = read("../src/pages/rewards.ts");
const docs = read("../src/pages/docs.ts");
const terms = read("../src/pages/terms.ts");

test("holder fee sharing uses the approved feature label and creation semantics", () => {
  const label = "Holder fee sharing";
  for (const page of [create, docs, terms]) assert.ok(page.includes(label));
  assert.match(rewards, /Holder rewards/);
  assert.match(create, /Share 50% of base fees with holders/i);
  assert.match(create, /Creator tax stays yours. Permanent at launch/i);
  assert.match(create, /claim rewards after settlement/i);
  assert.match(create, /Payouts may be delayed/i);
  assert.doesNotMatch(create, /Request a treasury|Registration and funding happen separately|no fees are automatically redirected/i);
  assert.doesNotMatch(create, /give up all creator base fee share|all creator base fee share and creator tax/i);
});
