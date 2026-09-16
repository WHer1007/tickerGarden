import assert from "node:assert/strict";
import test from "node:test";
import { clearCreateDraft, readCreateDraft, writeCreateDraft, type DraftStorage } from "../src/create/draft.ts";

function storage(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

test("persists only the whitelisted create draft and separates chains", () => {
  const s = storage();
  assert.equal(writeCreateDraft(s, 4663, { name: "Garden", symbol: "GDN", description: "hello", creatorTax: "2.5", quoteAssetConfigId: "q", stakingEnabled: true, hadImage: true, secret: "omit" } as never), true);
  assert.deepEqual(readCreateDraft(s, 4663), { version: 1, chainId: 4663, name: "Garden", symbol: "GDN", description: "hello", creatorTax: "2.5", quoteAssetConfigId: "q", stakingEnabled: true, hadImage: true });
  assert.equal(readCreateDraft(s, 46630), null);
});

test("malformed, wrong-version, and oversized drafts restore as null or fail safely", () => {
  const s = storage();
  s.setItem("tickergarden:create-draft:v1:4663", "not json");
  assert.equal(readCreateDraft(s, 4663), null);
  s.setItem("tickergarden:create-draft:v1:4663", JSON.stringify({ version: 1, chainId: 4663, hadImage: false, description: "x".repeat(20_000) }));
  assert.equal(readCreateDraft(s, 4663), null);
  s.setItem("tickergarden:create-draft:v1:4663", "[]");
  assert.equal(readCreateDraft(s, 4663), null);
  assert.equal(writeCreateDraft(s, 4663, { description: "x".repeat(20_000) }), false);
});

test("storage failures are nonfatal and clear removes the draft", () => {
  const s: DraftStorage = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("quota"); }, removeItem: () => { throw Error("blocked"); } };
  assert.equal(readCreateDraft(s, 4663), null);
  assert.equal(writeCreateDraft(s, 4663, { name: "X" }), false);
  assert.doesNotThrow(() => clearCreateDraft(s, 4663));
});
