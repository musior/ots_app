import { client3me } from './clients/3me.js';
import { clientSolventum } from './clients/solventum.js';
import { parseObdCsvFile } from './csvParser.js';
import { enrichLines, filterByAdjustedDate, adjustedDateRange } from './calcEngine.js';
import * as reviewsStore from './reviewsStore.js';
import { renderDashboard, renderEmptyDashboard } from './ui/dashboard.js';
import { renderDelayedPanel, wireDelayedFilters } from './ui/delayedPanel.js';
import { buildEmailReport } from './emailReport.js';
import { previousBusinessDay, startOfToday, toDateInputValue, fromDateInputValue } from './dateUtils.js';

const clients = [client3me, clientSolventum];

// Stan trzymany osobno per klient — przełączanie zakładki (3ME/SLV) nie gubi
// zaimportowanych danych ani wybranej daty filtra tego drugiego klienta.
const state = new Map(
  clients.map((config) => [
    config.id,
    {
      config,
      enrichedLines: [],
      selectedDate: previousBusinessDay(startOfToday()),
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
  return filterByAdjustedDate(st.enrichedLines, st.selectedDate);
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
    ? `${count} ${count === 1 ? 'linia' : 'linii'} dla tej daty`
    : 'Brak linii dla wybranej daty w zaimportowanym pliku';
}

function importStatusText(st) {
  return st.fileName ? `${st.fileName} · ${st.enrichedLines.length} linii` : 'Brak zaimportowanych danych';
}

function refreshImportStatus() {
  document.getElementById('importStatus').textContent = importStatusText(activeState());
}

// Przycisk maila ma sens tylko wtedy, gdy dla aktywnego klienta w ogóle coś zaimportowano —
// inaczej raport wyszedłby z samymi zerami. Czyścimy też status "skopiowano", żeby nie
// wprowadzał w błąd po zmianie kontekstu (inny klient / inna data / nowy import).
function refreshEmailButtonState() {
  document.getElementById('emailBtn').disabled = activeState().enrichedLines.length === 0;
  document.getElementById('emailStatus').textContent = '';
}

// Przycina zapamiętaną datę filtra danego klienta do zakresu jego własnych danych —
// czysta operacja na stanie, bez dotykania DOM. Musi działać dla KAŻDEGO importowanego
// klienta, niezależnie od tego, który jest akurat aktywną zakładką.
function clampSelectedDate(st) {
  const range = adjustedDateRange(st.enrichedLines);
  if (range && (st.selectedDate < range.min || st.selectedDate > range.max)) {
    st.selectedDate = range.max;
  }
  return range;
}

// Odzwierciedla w DOM (wspólny input daty) stan PODANEGO klienta — wolno wywoływać
// tylko dla aktualnie aktywnej zakładki, inaczej nadpiszemy widoczny filtr danymi
// klienta, który nie jest teraz wyświetlany.
function syncDateFilterInput(st) {
  const input = document.getElementById('dateFilter');
  const range = clampSelectedDate(st);
  if (!range) {
    input.disabled = true;
    input.value = '';
    return;
  }
  input.disabled = false;
  input.min = toDateInputValue(range.min);
  input.max = toDateInputValue(range.max);
  input.value = toDateInputValue(st.selectedDate);
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
      clampSelectedDate(st);
    } catch (err) {
      console.error(err);
      st.enrichedLines = [];
      st.fileName = `${file.name} (błąd wczytywania — sprawdź konsolę)`;
    }
  }

  if (unmatched.length > 0) {
    console.warn('Pominięto pliki bez rozpoznanego klienta:', unmatched.map((m) => m.file.name));
  }

  // DOM (input daty + status importu + dashboard) zawsze synchronizujemy tylko z danymi
  // aktualnie aktywnej zakładki — dane drugiego klienta zostają zapisane w stanie
  // (już przycięte przez clampSelectedDate powyżej) i pokażą się po przełączeniu na niego.
  syncDateFilterInput(activeState());
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

    const { subject, textBody, htmlBody } = buildEmailReport({
      config: st.config,
      enrichedLines: st.enrichedLines,
      selectedDate: st.selectedDate,
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

function wireDateFilter() {
  const input = document.getElementById('dateFilter');
  input.addEventListener('change', () => {
    const parsed = fromDateInputValue(input.value);
    if (!parsed) return;
    activeState().selectedDate = parsed;
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

  syncDateFilterInput(activeState());
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
wireDateFilter();
wireEmailButton();
wireRail();
wireTabs();
wireTheme();
wireDelayedFilters();
document.getElementById('titleName').textContent = activeState().config.name;
