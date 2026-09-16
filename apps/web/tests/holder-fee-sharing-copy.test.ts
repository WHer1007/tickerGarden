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
  assert.match(create, /50% of the creator base-fee share/i);
  assert.match(create, /excluding creator tax/i);
  assert.match(create, /claim the original paired asset and created token after publication/i);
  assert.match(create, /no fixed payout schedule/i);
  assert.doesNotMatch(create, /Request a treasury|Registration and funding happen separately|no fees are automatically redirected/i);
  assert.doesNotMatch(create, /give up all creator base fee share|all creator base fee share and creator tax/i);
});

test("docs separate holder eligibility, release timing and asset choices", () => {
  for (const heading of ["Who Earns Holder Rewards?", "When Can I Claim Holder Rewards?", "Which Reward Assets Can I Claim?"]) {
    assert.ok(docs.includes(heading));
  }
  assert.doesNotMatch(docs, /How Does Holder Fee Sharing Work\?/);
  assert.match(docs, /starting minimum is 0\.5/i);
  assert.match(docs, /Holder rewards use periodic records of direct wallet balances/i);
  assert.match(docs, /LP and other indirect holdings are excluded/i);
  assert.match(docs, /without automatically exchanging one asset for another/i);
  assert.doesNotMatch(docs, /10–20 minutes/);
  assert.match(docs, /signature does not launch the token or approve asset spending/i);
  assert.match(docs, /emergency exit can return the full allocated Stock Token principal without waiting/i);
  assert.match(docs, /permanently forfeits every unclaimed paired-asset and created-token reward/i);
  assert.match(docs, /Emergency exit is not available through the app/i);
});
