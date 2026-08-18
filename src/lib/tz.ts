// Naive-local → real-instant conversion using the Worker's built-in
// Intl.DateTimeFormat. Two-pass to handle DST transition minutes
// (Sept in Berlin, March in NYC etc.). Good enough for a share-a-flyer
// use case; not for scheduling logic that has to be exact across a DST
// leap. No third-party TZ database ships with the Worker.

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;

export function isNaiveIso(s: string): boolean {
  return !OFFSET_RE.test(s);
}

export function isValidIana(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

// Minutes east of UTC for the given IANA zone at the given instant.
// e.g. America/New_York in July → -240 (EDT).
export function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second ?? "0"),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

// naive: "YYYY-MM-DDTHH:mm[:ss]" (no offset). Returns real UTC ISO.
// Two-pass so a DST-boundary naive local still lands on the right side.
export function naiveToUtcIso(naive: string, tz: string): string {
  const parts = parseNaive(naive);
  if (!parts) throw new Error(`bad naive iso: ${naive}`);
  const provisional = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s);
  const off1 = tzOffsetMinutes(tz, new Date(provisional));
  let utc = provisional - off1 * 60_000;
  const off2 = tzOffsetMinutes(tz, new Date(utc));
  if (off2 !== off1) utc = provisional - off2 * 60_000;
  return new Date(utc).toISOString();
}

interface NaiveParts { y: number; mo: number; d: number; h: number; mi: number; s: number }

function parseNaive(s: string): NaiveParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: m[6] ? Number(m[6]) : 0,
  };
}

// Normalize a possibly-naive start/end pair against an optional TZ.
// Rules:
//   * If already has an offset → keep as-is.
//   * If naive + valid TZ → resolve to UTC.
//   * If naive + no TZ → keep naive; caller renders as floating time.
export interface NormalizedTime {
  iso: string;
  floating: boolean;    // no fixed instant; renders as local-to-viewer
  assumedTz?: string;   // the TZ we used to resolve, when we did
}

export function normalizeTime(input: string, tz: string | undefined): NormalizedTime {
  if (!isNaiveIso(input)) return { iso: input, floating: false };
  if (tz && isValidIana(tz)) {
    return { iso: naiveToUtcIso(input, tz), floating: false, assumedTz: tz };
  }
  return { iso: input, floating: true };
}
