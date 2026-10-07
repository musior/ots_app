import { client3me } from "./clients/3me.js";
import { clientSolventum } from "./clients/solventum.js";
import { parseObdCsvFile } from "./csvParser.js";
import {
  enrichLines,
  filterByExpectedDateRange,
  expectedDateRange,
  calculateKpis,
  calculateCountryBreakdown,
  calculateReasonBreakdown,
  buildDelayedLinesSnapshot,
} from "./calcEngine.js";
import * as reviewsStore from "./reviewsStore.js";
import { renderDashboard, renderEmptyDashboard } from "./ui/dashboard.js";
import { renderDelayedPanel, wireDelayedFilters } from "./ui/delayedPanel.js";
import { buildEmailReport } from "./emailReport.js";
import {
  upsertDailyResult,
  fetchDelayedLinesReviews,
  fetchAllResults,
} from "./backend/otsDailyApi.js";
import { initDashView, setDashResults } from "./ui/dashView.js";
import { currentUserFullName } from "./xcloudUser.js";
import {
  previousBusinessDay,
  startOfToday,
  startOfMonth,
  endOfMonth,
  toDateInputValue,
  fromDateInputValue,
  isSameDay,
  formatDatePl,
} from "./dateUtils.js";

const clients = [client3me, clientSolventum];

// Stan trzymany osobno per klient — przełączanie zakładki (3ME/SLV) nie gubi
// zaimportowanych danych ani wybranego zakresu dat tego drugiego klienta. Każda zakładka
// (Dashboard / Opóźnione linie) ma WŁASNY zakres dat {from, to} (obie granice włącznie):
// - dashboard: domyślnie pojedynczy dzień — poprzedni dzień roboczy (od niego zależy też
//   zapis do bazy i mail, patrz refreshEmailButtonState),
// - delayed: domyślnie od najwcześniejszej daty w raporcie OBD do poprzedniego dnia roboczego
//   (ustawiane przy każdym imporcie, patrz defaultDelayedRange).
// Wspólne inputy "Od"/"Do" w topbarze pokazują i zmieniają zakres AKTYWNEJ zakładki.
function previousBusinessDayRange() {
  const day = previousBusinessDay(startOfToday());
  return { from: day, to: day };
}

const state = new Map(
  clients.map((config) => [
    config.id,
    {
      config,
      enrichedLines: [],
      ranges: {
        dashboard: previousBusinessDayRange(),
        delayed: previousBusinessDayRange(),
      },
      fileName: null,
    },
  ]),
);

let activeClientId = client3me.id;
// 'client' = zakładka 3ME/SLV (import CSV + dashboard dnia), 'dash' = zakładka DASH (trend
// KPI z backendu, patrz switchToDash/ui/dashView.js) — całkiem inny widok, więc trzymamy to
// jako osobny przełącznik zamiast przeciążać activeClientId wartością spoza `clients`.
let activeMode = "client";
// 'dashboard' | 'delayed' — która zakładka widoku klienta jest otwarta (wspólne dla obu
// klientów, tak jak w DOM). Decyduje, który zakres dat edytują inputy "Od"/"Do".
let activeTab = "dashboard";

function activeState() {
  return state.get(activeClientId);
}

function activeRange(st) {
  return st.ranges[activeTab];
}

function linesInRange(st, tab) {
  const { from, to } = st.ranges[tab];
  return filterByExpectedDateRange(st.enrichedLines, from, to);
}

// Domyślny zakres zakładki "Opóźnione linie": od najwcześniejszej daty EXPECTED_SHIP_DATE
// w zaimportowanym raporcie do poprzedniego dnia roboczego (przycięcie do danych — clampDateRange).
function defaultDelayedRange(st) {
  const range = expectedDateRange(st.enrichedLines);
  const to = previousBusinessDay(startOfToday());
  return { from: range && range.min < to ? range.min : to, to };
}

// Pełny render: wywoływany po imporcie pliku, po zmianie filtra daty i po
// przełączeniu klienta — jedyne sytuacje, w których zbiór linii faktycznie się zmienia.
function renderAll() {
  const st = activeState();
  // Dopóki dla aktywnego klienta nic nie zaimportowano, nie liczymy KPI z 0 linii
  // (wyszłoby mylące "0,00% NOK") — pokazujemy neutralny stan pusty.
  if (st.enrichedLines.length === 0) {
    renderEmptyDashboard();
  } else {
    refreshDashboard(linesInRange(st, "dashboard"));
  }
  renderDelayedPanel({
    lines: linesInRange(st, "delayed"),
    config: st.config,
    clientId: activeClientId,
    onChange: refreshDashboardAfterReview,
  });
  updateDateFilterHint();
  refreshEmailButtonState();
}

