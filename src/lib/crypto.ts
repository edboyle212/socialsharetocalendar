const enc = new TextEncoder();

export async function verifyMetaSignature(
  secret: string,
  header: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const got = toHex(new Uint8Array(sig));
  return timingSafeEqual(expected, got);
}

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(new Uint8Array(sig));
}

export async function sha256Hex(payload: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(payload));
  return toHex(new Uint8Array(buf));
}

export async function hashUser(salt: string, senderId: string): Promise<string> {
  return sha256Hex(`${salt}:${senderId}`);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
