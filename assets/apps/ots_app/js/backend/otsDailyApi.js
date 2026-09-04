// Klient generycznego endpointu /api/apps/spa/ots-daily (ustalone z KG) — jeden wiersz
// per (department, report_date). Pola rdzeniowe (id, department, report_date, total_lines,
// gross_on_time_lines, net_on_time_lines) są stałe i ustalone przez backend; WSZYSTKO inne
// (kraje, powody, audyt) leci do `meta` jako zserializowany JSON string.
//
// `id` jest nadawany automatycznie przez backend (autoincrement) — nie ma filtrowanego GET,
// więc żeby wiedzieć, czy dany dzień już istnieje (POST) czy trzeba go nadpisać (PATCH),
// ściągamy WSZYSTKIE wiersze i filtrujemy w JS. Przy naszej skali (2 klientów, maks. kilkaset
// dni w roku) to żaden problem wydajnościowy.

// TODO: docelowo względny adres 'api/apps/spa/ots-daily' (żeby działało niezależnie od tego,
// pod jakim originem host akurat serwuje appkę) — na razie pełny URL, żeby dało się testować
// z localhosta. Podwójny slash po ".pl" jest zgodny z tym, co podał KG — do potwierdzenia,
// czy to celowe, czy literówka po ich stronie.
const API_BASE = 'https://cloud.fiege.pl//api/apps/spa/ots-daily';