function refreshDashboard(lines) {
  renderDashboard({
    lines,
    reviewsByObd: reviewsStore.getAllReviews(activeClientId),
    config: activeState().config,
  });
}

// Wywoływane po zapisaniu/edycji oceny w panelu "Opóźnione linie". Odświeża
// TYLKO dashboard (bo Gross/Net zależą od reviewsStore) — celowo NIE wywołuje
// renderDelayedPanel, żeby nie przebudowywać całej tabeli i nie czyścić
// niezapisanych jeszcze zmian w innych wierszach.
function refreshDashboardAfterReview() {
  refreshDashboard(linesInRange(activeState(), "dashboard"));
}

// Licznik linii dla zakresu AKTYWNEJ zakładki (tego, który pokazują inputy "Od"/"Do").
function updateDateFilterHint() {
  const hintEl = document.getElementById("dateFilterHint");
  const st = activeState();
  if (st.enrichedLines.length === 0) {
    hintEl.textContent = "";
    return;
  }
  const count = linesInRange(st, activeTab).length;
  hintEl.textContent =
    count > 0
      ? `${count} ${count === 1 ? "linia" : "linii"} w wybranym zakresie`
      : "Brak linii w wybranym zakresie dat w zaimportowanym pliku";
}

function importStatusText(st) {
  return st.fileName
    ? `${st.fileName} · ${st.enrichedLines.length} linii`
    : "Brak zaimportowanych danych";
}

function refreshImportStatus() {
  document.getElementById("importStatus").textContent =
    importStatusText(activeState());
}

// Oba przyciski (mail i samo uaktualnienie bazy) mają sens tylko wtedy, gdy dla aktywnego
// klienta w ogóle coś zaimportowano (inaczej zapis wyszedłby z samymi zerami) I wybrany jest
// DOKŁADNIE jeden dzień — zarówno szablon maila (emailReport.js: "Wynik OTS za dzień X"), jak
// i zapis dnia do backendu (upsertDailyResult: jeden wiersz per dzień) dotyczą jednego dnia,
// więc przy szerszym zakresie (np. cały miesiąc) pokazywałyby mylącą, niepełną liczbę.
// Czyścimy też status "skopiowano"/"zaktualizowano", żeby nie wprowadzał w błąd po zmianie
// kontekstu (klient / zakres / import). Zapis i mail ZAWSZE dotyczą zakresu zakładki
// Dashboard — także wtedy, gdy otwarta jest zakładka "Opóźnione linie" z szerszym zakresem.
function refreshEmailButtonState() {
  const st = activeState();
  const { from, to } = st.ranges.dashboard;
  const isSingleDay = isSameDay(from, to);
  const hasData = st.enrichedLines.length > 0;

  const emailBtn = document.getElementById("emailBtn");
  const emailStatusEl = document.getElementById("emailStatus");
  const updateBtn = document.getElementById("updateBtn");
  const updateStatusEl = document.getElementById("updateStatus");

  if (!hasData) {
    emailBtn.disabled = true;
    updateBtn.disabled = true;
    emailStatusEl.textContent = "";
    updateStatusEl.textContent = "";
  } else if (!isSingleDay) {
    emailBtn.disabled = true;
    updateBtn.disabled = true;
    const hint =
      'Zapis dotyczy jednego dnia — zawęź zakres dat ("Od"/"Do") na zakładce Dashboard do jednego dnia.';
    emailStatusEl.textContent = hint;
    updateStatusEl.textContent = hint;
  } else {
    emailBtn.disabled = false;
    updateBtn.disabled = false;
    // Na zakładce "Opóźnione linie" inputy pokazują inny zakres niż ten, który zostanie
    // zapisany — mówimy wprost, którego dnia dotyczy zapis/mail.
    const hint =
      activeTab === "delayed"
        ? `Dotyczy dnia z zakładki Dashboard: ${formatDatePl(from)}`
        : "";
    emailStatusEl.textContent = hint;
    updateStatusEl.textContent = hint;
  }
}

