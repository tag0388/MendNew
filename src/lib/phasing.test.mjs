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

console.log(ok ? '\nWINDOW: ALL PASS' : '\nWINDOW: FAILURES');
if (!ok) process.exitCode = 1;

// ---------------------------------------------------------------- paste ----
function parsePastedDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }
  const iso = new Date(text);
  return isNaN(iso.getTime()) ? null : iso;
}

const fmt = (d) => d === null ? 'null'
  : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const pasteCases = [
  ['17/09/2026 is 17 September, not Invalid', '17/09/2026', '2026-09-17'],
  ['01/08/2026 is 1 August, NOT 8 January',   '01/08/2026', '2026-08-01'],
  ['dashes work too',                          '17-09-2026', '2026-09-17'],
  ['two-digit years',                          '17/09/26',   '2026-09-17'],
  ['ISO passes straight through',              '2026-09-17', '2026-09-17'],
  ['31/02 is impossible, not 3 March',         '31/02/2026', 'null'],
  ['month 13 is rejected',                     '01/13/2026', 'null'],
  ['blank leaves the cell alone',              '',           'null'],
  ['nonsense leaves the cell alone',           'not a date', 'null'],
];

let pasteOk = true;
console.log('');
for (const [name, input, want] of pasteCases) {
  const got = fmt(parsePastedDate(input));
  const pass = got === want;
  if (!pass) pasteOk = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${got}${pass ? '' : ` (want ${want})`}`);
}
console.log(pasteOk ? '\nPASTE: ALL PASS' : '\nPASTE: FAILURES');
if (!pasteOk) process.exitCode = 1;
