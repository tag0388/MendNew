// Run: node src/lib/phasing.test.mjs
// Plain node, no framework -- the rule is a pure function over dates.

const D = (s) => new Date(s + 'T00:00:00Z');

// Mirrors resolvePhasingWindow in phasing.ts. Kept in sync by hand because
// the project has no TS test runner; the logic is six lines.
function resolvePhasingWindow(start, end, forecastStart) {
  if (!start || !end) return { reason: 'no Start/End Date' };
  if (end < start) return { reason: 'the End Date is before the Start Date' };
  if (forecastStart) {
    if (end < forecastStart) return { reason: 'the date range ends before the next reporting period' };
    if (start < forecastStart) start = forecastStart;
  }
  return { start, end };
}

// Current period is Sep'26, so the forecast window opens 1 Oct 2026.
const FORECAST_START = D('2026-10-01');

const cases = [
  // [name, start, end, expected]
  ['reported bug: 1 Aug - 17 Sep phases nothing', '2026-08-01', '2026-09-17', 'skip'],
  ['ends on the last day before the window',      '2026-08-01', '2026-09-30', 'skip'],
  ['ends exactly on the window start',            '2026-08-01', '2026-10-01', '2026-10-01..2026-10-01'],
  ['straddles the boundary, start clamped',       '2026-09-01', '2026-10-31', '2026-10-01..2026-10-31'],
  ['entirely inside the window, untouched',       '2026-11-01', '2026-11-30', '2026-11-01..2026-11-30'],
  ['starts exactly on the window start',          '2026-10-01', '2026-12-31', '2026-10-01..2026-12-31'],
  ['end before start is rejected',                '2026-12-01', '2026-11-01', 'skip'],
];

let ok = true;
for (const [name, s, e, want] of cases) {
  const r = resolvePhasingWindow(D(s), D(e), FORECAST_START);
  const got = !r.reason ? `${r.start.toISOString().slice(0,10)}..${r.end.toISOString().slice(0,10)}` : 'skip';
  const pass = got === want;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${got}${pass ? '' : ` (want ${want})`}`);
}

// Missing dates
const missing = resolvePhasingWindow(null, D('2026-11-01'), FORECAST_START);
const missingOk = missing.reason === 'no Start/End Date';
if (!missingOk) ok = false;
console.log(`${missingOk ? 'PASS' : 'FAIL'}  a missing date is rejected, not defaulted`);

console.log(ok ? '\nALL PASS' : '\nFAILURES');
process.exit(ok ? 0 : 1);