// Przycina zapamiętane zakresy dat danego klienta (obu zakładek) do zakresu jego własnych
// danych — czysta operacja na stanie, bez dotykania DOM. Musi działać dla KAŻDEGO
// importowanego klienta, niezależnie od tego, który jest akurat aktywną zakładką.
function clampDateRange(st) {
  const range = expectedDateRange(st.enrichedLines);
  if (range) {
    for (const r of Object.values(st.ranges)) {
      if (r.from < range.min || r.from > range.max) r.from = range.max;
      if (r.to < range.min || r.to > range.max) r.to = range.max;
      if (r.from > r.to) r.to = r.from;
    }
  }
  return range;
}

// Odzwierciedla w DOM (wspólne inputy "Od"/"Do") stan PODANEGO klienta — wolno wywoływać
// tylko dla aktualnie aktywnej zakładki, inaczej nadpiszemy widoczny filtr danymi
// klienta, który nie jest teraz wyświetlany.
function syncDateRangeInputs(st) {
  const fromInput = document.getElementById("dateFromInput");
  const toInput = document.getElementById("dateToInput");
  const monthBtn = document.getElementById("wholeMonthBtn");
  const range = clampDateRange(st);
  if (!range) {
    fromInput.disabled = true;
    toInput.disabled = true;
    monthBtn.disabled = true;
    fromInput.value = "";
    toInput.value = "";
    return;
  }
  fromInput.disabled = false;
  toInput.disabled = false;
  monthBtn.disabled = false;
  fromInput.min = toInput.min = toDateInputValue(range.min);
  fromInput.max = toInput.max = toDateInputValue(range.max);
  const { from, to } = activeRange(st);
  fromInput.value = toDateInputValue(from);
  toInput.value = toDateInputValue(to);
}

// Dopasowuje plik do klienta po numerze raportu zaszytym w nazwie pliku
// (3ME = "4009", Solventum = "8084" — patrz clients/*.js -> reportNumber).
function matchClientForFile(file) {
  return (
    clients.find((config) => file.name.includes(config.reportNumber)) || null
  );
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const matches = files.map((file) => ({
    file,
    config: matchClientForFile(file),
  }));
  const unmatched = matches.filter((m) => !m.config);
  const matched = matches.filter((m) => m.config);

  if (matched.length === 0) {
    const expected = clients
      .map((c) => `"${c.reportNumber}" (${c.name})`)
      .join(" lub ");
    document.getElementById("importStatus").textContent =
      `Nie rozpoznano klienta po nazwie pliku — oczekiwano numeru raportu ${expected} w nazwie.`;
    return;
  }

  for (const { file, config } of matched) {
    const st = state.get(config.id);
    try {
      const rows = await parseObdCsvFile(file, config.csv);
      st.enrichedLines = enrichLines(rows, config);
      st.fileName = file.name;
      st.ranges.delayed = defaultDelayedRange(st);
      clampDateRange(st);

      // Oceny (kod przyczyny/wina) żyją tylko w backendzie — patrz reviewsStore.js. Ściągamy
      // je przy każdym imporcie, żeby od razu było widać, co ktoś już uzupełnił, niezależnie
      // od komputera/przeglądarki, na której to zrobił.
      try {
        const reviewsByObd = await fetchDelayedLinesReviews(config.name);
        reviewsStore.hydrateFromBackend(config.id, reviewsByObd);
      } catch (err) {
        console.error("Nie udało się pobrać ocen z backendu", err);
        st.fileName +=
          " (uwaga: nie udało się pobrać ocen z backendu — sprawdź konsolę)";
      }
    } catch (err) {
      console.error(err);
      st.enrichedLines = [];
      st.fileName = `${file.name} (błąd wczytywania — sprawdź konsolę)`;
    }
  }

  if (unmatched.length > 0) {
    console.warn(
      "Pominięto pliki bez rozpoznanego klienta:",
      unmatched.map((m) => m.file.name),
    );
  }

  // DOM (inputy daty + status importu + dashboard) zawsze synchronizujemy tylko z danymi
  // aktualnie aktywnej zakładki — dane drugiego klienta zostają zapisane w stanie
  // (już przycięte przez clampDateRange powyżej) i pokażą się po przełączeniu na niego.
  syncDateRangeInputs(activeState());
  refreshImportStatus();
  renderAll();
}

function wireImport() {
  const input = document.getElementById("csvInput");
  document
    .getElementById("importBtn")
    .addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    handleFiles(input.files);
    input.value = ""; // pozwala wgrać ten sam plik ponownie (np. po poprawce w źródle)
  });
}

