// Widok zakładki DASH (rail) — trend KPI Gross/Net w czasie, na podstawie wyników
// zapisanych w backendzie (nie zaimportowanego pliku CSV), patrz backend/otsDailyApi.js ->
// fetchAllResults. Niezależny od per-klienckiego stanu w app.js (state/activeClientId).
import {
  filterResultsByDepartment,
  filterResultsByDateRange,
  maxReportDate,
  groupResultsByDay,
  groupResultsByWeek,
  aggregateResults,
  withPct,
} from "../calcEngine.js";
import {
  formatWeekRangeLabel,
  formatPercent,
  startOfWeek,
  addDays,
  startOfToday,
  toDateInputValue,
  fromDateInputValue,
} from "../dateUtils.js";
import { OK_ICON, NOK_ICON } from "./dashboard.js";

// Cel OTS — dziś identyczny dla obu klientów (3me.js/solventum.js -> targetPct: 98.5),
// więc jedna stała tu wystarcza zamiast liczenia per-department przy widoku "Wszyscy klienci".
const TARGET_PCT = 98.5;

let chartInstance = null;
let reasonChartInstance = null;
let allResults = [];
let selectedDepartment = "all";
let granularity = "day";

// Zakres dat jest pamiętany OSOBNO dla "dzień" i "tydzień" — przełączenie granulacji nie
// gubi ręcznie ustawionego zakresu tego drugiego trybu w tej samej sesji. `null` oznacza
// "użytkownik jeszcze nie dotykał tego trybu" -> liczymy sensowny domyślny zakres przy
// każdym renderze (patrz defaultRangeFor), zamiast zamrażać go raz na starcie.
const customRanges = { day: null, week: null };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatDateShort(isoDate) {
  const [, m, d] = isoDate.split("-");
  return `${d}.${m}`;
}

// Spłaszcza delayedLines (patrz otsDailyApi.fetchAllResults) wierszy z `rows` do płaskiej
// listy wpisów tabeli "Powody opóźnień", od najnowszego do najstarszego dnia.
function flattenDelayedLines(rows) {
  const lines = [];
  for (const r of rows) {
    for (const dl of r.delayedLines || []) {
      lines.push({
        reportDate: r.reportDate,
        wmsOrder: dl.wmsOrder,
        country: dl.country,
        lineCount: dl.lineCount,
        reasonCode: dl.reasonCode,
      });
    }
  }
  return lines.sort(
    (a, b) => b.reportDate.localeCompare(a.reportDate) || (a.country || "").localeCompare(b.country || ""),
  );
}

// Wiersze (wyniki dzienne, NIE spłaszczone delayedLines) mieszczące się w jednym słupku —
// jeden dzień, albo cały tydzień przy granulacji "week". `rows` to TE SAME wyniki, które
// zasiliły wykres (już przefiltrowane po kliencie i zakresie dat) — klik tylko dodatkowo
// zawęża je do jednego okresu z osi X. Współdzielone przez tabelę (flattenDelayedLines) i
// kartę KPI okresu (aggregateResults) w renderPeriodPanel, żeby liczyły z tego samego zbioru.
function rowsForPeriod(rows, mode, entry) {
  const periodEnd = mode === "week" ? toDateInputValue(addDays(entry.weekStart, 6)) : entry.key;
  return rows.filter((r) =>
    mode === "week" ? r.reportDate >= entry.key && r.reportDate <= periodEnd : r.reportDate === entry.key,
  );
}

function resetPeriodKpis() {
  for (const id of ["dashKpiGross", "dashKpiNet"]) {
    const cardEl = document.getElementById(id);
    const valueEl = document.getElementById(id + "Value");
    const statusEl = document.getElementById(id + "Status");
    cardEl.classList.remove("kpi--good", "kpi--bad");
    statusEl.className = "kpi-status";
    statusEl.innerHTML = "";
    valueEl.textContent = "—";
  }
}

