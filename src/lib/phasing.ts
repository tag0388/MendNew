/**
 * The forecast window rule, in one place.
 *
 * ETC phasing is forecast, so it may only land in periods AFTER the current
 * reporting period. Deciding which part of a row's date range qualifies was
 * written out separately in the per-cost-code ETC pane and in the bulk ETC
 * screen, and the two copies drifted -- one of them clamped a range that was
 * entirely in the past forward onto the first future day, so a row running
 * 1 Aug to 17 Sep phased a day's worth into October.
 *
 * Kept as a pure function over dates so it can be tested without a grid, a
 * database or a browser: node src/lib/phasing.test.mjs
 */

/**
 * A resolved window, or a reason there is nothing to phase.
 *
 * One shape with an optional `reason` rather than a discriminated union on
 * `ok`: this project compiles without strictNullChecks, and narrowing a
 * boolean-literal discriminant is unreliable there. Turning strict mode on
 * across the codebase is not something a bug fix should decide.
 */
export interface PhasingWindow {
  /** Present only when reason is absent. */
  start?: Date;
  end?: Date;
  /** Present when the range carries no forecast; safe to show the user. */
  reason?: string;
}

/**
 * Narrow [start, end] to the part that falls in the forecast window.
 *
 * @param start           the row's phasing start date
 * @param end             the row's phasing end date
 * @param forecastStart   first day of the first period after the current one
 */
export function resolvePhasingWindow(
  start: Date | null,
  end: Date | null,
  forecastStart: Date | null
): PhasingWindow {
  if (!start || !end) return { reason: 'no Start/End Date' };
  if (end < start) return { reason: 'the End Date is before the Start Date' };

  if (forecastStart) {
    // Nothing to phase: the work finishes before the forecast window opens.
    // This is the case that used to be clamped into a single day instead of
    // being rejected -- both ends were dragged forward to forecastStart,
    // which made them equal, and an `end < start` check cannot catch that.
    if (end < forecastStart) {
      return { reason: 'the date range ends before the next reporting period' };
    }
    // Only the start moves. A range straddling the boundary keeps the part
    // of itself that is genuinely in the future.
    if (start < forecastStart) start = forecastStart;
  }

  return { start, end };
}

/**
 * Parse a date the way the grids display it, for clipboard paste.
 *
 * The grids show dates as dd/mm/yyyy. JavaScript's Date does not read that
 * format: `new Date('17/09/2026')` is Invalid Date, and -- far worse --
 * `new Date('01/08/2026')` silently returns 8 JANUARY, because it falls back
 * to the American m/d/y reading whenever the day is 12 or less. So a pasted
 * date either vanished or quietly became a different date.
 *
 * Returns null when the text is not a date in a format we recognise, so the
 * caller can leave the cell alone rather than write a wrong value.
 */
export function parsePastedDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  // dd/mm/yyyy or dd-mm-yyyy, which is what the grids render.
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    // Rejects impossible dates such as 31/02: the Date constructor rolls
    // those over into the next month rather than failing.
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }

  // ISO (yyyy-mm-dd) and anything else Date reads unambiguously.
  const iso = new Date(text);
  return isNaN(iso.getTime()) ? null : iso;
}

/** Format a Date as YYYY-MM-DD in local time, which is how rows store dates. */
export function toStoredDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