// Zapisuje do schowka RÓWNOLEGLE text/plain i text/html — dzięki temu wklejenie w Outlooku
// (Ctrl+V) daje prawdziwą sformatowaną tabelę (jak przy kopiowaniu z Excela), a nie tekst
// z tabulatorami. Zwraca true, jeśli udało się zapisać wersję HTML; false, jeśli przeglądarka
// tego nie wspiera i zadziałał tylko fallback na zwykły tekst.
async function copyReportToClipboard(textBody, htmlBody) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([textBody], { type: "text/plain" }),
          "text/html": new Blob([htmlBody], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch (err) {
      console.error(
        "Nie udało się skopiować jako tabela (HTML) — próbuję zwykły tekst.",
        err,
      );
    }
  }
  await navigator.clipboard.writeText(textBody);
  return false;
}

// Zapisuje (POST) albo nadpisuje (PATCH — patrz otsDailyApi.js upsertDailyResult) wynik
// jednego dnia dla aktywnego klienta w backendzie. Współdzielone przez przycisk maila i
// przycisk samego uaktualnienia bazy, bo obie ścieżki liczą i wysyłają dokładnie te same dane.
async function saveDayToBackend(st, dayLines, reviewsByObd) {
  const kpis = calculateKpis(dayLines, reviewsByObd, st.config);
  await upsertDailyResult({
    department: st.config.name,
    reportDate: toDateInputValue(st.ranges.dashboard.from),
    totalLines: kpis.total,
    grossOnTimeLines: kpis.onTime,
    netOnTimeLines: kpis.onTime + kpis.sumaObdLine,
    countries: calculateCountryBreakdown(dayLines),
    reasons: calculateReasonBreakdown(dayLines, reviewsByObd),
    delayedLines: buildDelayedLinesSnapshot(dayLines, reviewsByObd),
    performedBy: currentUserFullName("unknown"),
  });
}

