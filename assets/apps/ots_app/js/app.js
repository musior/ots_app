import { client3me } from './clients/3me.js';
import { clientSolventum } from './clients/solventum.js';
import { parseObdCsvFile } from './csvParser.js';
import { enrichLines, filterByAdjustedDateRange, adjustedDateRange } from './calcEngine.js';
import * as reviewsStore from './reviewsStore.js';
import { renderDashboard, renderEmptyDashboard } from './ui/dashboard.js';
import { renderDelayedPanel, wireDelayedFilters } from './ui/delayedPanel.js';
import { buildEmailReport } from './emailReport.js';
import {
  previousBusinessDay, startOfToday, startOfMonth, endOfMonth, toDateInputValue, fromDateInputValue, isSameDay,
} from './dateUtils.js';

const clients = [client3me, clientSolventum];

// Stan trzymany osobno per klient — przełączanie zakładki (3ME/SLV) nie gubi
// zaimportowanych danych ani wybranego zakresu dat tego drugiego klienta. dateFrom/dateTo
// to zakres (obie granice włącznie) — domyślnie pojedynczy dzień (from === to), ale
// dashboard może pokazywać dowolnie szerszy okres, np. cały miesiąc.
const state = new Map(
  clients.map((config) => [
    config.id,
    {
      config,
      enrichedLines: [],
      dateFrom: previousBusinessDay(startOfToday()),
      dateTo: previousBusinessDay(startOfToday()),
      fileName: null,
    },
  ]),
);

let activeClientId = client3me.id;

function activeState() {
  return state.get(activeClientId);
}

function visibleLines() {
  const st = activeState();
  return filterByAdjustedDateRange(st.enrichedLines, st.dateFrom, st.dateTo);
}

// Pełny render: wywoływany po imporcie pliku, po zmianie filtra daty i po
// przełączeniu klienta — jedyne sytuacje, w których zbiór linii faktycznie się zmienia.
function renderAll() {
  const lines = visibleLines();
  // Dopóki dla aktywnego klienta nic nie zaimportowano, nie liczymy KPI z 0 linii
  // (wyszłoby mylące "0,00% NOK") — pokazujemy neutralny stan pusty.
  if (activeState().enrichedLines.length === 0) {
    renderEmptyDashboard();
  } else {
    refreshDashboard(lines);
  }
  renderDelayedPanel({ lines, config: activeState().config, clientId: activeClientId, onChange: refreshDashboardAfterReview });
  updateDateFilterHint(lines.length);
  refreshEmailButtonState();
}

function refreshDashboard(lines) {
  renderDashboard({ lines, reviewsByObd: reviewsStore.getAllReviews(activeClientId), config: activeState().config });
}

// Wywoływane po zapisaniu/edycji oceny w panelu "Opóźnione linie". Odświeża
// TYLKO dashboard (bo Gross/Net zależą od reviewsStore) — celowo NIE wywołuje
// renderDelayedPanel, żeby nie przebudowywać całej tabeli i nie czyścić
// niezapisanych jeszcze zmian w innych wierszach.
function refreshDashboardAfterReview() {
  refreshDashboard(visibleLines());
}

function updateDateFilterHint(count) {
  const hintEl = document.getElementById('dateFilterHint');
  if (activeState().enrichedLines.length === 0) {
    hintEl.textContent = '';
    return;
  }
  hintEl.textContent = count > 0
    ? `${count} ${count === 1 ? 'linia' : 'linii'} w wybranym zakresie`
    : 'Brak linii w wybranym zakresie dat w zaimportowanym pliku';
}

function importStatusText(st) {
  return st.fileName ? `${st.fileName} · ${st.enrichedLines.length} linii` : 'Brak zaimportowanych danych';
}

function refreshImportStatus() {
  document.getElementById('importStatus').textContent = importStatusText(activeState());
}

// Przycisk maila ma sens tylko wtedy, gdy dla aktywnego klienta w ogóle coś zaimportowano
// (inaczej raport wyszedłby z samymi zerami) I wybrany jest DOKŁADNIE jeden dzień — szablon
// maila (emailReport.js) mówi "Wynik OTS za dzień X", więc wysłanie go przy wybranym
// zakresie (np. cały miesiąc) pokazywałoby mylącą, niepełną liczbę. Czyścimy też status
// "skopiowano", żeby nie wprowadzał w błąd po zmianie kontekstu (klient / zakres / import).
function refreshEmailButtonState() {
  const st = activeState();
  const btn = document.getElementById('emailBtn');
  const statusEl = document.getElementById('emailStatus');
  const isSingleDay = isSameDay(st.dateFrom, st.dateTo);

  if (st.enrichedLines.length === 0) {
    btn.disabled = true;
    statusEl.textContent = '';
  } else if (!isSingleDay) {
    btn.disabled = true;
    statusEl.textContent = 'Mail dotyczy jednego dnia — zawęź zakres dat ("Od"/"Do") do jednego dnia, żeby wysłać raport.';
  } else {
    btn.disabled = false;
    statusEl.textContent = '';
  }
}

