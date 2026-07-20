// Daty w raporcie OBD przychodzą jako tekst "YYYYMMDD" (np. "20260504"),
// więc nie da się ich sparsować wprost przez new Date(string).

export function parseNumericDate(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!/^\d{8}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Power Query liczy dzień tygodnia z poniedziałkiem jako 0 (Day.Monday).
// JS Date.getDay() liczy od niedzieli (0), więc trzeba przemapować.
export function mondayIndexedDayOfWeek(date) {
  return (date.getDay() + 6) % 7;
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatDatePl(date) {
  if (!date) return '—';
  return date.toLocaleDateString('pl-PL');
}

export function formatPercent(value) {
  return (value * 100).toFixed(2).replace('.', ',') + '%';
}