// GET jest paginowane: { data: [...], meta: { page, per_page, total, last_page } }
// (potwierdzone na realnej odpowiedzi). Przy 2 wierszach mieści się to na jednej stronie
// i łatwo tego nie zauważyć — ale jak tylko historii zrobi się więcej niż per_page (domyślnie
// 50), trzeba przejść przez WSZYSTKIE strony, inaczej findRow() nie znajdzie dnia z dalszej
// strony i zrobi duplikat zamiast nadpisania, a fetchMonthlyResults() po cichu urwie starsze dane.
// Prosimy backend o duże strony (1000), żeby przy rosnącej historii nie robić dziesiątek
// zapytań przy każdym odczycie — nadal pętlujemy po `lastPage`, gdyby backend i tak przyciął
// per_page do własnego maksimum.
async function fetchPage(page) {
  const url = `${API_BASE}?page=${page}&per_page=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const payload = await res.json();
  if (!Array.isArray(payload?.data)) {
    console.error('GET /ots-daily zwróciło nieoczekiwany kształt (oczekiwano {data:[], meta:{last_page}}):', payload);
    throw new Error('Nieoczekiwany kształt odpowiedzi z GET /ots-daily — zobacz konsolę.');
  }
  return { rows: payload.data, lastPage: payload.meta?.last_page ?? page };
}

async function fetchAllRows() {
  const allRows = [];
  let page = 1;
  let lastPage = 1;
  do {
    const { rows, lastPage: reportedLastPage } = await fetchPage(page);
    allRows.push(...rows);
    lastPage = reportedLastPage;
    page += 1;
  } while (page <= lastPage);
  return allRows;
}

function parseMeta(row) {
  if (!row.meta) return {};
  try {
    return JSON.parse(row.meta);
  } catch (err) {
    console.error('Nie udało się sparsować pola meta', row, err);
    return {};
  }
}

function findRow(rows, department, reportDate) {
  return rows.find((r) => r.department === department && r.report_date === reportDate) || null;
}

// Tworzy (POST) albo nadpisuje (PATCH) wynik jednego dnia dla jednego klienta.
// countries/reasons to surowe wyniki calcEngine.calculateCountryBreakdown /
// calculateReasonBreakdown, delayedLines to calcEngine.buildDelayedLinesSnapshot — wszystkie
// lądują 1:1 w meta, nie są polami rdzeniowymi (patrz ustalenia z KG). countries ma dziś
// tylko Gross (tak samo jak w dashboardzie/emailu) — jeśli kiedyś potrzebny będzie Net per
// kraj, to osobna, nowa funkcja w calcEngine.js. delayedLines to CAŁY panel "Opóźnione linie"
// tego dnia (łącznie z jeszcze nieocenionymi liniami) — pozwala docelowo odtworzyć panel i
// Net z danych na serwerze, nie tylko z localStorage jednej przeglądarki (patrz reviewsStore.js).
export async function upsertDailyResult({
  department, reportDate, totalLines, grossOnTimeLines, netOnTimeLines, countries, reasons, delayedLines, performedBy,
}) {
  const rows = await fetchAllRows();
  const existing = findRow(rows, department, reportDate);

  const meta = {
    ...(existing ? parseMeta(existing) : {}),
    countries,
    reasons,
    delayedLines,
    ...(existing
      ? { updated_by: performedBy, updated_at: new Date().toISOString() }
      : { created_by: performedBy }),
  };

  const body = {
    department,
    report_date: reportDate,
    total_lines: totalLines,
    gross_on_time_lines: grossOnTimeLines,
    net_on_time_lines: netOnTimeLines,
    meta: JSON.stringify(meta),
  };

  const url = existing ? `${API_BASE}/${existing.id}` : API_BASE;
  const method = existing ? 'PATCH' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return res.json();
}

// Rekonstruuje reviewsByObd (dokładnie kształt, jaki wcześniej trzymał localStorage — patrz
// reviewsStore.js) ze wszystkich dni zapisanych dla danego klienta. Wołane przy imporcie
// pliku (js/app.js -> handleFiles), żeby od razu było widać, co ktoś już ocenił, niezależnie
// od tego, na jakim komputerze/przeglądarce to zrobił. Każde OBD ma z założenia jeden
// AdjustedExpectedDate, więc nie powinno wystąpić w dwóch różnych dniach naraz — gdyby jednak
// się zdarzyło (np. korekta danych), wygrywa dzień przetworzony jako ostatni w pętli.
export async function fetchDelayedLinesReviews(department) {
  const rows = await fetchAllRows();
  const reviewsByObd = {};
  for (const row of rows) {
    if (row.department !== department) continue;
    const meta = parseMeta(row);
    for (const line of meta.delayedLines ?? []) {
      if (!line.reasonCode || !line.faultOwner) continue; // tylko faktycznie ocenione linie
      reviewsByObd[line.obd] = {
        reasonCode: line.reasonCode,
        faultOwner: line.faultOwner,
        reviewedBy: line.reviewedBy,
        reviewedAt: line.reviewedAt,
      };
    }
  }
  return reviewsByObd;
}

// Wyniki jednego klienta za dany miesiąc kalendarzowy — pod przyszły widok/wykres miesięczny.
// report_date jest w formacie "YYYY-MM-DD" (patrz dateUtils.toDateInputValue), więc
// dopasowanie po prefiksie "YYYY-MM" wystarczy bez parsowania dat.
export async function fetchMonthlyResults(department, year, month) {
  const rows = await fetchAllRows();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return rows
    .filter((r) => r.department === department && String(r.report_date).startsWith(prefix))
    .map((r) => ({ ...r, meta: parseMeta(r) }))
    .sort((a, b) => a.report_date.localeCompare(b.report_date));
}

// Wszystkie zapisane dzienne wyniki (wszystkich departmentów) — pod zakładkę DASH: wykres
// trendu (total/gross/net) i tabela "Powody opóźnień" pod nim po kliknięciu dnia/tygodnia
// (delayedLines z meta, patrz calcEngine.buildDelayedLinesSnapshot -> co dokładnie tam ląduje).
export async function fetchAllResults() {
  const rows = await fetchAllRows();
  return rows
    .map((r) => {
      const meta = parseMeta(r);
      return {
        department: r.department,
        reportDate: r.report_date,
        totalLines: r.total_lines,
        grossOnTimeLines: r.gross_on_time_lines,
        netOnTimeLines: r.net_on_time_lines,
        delayedLines: meta.delayedLines ?? [],
      };
    })
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}