// Przycina zapamiętany zakres dat danego klienta do zakresu jego własnych danych —
// czysta operacja na stanie, bez dotykania DOM. Musi działać dla KAŻDEGO importowanego
// klienta, niezależnie od tego, który jest akurat aktywną zakładką.
function clampDateRange(st) {
  const range = adjustedDateRange(st.enrichedLines);
  if (range) {
    if (st.dateFrom < range.min || st.dateFrom > range.max) st.dateFrom = range.max;
    if (st.dateTo < range.min || st.dateTo > range.max) st.dateTo = range.max;
    if (st.dateFrom > st.dateTo) st.dateTo = st.dateFrom;
  }
  return range;
}

// Odzwierciedla w DOM (wspólne inputy "Od"/"Do") stan PODANEGO klienta — wolno wywoływać
// tylko dla aktualnie aktywnej zakładki, inaczej nadpiszemy widoczny filtr danymi
// klienta, który nie jest teraz wyświetlany.
function syncDateRangeInputs(st) {
  const fromInput = document.getElementById('dateFromInput');
  const toInput = document.getElementById('dateToInput');
  const monthBtn = document.getElementById('wholeMonthBtn');
  const range = clampDateRange(st);
  if (!range) {
    fromInput.disabled = true;
    toInput.disabled = true;
    monthBtn.disabled = true;
    fromInput.value = '';
    toInput.value = '';
    return;
  }
  fromInput.disabled = false;
  toInput.disabled = false;
  monthBtn.disabled = false;
  fromInput.min = toInput.min = toDateInputValue(range.min);
  fromInput.max = toInput.max = toDateInputValue(range.max);
  fromInput.value = toDateInputValue(st.dateFrom);
  toInput.value = toDateInputValue(st.dateTo);
}

// Dopasowuje plik do klienta po numerze raportu zaszytym w nazwie pliku
// (3ME = "4009", Solventum = "8084" — patrz clients/*.js -> reportNumber).
function matchClientForFile(file) {
  return clients.find((config) => file.name.includes(config.reportNumber)) || null;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const matches = files.map((file) => ({ file, config: matchClientForFile(file) }));
  const unmatched = matches.filter((m) => !m.config);
  const matched = matches.filter((m) => m.config);

  if (matched.length === 0) {
    const expected = clients.map((c) => `"${c.reportNumber}" (${c.name})`).join(' lub ');
    document.getElementById('importStatus').textContent =
      `Nie rozpoznano klienta po nazwie pliku — oczekiwano numeru raportu ${expected} w nazwie.`;
    return;
  }

  for (const { file, config } of matched) {
    const st = state.get(config.id);
    try {
      const rows = await parseObdCsvFile(file, config.csv);
      st.enrichedLines = enrichLines(rows, config);
      st.fileName = file.name;
      clampDateRange(st);
    } catch (err) {
      console.error(err);
      st.enrichedLines = [];
      st.fileName = `${file.name} (błąd wczytywania — sprawdź konsolę)`;
    }
  }

  if (unmatched.length > 0) {
    console.warn('Pominięto pliki bez rozpoznanego klienta:', unmatched.map((m) => m.file.name));
  }

  // DOM (inputy daty + status importu + dashboard) zawsze synchronizujemy tylko z danymi
  // aktualnie aktywnej zakładki — dane drugiego klienta zostają zapisane w stanie
  // (już przycięte przez clampDateRange powyżej) i pokażą się po przełączeniu na niego.
  syncDateRangeInputs(activeState());
  refreshImportStatus();
  renderAll();
}

function wireImport() {
  const input = document.getElementById('csvInput');
  document.getElementById('importBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    handleFiles(input.files);
    input.value = ''; // pozwala wgrać ten sam plik ponownie (np. po poprawce w źródle)
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
          'text/plain': new Blob([textBody], { type: 'text/plain' }),
          'text/html': new Blob([htmlBody], { type: 'text/html' }),
        }),
      ]);
      return true;
    } catch (err) {
      console.error('Nie udało się skopiować jako tabela (HTML) — próbuję zwykły tekst.', err);
    }
  }
  await navigator.clipboard.writeText(textBody);
  return false;
}

