import type { ParsedEvent } from "./parse.js";
import { hmacHex } from "./crypto.js";

export interface CalendarContext {
  permalink?: string;
  username?: string;
}

export interface CalendarPayload {
  title: string;
  start: string;         // ISO (UTC when fixed, or naive local when floating)
  end: string;           // same
  floating: boolean;     // true → no fixed instant, calendar renders in viewer's TZ
  location: string;
  description: string;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function buildPayload(
  event: ParsedEvent,
  ctx: CalendarContext,
  opts: { floating?: boolean } = {},
): CalendarPayload | null {
  if (!event.start) return null;
  const floating = !!opts.floating;
  const start = event.start;
  const end = event.end ?? addDefaultDuration(start, floating);
  const noteLines: string[] = [];
  if (ctx.permalink) noteLines.push(`Shared from Instagram: ${ctx.permalink}`);
  if (ctx.username) noteLines.push(`Posted by @${ctx.username}`);
  return {
    title: event.title ?? "Event from Instagram",
    start,
    end,
    floating,
    location: event.location ?? "",
    description: noteLines.join("\n"),
  };
}

function addDefaultDuration(startIso: string, floating: boolean): string {
  if (!floating) {
    return new Date(new Date(startIso).getTime() + DEFAULT_DURATION_MS).toISOString();
  }
  const m = NAIVE_ISO.exec(startIso);
  if (!m) return startIso;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const h = Number(m[4]), mi = Number(m[5]), s = m[6] ? Number(m[6]) : 0;
  const t = Date.UTC(y, mo - 1, d, h, mi, s) + DEFAULT_DURATION_MS;
  const dt = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

// Google Calendar TEMPLATE URL: `YYYYMMDDTHHMMSSZ` for a fixed UTC
// instant, or `YYYYMMDDTHHMMSS` (no Z) for floating local time.
export function googleCalendarUrl(p: CalendarPayload): string {
  const dates = `${toGCalTime(p.start, p.floating)}/${toGCalTime(p.end, p.floating)}`;
  const qs = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    dates,
    details: p.description,
    location: p.location,
  });
  return `https://calendar.google.com/calendar/render?${qs.toString()}`;
}

function toGCalTime(iso: string, floating: boolean): string {
  if (floating) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
    if (!m) throw new Error(`bad naive iso: ${iso}`);
    return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? "00"}`;
  }
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildIcs(p: CalendarPayload, uid: string): string {
  const dtstamp = toGCalTime(new Date().toISOString(), false);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ig-share2calendar//MVP//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toGCalTime(p.start, p.floating)}`,
    `DTEND:${toGCalTime(p.end, p.floating)}`,
    `SUMMARY:${escapeIcs(p.title)}`,
    `LOCATION:${escapeIcs(p.location)}`,
    `DESCRIPTION:${escapeIcs(p.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

// Signed compact token containing the payload so the ICS/redirect route
// stays stateless. Base64url(JSON) + "." + hmac(secret, payload).
export async function signToken(secret: string, obj: unknown): Promise<string> {
  const json = JSON.stringify(obj);
  const b64 = base64UrlEncode(new TextEncoder().encode(json));
  const sig = (await hmacHex(secret, b64)).slice(0, 32);
  return `${b64}.${sig}`;
}

export async function verifyToken<T>(secret: string, token: string): Promise<T | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = (await hmacHex(secret, b64)).slice(0, 32);
  if (!ctEq(sig, expected)) return null;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(b64));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
