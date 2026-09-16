import assert from "node:assert/strict";
import { test } from "node:test";
import create from "../src/pages/create.ts";
import home from "../src/pages/home.ts";
import staking from "../src/pages/staking.ts";

test("pages describe current holder snapshots and fee sharing", () => {
  assert.match(create.html, /exactly 50% of the creator base-fee share/);
  assert.match(create.html, /excluding creator tax/);
  assert.match(create.html, /wallet balances at published snapshots/);
  assert.match(create.html, /no fixed payout schedule/i);
  assert.match(create.html, /paired asset purchase/);
  assert.doesNotMatch(home.html, /wallet balance snapshots/);
  assert.match(staking.html, /Rewards are paid in the original Quote and created token assets/);
  assert.doesNotMatch(staking.html, /conversion is never automatic/);
  assert.match(staking.html, /full 24-hour lock/);
});
