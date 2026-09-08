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
