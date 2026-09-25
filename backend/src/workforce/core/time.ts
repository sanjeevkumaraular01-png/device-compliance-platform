/**
 * Time-zone helpers (IANA zones via Intl, no external deps). A "local date" is a
 * `YYYY-MM-DD` string in the policy time zone; Prisma `@db.Date` columns store it
 * as UTC midnight of that calendar date.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday 1=Mon..7=Sun */
  weekday: number;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY[get('weekday')] ?? 1,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar date `YYYY-MM-DD` of an instant in `tz`. */
export function localDate(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Offset (ms) of `tz` at instant `date`: local wall time − UTC. */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instant for local wall time `dateStr` + `HH:mm[:ss]` in `tz`. */
export function zonedTime(dateStr: string, time: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  // Second pass handles DST transitions between guess and result.
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** [start, end) instants of local day `dateStr` in `tz`. */
export function dayRange(dateStr: string, tz: string): { start: Date; end: Date } {
  return { start: zonedTime(dateStr, '00:00', tz), end: zonedTime(addDays(dateStr, 1), '00:00', tz) };
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

/** ISO weekday (1=Mon..7=Sun) of a calendar date. */
export function isoWeekday(dateStr: string): number {
  const wd = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Calendar date -> Date stored in a Prisma `@db.Date` column. */
export function dbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Prisma `@db.Date` value -> `YYYY-MM-DD`. */
export function fromDbDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

export function datesBetween(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "HH:mm" -> minutes after midnight. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** ISO string of an instant rendered as local wall time with offset, e.g. 2026-09-25T09:00:00+05:30. */
export function localIso(date: Date, tz: string): string {
  const p = localParts(date, tz);
  const off = Math.round(tzOffsetMs(date, tz) / 60_000);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
