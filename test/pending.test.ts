import { describe, it, expect } from "vitest";
import { savePending, loadPending, clearPending, type PendingParse } from "../src/lib/pending.js";
import type { Env } from "../src/env.js";

// Minimal in-memory KV stand-in that matches the two calls pending.ts
// actually uses. Enough to prove round-trip + clear behavior.
function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, kind?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return kind === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function envWith(kv: KVNamespace): Env {
  return { RATE_KV: kv } as unknown as Env;
}

describe("pending-parse store", () => {
  const uh = "user-hash-abc";
  const val: PendingParse = {
    event: { title: "Show", start: "2026-09-14T20:00:00", confidence: 0.5 },
    ctx: { permalink: "https://ig/p/x", username: "someone" },
    createdAt: 1_700_000_000_000,
  };

  it("round-trips through save/load", async () => {
    const env = envWith(fakeKv());
    await savePending(env, uh, val);
    const got = await loadPending(env, uh);
    expect(got?.event.title).toBe("Show");
    expect(got?.ctx.permalink).toBe("https://ig/p/x");
  });

  it("returns null when nothing is pending", async () => {
    const env = envWith(fakeKv());
    expect(await loadPending(env, uh)).toBeNull();
  });

  it("clearPending removes the entry", async () => {
    const env = envWith(fakeKv());
    await savePending(env, uh, val);
    await clearPending(env, uh);
    expect(await loadPending(env, uh)).toBeNull();
  });
});
