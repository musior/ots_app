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

// Poprzedni dzień roboczy (pomija sobotę/niedzielę) — domyślna data filtra i punkt
// odniesienia dla raportu mailowego, tak żeby w poniedziałek domyślnie pokazywało piątek.
export function previousBusinessDay(date) {
  let d = addDays(date, -1);
  const day = d.getDay(); // niedziela=0 ... sobota=6
  if (day === 0) d = addDays(d, -2);
  else if (day === 6) d = addDays(d, -1);
  return d;
}

// Granice miesiąca kalendarzowego zawierającego podaną datę — używane przez przycisk
// "Cały miesiąc" przy filtrze zakresu dat na dashboardzie.
export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// Format "DD-MM-RRRR" używany w temacie i treści raportu mailowego (js/emailReport.js) —
// inny niż formatDatePl (kropki, pl-PL), bo takiego formatu oczekuje treść maila.
export function formatDateDMY(date) {
  if (!date) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

export function formatDatePl(date) {
  if (!date) return '—';
  return date.toLocaleDateString('pl-PL');
}

export function formatPercent(value) {
  return (value * 100).toFixed(2).replace('.', ',') + '%';
}

export function isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Konwersja do/z formatu, jakiego oczekuje <input type="date"> ("YYYY-MM-DD").
export function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromDateInputValue(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
