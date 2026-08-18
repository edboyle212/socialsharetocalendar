import { describe, it, expect } from "vitest";
import { verifyMetaSignature, hashUser } from "../src/lib/crypto.js";

async function metaSig(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  let hex = "";
  for (const b of sig) hex += b.toString(16).padStart(2, "0");
  return `sha256=${hex}`;
}

describe("meta signature verification", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ hello: "world" });

  it("accepts a valid signature", async () => {
    const header = await metaSig(secret, body);
    expect(await verifyMetaSignature(secret, header, body)).toBe(true);
  });

  it("rejects a bad signature", async () => {
    expect(await verifyMetaSignature(secret, "sha256=deadbeef", body)).toBe(false);
  });

  it("rejects a missing header", async () => {
    expect(await verifyMetaSignature(secret, null, body)).toBe(false);
  });

  it("hashUser is deterministic and salted", async () => {
    const a = await hashUser("salt", "user-1");
    const b = await hashUser("salt", "user-1");
    const c = await hashUser("other-salt", "user-1");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