// Karta KPI (ten sam wizualny język co duże karty OTS Total Gross/Net na dashboardzie
// per-klienta, patrz ui/dashboard.js applyKpiStatus) — tu binarnie dobry/zły kolor względem
// TARGET_PCT, bez pośredniego stanu "warn" (to samo dwuwartościowe kodowanie co słupki wykresu).
function applyMiniKpiStatus(id, pct) {
  const cardEl = document.getElementById(id);
  const valueEl = document.getElementById(id + "Value");
  const statusEl = document.getElementById(id + "Status");
  const isOk = pct >= TARGET_PCT / 100;
  cardEl.classList.remove("kpi--good", "kpi--bad");
  cardEl.classList.add(isOk ? "kpi--good" : "kpi--bad");
  valueEl.textContent = formatPercent(pct);
  statusEl.className = `kpi-status ${isOk ? "ok" : "nok"}`;
  statusEl.innerHTML = `
    <div class="kpi-status-icon">${isOk ? OK_ICON : NOK_ICON}</div>
    <span class="kpi-status-label">${isOk ? "OK" : "NOK"}</span>`;
}

// Sumuje lineCount po reasonCode (brak = osobny koszyk "Brak powodu", zawsze na czerwono —
// spójnie z wierszami tabeli, patrz renderPeriodPanel) — pod wykres kołowy obok tabeli.
function reasonBreakdown(lines) {
  const map = new Map();
  for (const l of lines) {
    const key = l.reasonCode || "Brak powodu";
    map.set(key, (map.get(key) || 0) + (l.lineCount || 0));
  }
  return [...map.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count);
}

// Paleta dla dowolnej liczby kodów przyczyn — kolory z motywu aplikacji + kilka dodatkowych
// (fiolet/turkus/róż), żeby starczyło nawet przy >4 różnych kodach w okresie; "Brak powodu"
// zawsze dostaje --critical niezależnie od kolejności (patrz reasonBreakdown).
function reasonChartColors(breakdown) {
  const critical = cssVar("--critical") || "#d03b3b";
  const palette = [
    cssVar("--accent") || "#3987e5",
    cssVar("--good") || "#0ca30c",
    cssVar("--warning") || "#fab219",
    "#8a5cf6",
    "#00b8b0",
    "#e2678a",
  ];
  let paletteIndex = 0;
  return breakdown.map((b) =>
    b.reasonCode === "Brak powodu" ? critical : palette[paletteIndex++ % palette.length],
  );
}

