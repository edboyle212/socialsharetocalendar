// Meta "data deletion callback" posts a signed_request of the form
//   <sig>.<payload>
// where both parts are base64url and sig = HMAC-SHA256(secret, payload).
// Payload JSON contains { algorithm: "HMAC-SHA256", user_id, issued_at }.

import { hmacHex } from "./crypto.js";

export interface SignedPayload {
  algorithm?: string;
  user_id?: string;
  issued_at?: number;
}

export async function parseSignedRequest(
  secret: string,
  signedRequest: string,
): Promise<SignedPayload | null> {
  const dot = signedRequest.indexOf(".");
  if (dot < 0) return null;
  const sigB64 = signedRequest.slice(0, dot);
  const payloadB64 = signedRequest.slice(dot + 1);
  const expected = await hmacHex(secret, payloadB64);
  const provided = bytesToHex(base64UrlDecode(sigB64));
  if (!ctEq(provided, expected)) return null;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const p = JSON.parse(json) as SignedPayload;
    if (p.algorithm && p.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return p;
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