// Wysyła raport: zapisuje dzień do backendu (patrz otsDailyApi.js), kopiuje gotową treść
// do schowka i otwiera pustego maila (adresaci "Do" + temat) w domyślnym kliencie pocztowym —
// świadomie NIE wstawiamy treści przez mailto:body=..., bo przy tabeli krajów (kilkadziesiąt
// wierszy) łatwo przekroczyć praktyczny limit długości linku mailto: i Outlook obciąłby
// treść bez ostrzeżenia.
function wireEmailButton() {
  const btn = document.getElementById("emailBtn");
  const statusEl = document.getElementById("emailStatus");

  btn.addEventListener("click", async () => {
    const st = activeState();
    if (st.enrichedLines.length === 0) return;

    // Raport (zapis do backendu + mail) dotyczy JEDNEGO dnia z zakładki Dashboard — trzymamy
    // się jej "from", co jest bezpieczne, bo refreshEmailButtonState() blokuje ten przycisk,
    // gdy zakres Dashboardu jest szerszy niż jeden dzień.
    const dayLines = linesInRange(st, "dashboard");
    const reviewsByObd = reviewsStore.getAllReviews(activeClientId);

    const { subject, to, textBody, htmlBody } = buildEmailReport({
      config: st.config,
      enrichedLines: st.enrichedLines,
      selectedDate: st.ranges.dashboard.from,
      reviewsByObd,
    });

    btn.disabled = true;
    statusEl.textContent = "Zapisuję do bazy…";

    let saveOk = true;
    try {
      await saveDayToBackend(st, dayLines, reviewsByObd);
    } catch (err) {
      console.error("Nie udało się zapisać dnia do backendu", err);
      saveOk = false;
    }

    let copyMsg;
    try {
      const copiedAsTable = await copyReportToClipboard(textBody, htmlBody);
      copyMsg = copiedAsTable
        ? "tabele skopiowane do schowka"
        : "treść skopiowana jako zwykły tekst (przeglądarka nie wspiera tabel)";
    } catch (err) {
      console.error(err);
      copyMsg = "nie udało się skopiować do schowka — sprawdź konsolę";
    }

    statusEl.textContent = `${saveOk ? "Zapisano do bazy" : "Błąd zapisu do bazy (sprawdź konsolę)"}, ${copyMsg} — wklej w mailu (Ctrl+V)`;
    btn.disabled = false;

    // Adresaci idą bezpośrednio po "mailto:" (przed "?") — mailto: (RFC 6068) nie ma parametru
    // "to=", większość klientów pocztowych by go po prostu zignorowała.
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}`;
  });
}

// Sama część "zapisz do bazy" z wireEmailButton, bez kopiowania do schowka i bez mailto: —
// pod poprawki zaległych/opóźnionych linii wstecz, które dotarły już PO wysłaniu maila za dany
// dzień: ktoś poprawia dane w zaimportowanym pliku (albo oceny w panelu "Opóźnione linie"),
// a tym przyciskiem nadpisuje zapisany wcześniej wiersz w bazie bez ponownego "wysyłania" maila.
function wireUpdateButton() {
  const btn = document.getElementById("updateBtn");
  const statusEl = document.getElementById("updateStatus");

  btn.addEventListener("click", async () => {
    const st = activeState();
    if (st.enrichedLines.length === 0) return;

    const dayLines = linesInRange(st, "dashboard");
    const reviewsByObd = reviewsStore.getAllReviews(activeClientId);

    btn.disabled = true;
    statusEl.textContent = "Zapisuję do bazy…";

    try {
      await saveDayToBackend(st, dayLines, reviewsByObd);
      statusEl.textContent = "Zaktualizowano dane w bazie";
    } catch (err) {
      console.error("Nie udało się zaktualizować dnia w backendzie", err);
      statusEl.textContent = "Błąd zapisu do bazy (sprawdź konsolę)";
    }

    btn.disabled = false;
  });
}

function wireDateRangeFilter() {
  const fromInput = document.getElementById("dateFromInput");
  const toInput = document.getElementById("dateToInput");
  const monthBtn = document.getElementById("wholeMonthBtn");

  // Wszystkie trzy kontrolki zmieniają zakres AKTYWNEJ zakładki (Dashboard / Opóźnione linie).
  fromInput.addEventListener("change", () => {
    const parsed = fromDateInputValue(fromInput.value);
    if (!parsed) return;
    const st = activeState();
    const r = activeRange(st);
    r.from = parsed;
    if (r.from > r.to) r.to = r.from;
    syncDateRangeInputs(st);
    renderAll();
  });

  toInput.addEventListener("change", () => {
    const parsed = fromDateInputValue(toInput.value);
    if (!parsed) return;
    const st = activeState();
    const r = activeRange(st);
    r.to = parsed;
    if (r.to < r.from) r.from = r.to;
    syncDateRangeInputs(st);
    renderAll();
  });

  // Rozszerza zakres do całego miesiąca kalendarzowego zawierającego aktualne "Od"
  // (przycięte do dostępnego zakresu danych — patrz clampDateRange).
  monthBtn.addEventListener("click", () => {
    const st = activeState();
    const range = expectedDateRange(st.enrichedLines);
    if (!range) return;
    const r = activeRange(st);
    const anchor = r.from; // miesiąc liczymy względem "Od", tak jak przed kliknięciem
    const monthStart = startOfMonth(anchor);
    const monthEnd = endOfMonth(anchor);
    r.from = monthStart < range.min ? range.min : monthStart;
    r.to = monthEnd > range.max ? range.max : monthEnd;
    syncDateRangeInputs(st);
    renderAll();
  });
}

function switchClient(clientId) {
  if (activeMode === "client" && clientId === activeClientId) return;
  if (!state.has(clientId)) return;
  const cameFromDash = activeMode === "dash";
  activeMode = "client";
  activeClientId = clientId;

  document.getElementById("railDashBtn").setAttribute("aria-current", "false");
  document.querySelectorAll(".rail-btn[data-client-id]").forEach((btn) => {
    btn.setAttribute(
      "aria-current",
      btn.dataset.clientId === clientId ? "true" : "false",
    );
  });
  document.getElementById("titleName").textContent = activeState().config.name;
  document.title = `OTS · On Time Shipment — ${activeState().config.name}`;

  if (cameFromDash) {
    document.querySelector(".topbar-controls").hidden = false;
    document.querySelector(".tabs").hidden = false;
    document.getElementById("view-dash").hidden = true;
    const selectedTab = document.querySelector('.tab[aria-selected="true"]');
    document.getElementById("view-dashboard").hidden =
      selectedTab?.dataset.tab !== "dashboard";
    document.getElementById("view-delayed").hidden =
      selectedTab?.dataset.tab !== "delayed";
  }

  syncDateRangeInputs(activeState());
  refreshImportStatus();
  renderAll();
}

// Zakładka DASH (rail, ikona wykresu) — trend KPI Gross/Net z wyników zapisanych w
// backendzie, niezależny od per-klienckiego stanu CSV powyżej. Chowa cały topbar
// import/filtr-daty/mail i zakładki Dashboard/Opóźnione linie (mają sens tylko dla
// zaimportowanego pliku jednego klienta), pokazuje samą kartę z wykresem.
function switchToDash() {
  if (activeMode === "dash") return;
  activeMode = "dash";

  document.querySelectorAll(".rail-btn[data-client-id]").forEach((btn) => {
    btn.setAttribute("aria-current", "false");
  });
  document.getElementById("railDashBtn").setAttribute("aria-current", "true");
  document.getElementById("titleName").textContent = "Dashboard KPI";
  document.title = "OTS · On Time Shipment — Dashboard KPI";

  document.querySelector(".topbar-controls").hidden = true;
  document.querySelector(".tabs").hidden = true;
  document.getElementById("view-dashboard").hidden = true;
  document.getElementById("view-delayed").hidden = true;
  document.getElementById("view-dash").hidden = false;

  loadAndRenderDash();
}

// Ładuje WSZYSTKIE zapisane wyniki (wszystkich klientów) przy każdym wejściu w DASH —
// tak samo jak reszta otsDailyApi.js, endpoint nie ma filtrowanego GET, więc nie ma sensu
// cache'ować to między wizytami (dane i tak mogły się zmienić po zapisaniu nowego dnia).
async function loadAndRenderDash() {
  const statusEl = document.getElementById("dashChartStatus");
  statusEl.textContent = "Wczytywanie danych…";
  try {
    const results = await fetchAllResults();
    setDashResults(results);
  } catch (err) {
    console.error("Nie udało się wczytać danych dashboardu", err);
    statusEl.textContent = "Błąd wczytywania danych — sprawdź konsolę.";
  }
}

function wireRail() {
  document.querySelectorAll(".rail-btn[data-client-id]").forEach((btn) => {
    btn.addEventListener("click", () => switchClient(btn.dataset.clientId));
  });
  document
    .getElementById("railDashBtn")
    .addEventListener("click", () => switchToDash());
}

function wireTabs() {
  const tabs = document.querySelectorAll(".tab");
  const views = {
    dashboard: document.getElementById("view-dashboard"),
    delayed: document.getElementById("view-delayed"),
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) =>
        t.setAttribute("aria-selected", t === tab ? "true" : "false"),
      );
      Object.entries(views).forEach(([key, el]) => {
        el.hidden = key !== tab.dataset.tab;
      });
      // Każda zakładka ma własny zakres dat — przestawiamy wspólne inputy "Od"/"Do" (i licznik
      // linii pod nimi) na zakres właśnie otwartej zakładki. Obie tabele są już wyrenderowane
      // dla swoich zakresów, więc renderAll() nie jest tu potrzebne.
      activeTab = tab.dataset.tab;
      syncDateRangeInputs(activeState());
      updateDateFilterHint();
      refreshEmailButtonState();
    });
  });
}

// Wspólny z aplikacją-hostem klucz localStorage — motyw ma być jeden dla całej aplikacji,
// nie osobny dla tego modułu. Wartość początkowa jest już ustawiona synchronicznie przez
// inline <script> w <head> (index.html), więc tutaj tylko piszemy zmiany i nasłuchujemy
// zmian z zewnątrz.
const THEME_STORAGE_KEY = "cp-theme";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function wireTheme() {
  const toggleBtn = document.getElementById("themeToggle");

  // W Fiege Cloud appka żyje w iframe hosta, który ma własny, zawsze widoczny przełącznik
  // motywu (współdzielący z nami "cp-theme") — nasz byłby zdublowanym UI, więc go chowamy.
  // Przy standalone developmencie (Live Server, bez hosta) window.self === window.top,
  // więc przycisk zostaje widoczny i działa — jedyny sposób na przełączenie motywu bez hosta.
  const isEmbedded = window.self !== window.top;
  if (isEmbedded) {
    toggleBtn.hidden = true;
  } else {
    toggleBtn.addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

  // "storage" odpala się tylko w INNYCH kontekstach przeglądarki (np. host-aplikacja
  // współdzieląca ten sam localStorage), nigdy w tym, który sam zapisał — więc to
  // synchronizacja Z ZEWNĄTRZ, gdyby ktoś przełączył motyw poza tym modułem.
  window.addEventListener("storage", (e) => {
    if (
      e.key === THEME_STORAGE_KEY &&
      (e.newValue === "dark" || e.newValue === "light")
    ) {
      document.documentElement.setAttribute("data-theme", e.newValue);
    }
  });
}

wireImport();
wireDateRangeFilter();
wireEmailButton();
wireUpdateButton();
wireRail();
wireTabs();
wireTheme();
wireDelayedFilters();
initDashView(clients);
document.getElementById("titleName").textContent = activeState().config.name;
