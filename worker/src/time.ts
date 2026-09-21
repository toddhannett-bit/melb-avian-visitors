/**
 * Everything here works in the station's local zone (Australia/Melbourne).
 *
 * The upstream PHP took "today" from SQLite's localtime rather than PHP's
 * clock, with a comment explaining that a UTC-defaulted Pi puts a US station
 * a day ahead every evening and the ledger reads empty. We have the same
 * hazard in reverse: a Worker runs in UTC, and Melbourne is 10-11 hours
 * ahead, so a naive UTC date is *yesterday* for most of the local day.
 */

const pad = (n: number) => String(n).padStart(2, '0');

interface Parts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

function partsIn(tz: string, at: Date): Parts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const got: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== 'literal') got[p.type] = p.value;
  }
  return {
    year: +got.year!, month: +got.month!, day: +got.day!,
    // Intl can emit "24" for midnight in some engines.
    hour: +got.hour! % 24, minute: +got.minute!, second: +got.second!,
  };
}

/** "YYYY-MM-DD" in the station's zone. */
export function localDate(tz: string, at: Date = new Date()): string {
  const p = partsIn(tz, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DD HH:MM:SS" in the station's zone — the shape BirdNET-Pi stored. */
export function localStamp(tz: string, at: Date): string {
  const p = partsIn(tz, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Minute of the local day, 0..1439 — the slot the rhythm view is drawn on. */
export function localSlot(tz: string, at: Date): number {
  const p = partsIn(tz, at);
  return p.hour * 60 + p.minute;
}

/** Hour of the local day, 0..23. */
export function localHour(tz: string, at: Date): number {
  return partsIn(tz, at).hour;
}

/** Shift a "YYYY-MM-DD" by whole days without tripping over DST. */
export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!));
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}

/** Whole days between two "YYYY-MM-DD", b - a. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** ISO-8601 instant, for the `as_of` field every action carries. */
export function isoNow(at: Date = new Date()): string {
  return at.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