// `lines` to spłaszczone delayedLines TEGO SAMEGO okresu co tabela obok (patrz
// renderPeriodPanel) — domyślnie cały widoczny zakres wykresu, po kliknięciu słupka jeden
// dzień/tydzień. Osobna instancja Chart.js (reasonChartInstance) od głównego wykresu trendu.
function renderReasonChart(lines) {
  const canvas = document.getElementById("dashReasonChart");
  const statusEl = document.getElementById("dashReasonChartStatus");
  const breakdown = reasonBreakdown(lines);

  if (breakdown.length === 0) {
    if (reasonChartInstance) {
      reasonChartInstance.destroy();
      reasonChartInstance = null;
    }
    statusEl.textContent = "Brak linii wymagających wyjaśnienia w tym okresie.";
    return;
  }
  statusEl.textContent = "";

  const textColor = cssVar("--text-secondary") || "#9aa7b7";
  const surface = cssVar("--surface-1") || "#121821";

  if (reasonChartInstance) reasonChartInstance.destroy();
  reasonChartInstance = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: breakdown.map((b) => b.reasonCode),
      datasets: [
        {
          data: breakdown.map((b) => b.count),
          backgroundColor: reasonChartColors(breakdown),
          borderColor: surface,
          borderWidth: 2,
        },
      ],
    },
    options: {
      // Fallback koloru tekstu na poziomie CAŁEGO wykresu — na motywie ciemnym legenda
      // ignorowała samo plugins.legend.labels.color i zostawała czarna/niewidoczna (feedback
      // użytkownika); to jest ten sam mechanizm, który koloruje osie na głównym wykresie OTS.
      color: textColor,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: textColor,
            boxWidth: 10,
            font: { size: 10.5 },
            padding: 8,
            // Domyślna legenda Chart.js pokazuje same nazwy — dopisujemy liczbę linii przy
            // każdym powodzie, żeby było ją widać bez najeżdżania (feedback użytkownika).
            generateLabels: (chart) => {
              const { labels, datasets } = chart.data;
              const dataset = datasets[0];
              return labels.map((label, i) => ({
                text: `${label} (${dataset.data[i]})`,
                fillStyle: dataset.backgroundColor[i],
                strokeStyle: dataset.backgroundColor[i],
                fontColor: textColor,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.parsed} ${ctx.parsed === 1 ? "linia" : "linii"}`,
          },
        },
      },
    },
  });
}

// rows === null -> stan początkowy/reset (np. brak danych w ogóle, patrz renderChart).
// Domyślnie (bez kliknięcia w słupek) `rows` to WSZYSTKIE wyniki z aktualnego zakresu wykresu
// (nie tylko po kliknięciu) — klik zawęża je do jednego dnia/tygodnia, patrz onClick niżej.
// Tabela, wykres kołowy i karty KPI liczą się z tego samego `rows`, więc zawsze opisują ten
// sam okres.
function renderPeriodPanel(rows, periodLabel) {
  const hintEl = document.getElementById("dashDetailsHint");
  const body = document.getElementById("dashDetailsTable");

  if (rows === null) {
    hintEl.textContent = "";
    body.innerHTML = "";
    resetPeriodKpis();
    renderReasonChart([]);
    return;
  }

  hintEl.textContent = periodLabel;

  const lines = flattenDelayedLines(rows);
  renderReasonChart(lines);
  if (lines.length === 0) {
    body.innerHTML =
      '<tr><td colspan="5" style="color:var(--text-muted)">Brak linii wymagających wyjaśnienia w tym okresie.</td></tr>';
  } else {
    body.innerHTML = lines
      .map((l) => {
        // Brak reasonCode -> ta linia obniża Net, mimo że nikt jej jeszcze nie ocenił (patrz
        // calcEngine.calculateKpis -> sumaObdLine) — cały wiersz na czerwono ma to uwypuklić
        // mocniej niż sama kropka (feedback: kropka słabo widoczna).
        const missing = !l.reasonCode;
        const reasonCell = missing
          ? '<span class="pct-cell"><i class="pct-dot bad"></i>Brak powodu</span>'
          : l.reasonCode;
        return `
    <tr${missing ? ' class="row-critical"' : ""}>
      <td>${formatDateShort(l.reportDate)}</td>
      <td>${l.wmsOrder ?? "—"}</td>
      <td class="kraj">${l.country ?? "—"}</td>
      <td class="num">${l.lineCount ?? "—"}</td>
      <td>${reasonCell}</td>
    </tr>`;
      })
      .join("");
  }

  const kpi = aggregateResults(rows);
  applyMiniKpiStatus("dashKpiGross", kpi.grossPct);
  applyMiniKpiStatus("dashKpiNet", kpi.netPct);
}

// Domyślny zakres per granulacja — ZAWSZE licząc wstecz od ostatniego dnia, dla którego
// faktycznie są zapisane wyniki (nie od dzisiejszej daty — dziś mogło jeszcze nic nie
// zapisać, co przy kalendarzowym miesiącu potrafiło dać pusty domyślny zakres):
// - dzień: ostatnie ~30 dni (miesiąc wstecz) do ostatniego dnia z danymi;
// - tydzień: ostatnie 4 tygodnie (poniedziałek 3 tygodnie temu do ostatniego dnia z danymi).
// `resultsForDefault` to wyniki PO filtrze klienta (ale przed filtrem dat) — dzięki temu
// domyślny zakres podąża za tym, który klient jest akurat wybrany.
function defaultRangeFor(mode, resultsForDefault) {
  const latest = maxReportDate(resultsForDefault);
  const anchor = latest ? fromDateInputValue(latest) : startOfToday();
  const to = latest || toDateInputValue(anchor);
  const from =
    mode === "week"
      ? toDateInputValue(addDays(startOfWeek(anchor), -21))
      : toDateInputValue(addDays(anchor, -30));
  return { from, to };
}

// Buduje przełącznik klienta (przyciski, ten sam styl co Dzień/Tydzień niżej) z tej samej
// listy `clients`, którą app.js używa do importu CSV (patrz index.html -> app.js `const
// clients`) — żeby DASH zawsze znał aktualny zestaw klientów bez osobnej listy do utrzymania.
// "Warehouse" = suma wszystkich klientów (selectedDepartment "all").
export function initDashView(clients) {
  const toggle = document.getElementById("dashDepartmentToggle");
  toggle.innerHTML =
    '<button type="button" class="owner-btn" data-department="all" aria-pressed="true">Warehouse</button>' +
    clients
      .map(
        (c) =>
          `<button type="button" class="owner-btn" data-department="${c.name}" aria-pressed="false">${c.name}</button>`,
      )
      .join("");
  toggle.querySelectorAll(".owner-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") return;
      selectedDepartment = btn.dataset.department;
      toggle
        .querySelectorAll(".owner-btn")
        .forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      renderChart();
    });
  });

  document.querySelectorAll("#dashGranularityToggle .owner-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") return;
      granularity = btn.dataset.granularity;
      document
        .querySelectorAll("#dashGranularityToggle .owner-btn")
        .forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      renderChart();
    });
  });

  const fromInput = document.getElementById("dashDateFrom");
  const toInput = document.getElementById("dashDateTo");
  const onRangeInputChange = () => {
    // Puste pole = brak ograniczenia z tej strony (filterResultsByDateRange to obsługuje).
    customRanges[granularity] = { from: fromInput.value || null, to: toInput.value || null };
    renderChart();
  };
  fromInput.addEventListener("change", onRangeInputChange);
  toInput.addEventListener("change", onRangeInputChange);
}

