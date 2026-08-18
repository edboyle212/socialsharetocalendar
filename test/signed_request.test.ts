import { describe, it, expect } from "vitest";
import { parseSignedRequest } from "../src/lib/signed_request.js";

async function buildSigned(secret: string, payload: object): Promise<string> {
  const enc = new TextEncoder();
  const json = JSON.stringify({ algorithm: "HMAC-SHA256", ...payload });
  const b64 = base64UrlEncode(enc.encode(json));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(b64)));
  const sigB64 = base64UrlEncode(sig);
  return `${sigB64}.${b64}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("parseSignedRequest", () => {
  const secret = "app-secret";

  it("verifies a well-formed Meta signed_request", async () => {
    const signed = await buildSigned(secret, { user_id: "u-42", issued_at: 100 });
    const p = await parseSignedRequest(secret, signed);
    expect(p?.user_id).toBe("u-42");
  });

  it("rejects a wrong secret", async () => {
    const signed = await buildSigned(secret, { user_id: "u-42" });
    expect(await parseSignedRequest("wrong", signed)).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await parseSignedRequest(secret, "not-a-signed-request")).toBeNull();
  });
});
