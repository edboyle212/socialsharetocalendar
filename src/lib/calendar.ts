import type { ParsedEvent } from "./parse.js";
import { hmacHex } from "./crypto.js";

export interface CalendarContext {
  permalink?: string;
  username?: string;
}

export interface CalendarPayload {
  title: string;
  start: string; // ISO
  end: string;   // ISO
  location: string;
  description: string;
}

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export function buildPayload(event: ParsedEvent, ctx: CalendarContext): CalendarPayload | null {
  if (!event.start) return null;
  const start = event.start;
  const end = event.end ?? new Date(new Date(start).getTime() + DEFAULT_DURATION_MS).toISOString();
  const noteLines: string[] = [];
  if (ctx.permalink) noteLines.push(`Shared from Instagram: ${ctx.permalink}`);
  if (ctx.username) noteLines.push(`Posted by @${ctx.username}`);
  return {
    title: event.title ?? "Event from Instagram",
    start,
    end,
    location: event.location ?? "",
    description: noteLines.join("\n"),
  };
}

// Google Calendar TEMPLATE URL expects YYYYMMDDTHHMMSSZ (UTC) or floating local.
export function googleCalendarUrl(p: CalendarPayload): string {
  const dates = `${toGCalTime(p.start)}/${toGCalTime(p.end)}`;
  const qs = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    dates,
    details: p.description,
    location: p.location,
  });
  return `https://calendar.google.com/calendar/render?${qs.toString()}`;
}

function toGCalTime(iso: string): string {
  const d = new Date(iso);
  const s = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return s;
}

export function buildIcs(p: CalendarPayload, uid: string): string {
  const dtstamp = toGCalTime(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ig-share2calendar//MVP//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toGCalTime(p.start)}`,
    `DTEND:${toGCalTime(p.end)}`,
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
