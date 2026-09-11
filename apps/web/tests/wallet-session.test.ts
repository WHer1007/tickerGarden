import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizedWalletAccount, createWalletSession } from "../src/ui/wallet-session.ts";

const address = `0x${"ab".repeat(20)}`;
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function provider(accounts: unknown = [address], chain = "0xb626") {
  const methods: string[] = [];
  return { methods, async request({ method }: { method: string }) { methods.push(method); return method === "eth_accounts" ? accounts : chain; } };
}

test("reload restores only the selected provider using silent live authorization", async () => {
  const store = storage();
  createWalletSession(store, async () => {}).remember("io.metamask");
  let restored: string | null = null;
  const session = createWalletSession(store, async (p, current) => {
    const account = await authorizedWalletAccount(p, 46630);
    if (current()) restored = account;
  });
  const other = provider();
  await session.discovered("app.phantom", other);
  assert.deepEqual(other.methods, []);
  const selected = provider();
  await session.discovered("io.metamask", selected);
  await session.discovered("io.metamask", selected);
  assert.equal(restored, address);
  assert.deepEqual(selected.methods, ["eth_chainId", "eth_accounts"]);
});

test("locked, revoked, wrong-chain and malformed account responses do not restore", async () => {
  for (const p of [provider([]), provider([address], "0x1"), provider(["not-an-address"]), provider(null)]) {
    assert.equal(await authorizedWalletAccount(p, 46630), null);
    assert.ok(!p.methods.includes("eth_requestAccounts"));
  }
});

test("explicit disconnect persists and cancels an outstanding restore", async () => {
  const store = storage();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let restored = false;
  const session = createWalletSession(store, async (_, current) => { await gate; restored = current(); });
  session.remember("io.metamask");
  const pending = session.discovered("io.metamask", provider());
  session.forget(); release(); await pending;
  assert.equal(restored, false);
  await createWalletSession(store, async () => { restored = true; }).discovered("io.metamask", provider());
  assert.equal(restored, false);
});

test("manual wallet selection supersedes a pending restore", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let restored = false;
  const session = createWalletSession(storage(), async (_, current) => { await gate; restored = current(); });
  session.remember("io.metamask");
  const pending = session.discovered("io.metamask", provider());
  session.cancelRestore(); session.remember("app.phantom"); release(); await pending;
  assert.equal(restored, false);
});

test("provider rejection and unavailable storage are nonfatal", async () => {
  const blocked = { getItem(): null { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  const session = createWalletSession(blocked, async () => { throw Error("locked"); });
  session.remember("io.metamask");
  await session.discovered("io.metamask", provider());
  session.forget();
});

test("a failed restore can retry after the provider announces again without duplicate in-flight restores", async () => {
  let attempts = 0;
  const session = createWalletSession(storage(), async () => {
    attempts++;
    await Promise.resolve();
    if (attempts === 1) throw Error("temporarily locked");
  });
  session.remember("io.metamask");
  const p = provider();
  const first = session.discovered("io.metamask", p);
  const duplicate = session.discovered("io.metamask", p);
  await Promise.all([first, duplicate]);
  assert.equal(attempts, 1);
  await session.discovered("io.metamask", p);
  await session.discovered("io.metamask", p);
  assert.equal(attempts, 2);
});
