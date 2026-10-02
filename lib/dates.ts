// All event dates are stored as UTC-midnight for the calendar day (YYYY-MM-DD).
// Business logic runs in India Standard Time regardless of the server timezone (Vercel = UTC).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's calendar date in IST as YYYY-MM-DD. */
export function istToday(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC-midnight Date for today's IST calendar day — use for `date >= today` queries. */
export function istTodayStart(now = new Date()): Date {
  return new Date(istToday(now) + "T00:00:00.000Z");
}

/** Calendar day (YYYY-MM-DD) of a stored event/visit date. */
export function dayKey(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}