// Kopiuje gotową treść raportu do schowka i otwiera pustego maila (tylko z tematem) w
// domyślnym kliencie pocztowym — świadomie NIE wstawiamy treści przez mailto:body=...,
// bo przy tabeli krajów (kilkadziesiąt wierszy) łatwo przekroczyć praktyczny limit
// długości linku mailto: i Outlook obciąłby treść bez ostrzeżenia.
function wireEmailButton() {
  const btn = document.getElementById('emailBtn');
  const statusEl = document.getElementById('emailStatus');

  btn.addEventListener('click', async () => {
    const st = activeState();
    if (st.enrichedLines.length === 0) return;

    // Raport mailowy ma format "za jeden dzień" (patrz emailReport.js) — trzymamy się
    // dateFrom, co jest bezpieczne, bo refreshEmailButtonState() blokuje ten przycisk,
    // gdy wybrany jest zakres szerszy niż jeden dzień.
    const { subject, textBody, htmlBody } = buildEmailReport({
      config: st.config,
      enrichedLines: st.enrichedLines,
      selectedDate: st.dateFrom,
      reviewsByObd: reviewsStore.getAllReviews(activeClientId),
    });

    try {
      const copiedAsTable = await copyReportToClipboard(textBody, htmlBody);
      statusEl.textContent = copiedAsTable
        ? 'Tabele skopiowane do schowka — wklej w mailu (Ctrl+V)'
        : 'Treść skopiowana do schowka jako zwykły tekst (przeglądarka nie wspiera tabel) — wklej w mailu (Ctrl+V)';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Nie udało się skopiować do schowka — sprawdź konsolę';
    }

    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
  });
}

function wireDateRangeFilter() {
  const fromInput = document.getElementById('dateFromInput');
  const toInput = document.getElementById('dateToInput');
  const monthBtn = document.getElementById('wholeMonthBtn');

  fromInput.addEventListener('change', () => {
    const parsed = fromDateInputValue(fromInput.value);
    if (!parsed) return;
    const st = activeState();
    st.dateFrom = parsed;
    if (st.dateFrom > st.dateTo) st.dateTo = st.dateFrom;
    syncDateRangeInputs(st);
    renderAll();
  });

  toInput.addEventListener('change', () => {
    const parsed = fromDateInputValue(toInput.value);
    if (!parsed) return;
    const st = activeState();
    st.dateTo = parsed;
    if (st.dateTo < st.dateFrom) st.dateFrom = st.dateTo;
    syncDateRangeInputs(st);
    renderAll();
  });

  // Rozszerza zakres do całego miesiąca kalendarzowego zawierającego aktualne "Od"
  // (przycięte do dostępnego zakresu danych — patrz clampDateRange).
  monthBtn.addEventListener('click', () => {
    const st = activeState();
    const range = adjustedDateRange(st.enrichedLines);
    if (!range) return;
    const anchor = st.dateFrom; // miesiąc liczymy względem "Od", tak jak przed kliknięciem
    const monthStart = startOfMonth(anchor);
    const monthEnd = endOfMonth(anchor);
    st.dateFrom = monthStart < range.min ? range.min : monthStart;
    st.dateTo = monthEnd > range.max ? range.max : monthEnd;
    syncDateRangeInputs(st);
    renderAll();
  });
}

function switchClient(clientId) {
  if (clientId === activeClientId || !state.has(clientId)) return;
  activeClientId = clientId;

  document.querySelectorAll('.rail-btn[data-client-id]').forEach((btn) => {
    btn.setAttribute('aria-current', btn.dataset.clientId === clientId ? 'true' : 'false');
  });
  document.getElementById('titleName').textContent = activeState().config.name;
  document.title = `OTS · On Time Shipment — ${activeState().config.name}`;

  syncDateRangeInputs(activeState());
  refreshImportStatus();
  renderAll();
}

function wireRail() {
  document.querySelectorAll('.rail-btn[data-client-id]').forEach((btn) => {
    btn.addEventListener('click', () => switchClient(btn.dataset.clientId));
  });
}

function wireTabs() {
  const tabs = document.querySelectorAll('.tab');
  const views = { dashboard: document.getElementById('view-dashboard'), delayed: document.getElementById('view-delayed') };
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
      Object.entries(views).forEach(([key, el]) => { el.hidden = key !== tab.dataset.tab; });
    });
  });
}

function wireTheme() {
  const root = document.documentElement;
  document.getElementById('themeToggle').addEventListener('click', () => {
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

wireImport();
wireDateRangeFilter();
wireEmailButton();
wireRail();
wireTabs();
wireTheme();
wireDelayedFilters();
document.getElementById('titleName').textContent = activeState().config.name;