// Wywoływane przez app.js po (re)pobraniu danych z backendu (za każdym wejściem w DASH —
// nie ma filtrowanego GET, więc nie ma sensu cache'ować między wizytami, patrz otsDailyApi.js).
export function setDashResults(results) {
  allResults = results;
  renderChart();
}

function renderChart() {
  const canvas = document.getElementById("dashChart");
  const statusEl = document.getElementById("dashChartStatus");
  const fromInput = document.getElementById("dashDateFrom");
  const toInput = document.getElementById("dashDateTo");

  const byDepartment = filterResultsByDepartment(allResults, selectedDepartment);
  const range = customRanges[granularity] || defaultRangeFor(granularity, byDepartment);
  fromInput.value = range.from || "";
  toInput.value = range.to || "";

  if (byDepartment.length === 0) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    statusEl.textContent =
      allResults.length === 0
        ? "Brak jeszcze zapisanych wyników w backendzie."
        : "Brak zapisanych wyników dla wybranego klienta.";
    renderPeriodPanel(null);
    return;
  }

  const filtered = filterResultsByDateRange(byDepartment, range.from, range.to);
  if (filtered.length === 0) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    statusEl.textContent = "Brak wyników w wybranym zakresie dat.";
    renderPeriodPanel(null);
    return;
  }
  statusEl.textContent = "";

  // Domyślnie (dopóki użytkownik nie kliknie konkretnego słupka) panel (tabela + karty KPI)
  // pokazuje WSZYSTKIE wyniki z aktualnie wybranego zakresu — klik w słupek (patrz
  // options.onClick niżej) zawęża go do jednego dnia/tygodnia.
  renderPeriodPanel(filtered, "Wszystkie powody w wybranym zakresie");

  const grouped = withPct(
    granularity === "week" ? groupResultsByWeek(filtered) : groupResultsByDay(filtered),
  );
  const labels = grouped.map((e) =>
    granularity === "week" ? formatWeekRangeLabel(e.weekStart) : formatDateShort(e.key),
  );
  const grossData = grouped.map((e) => +(e.grossPct * 100).toFixed(2));
  const netData = grouped.map((e) => +(e.netPct * 100).toFixed(2));

  const good = cssVar("--good") || "#0ca30c";
  const critical = cssVar("--critical") || "#d03b3b";
  const warning = cssVar("--warning") || "#fab219";
  const textColor = cssVar("--text-secondary") || "#9aa7b7";
  const gridColor = cssVar("--border") || "#262f3b";

  // Identyfikator aktualnie "kliknięcie-wybranego" słupka (entry.key: data ISO dla dnia,
  // poniedziałek tygodnia dla tygodnia) — ponowny klik w TEN SAM słupek "odklika" filtr i
  // wraca do pełnego zakresu (patrz onClick niżej). Reset przy każdym renderChart(), bo
  // zmiana klienta/granulacji/zakresu i tak unieważnia poprzedni wybór.
  let selectedKey = null;

  // Kolor słupka koduje wynik względem celu (jak karty OTS Total Gross/Net na dashboardzie
  // per-klienta — patrz ui/dashboard.js applyKpiStatus): good = cel osiągnięty, critical =
  // nieosiągnięty. Gross/Net to ta sama skala kolorów, rozróżnione przezroczystością (Net =
  // jaśniejszy słupek) — patrz legenda pod wykresem w index.html. Gdy coś jest wybrane
  // (selectedKey), reszta słupków dodatkowo przygasa (DIM_ALPHA), żeby wybrany dzień/tydzień
  // było od razu widać na tle pozostałych (feedback: bez tego nie było wiadomo, co jest kliknięte).
  const DIM_ALPHA = "22"; // ~13% krycia
  const barColorsFor = (values, fullAlpha) =>
    values.map((v, i) => {
      const base = v >= TARGET_PCT ? good : critical;
      if (!selectedKey) return base + fullAlpha;
      return grouped[i].key === selectedKey ? base + fullAlpha : base + DIM_ALPHA;
    });

  // Po każdej zmianie selectedKey (klik/odklik) tylko przemalowuje istniejący wykres zamiast
  // go niszczyć i tworzyć od nowa — szybsze i bez utraty ewentualnej animacji/interakcji.
  function refreshBarColors() {
    chartInstance.data.datasets[0].backgroundColor = barColorsFor(grossData, "");
    chartInstance.data.datasets[1].backgroundColor = barColorsFor(netData, "99");
    chartInstance.update();
  }

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar", // domyślny typ dla scal/kontrolerów — poszczególne datasety mają własny "type"
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "OTS Gross",
          data: grossData,
          backgroundColor: barColorsFor(grossData, ""),
          borderRadius: 6, // borderSkipped domyślnie 'bottom' -> płaski dół, zaokrąglona góra
          maxBarThickness: 34,
        },
        {
          type: "bar",
          label: "OTS Net",
          data: netData,
          backgroundColor: barColorsFor(netData, "99"),
          borderRadius: 6,
          maxBarThickness: 34,
        },
        {
          type: "line",
          label: `Cel ${String(TARGET_PCT).replace(".", ",")}%`,
          data: labels.map(() => TARGET_PCT),
          borderColor: warning,
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          // Bez jawnego "order": przy remisie (wszystkie datasety mają domyślne order:0)
          // Chart.js dobiera kolejność rysowania po indeksie w tablicy rosnąco — linia jest
          // ostatnia, więc rysuje się na wierzchu słupków. Nie zmieniać kolejności datasetów
          // powyżej bez przemyślenia tego efektu.
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      // categoryPercentage/barPercentage blisko 1 = prawie brak odstępu między słupkami
      // (i między Gross a Net w tej samej kategorii) — patrz feedback "prawie żeby się stykały".
      datasets: { bar: { categoryPercentage: 0.98, barPercentage: 1 } },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? "pointer" : "default";
      },
      // Klik w słupek (dowolny z dwóch — Gross albo Net) zawęża panel "Powody opóźnień"
      // poniżej (tabela + karty KPI) do tego jednego dnia (lub całego tygodnia przy
      // granulacji "week"), patrz rowsForPeriod. `filtered`/`grouped` to zmienne z zamknięcia
      // tego wywołania renderChart — przy kolejnym renderChart() wykres i tak zostanie
      // zniszczony i utworzony od nowa.
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const entry = grouped[elements[0].index];

        // Klik w już wybrany słupek = "odklikanie" -> wróć do pełnego zakresu.
        if (selectedKey === entry.key) {
          selectedKey = null;
          refreshBarColors();
          renderPeriodPanel(filtered, "Wszystkie powody w wybranym zakresie");
          return;
        }

        selectedKey = entry.key;
        refreshBarColors();
        const rows = rowsForPeriod(filtered, granularity, entry);
        const periodLabel =
          granularity === "week"
            ? `Powody opóźnień — tydzień ${formatWeekRangeLabel(entry.weekStart)} (kliknij ponownie, aby wyczyścić)`
            : `Powody opóźnień — ${formatDateShort(entry.key)} (kliknij ponownie, aby wyczyścić)`;
        renderPeriodPanel(rows, periodLabel);
      },
      scales: {
        x: { ticks: { color: textColor }, grid: { display: false } },
        y: {
          min: 0,
          max: 100,
          ticks: { color: textColor, callback: (v) => v + "%" },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: { display: false }, // zastąpiona statyczną legendą pod wykresem (index.html)
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ctx.dataset.type === "line"
                ? ctx.dataset.label
                : `${ctx.dataset.label}: ${formatPercent(ctx.parsed.y / 100)}`,
          },
        },
      },
    },
  });
}
