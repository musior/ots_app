import { client3me } from './clients/3me.js';
import { parseObdCsvFile } from './csvParser.js';
import { enrichLines, filterByAdjustedDate, adjustedDateRange } from './calcEngine.js';
import * as reviewsStore from './reviewsStore.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderDelayedPanel, wireDelayedFilters } from './ui/delayedPanel.js';
import { addDays, startOfToday, toDateInputValue, fromDateInputValue } from './dateUtils.js';

const config = client3me;
const clientId = client3me.id;

let enrichedLines = [];
// Domyślnie: wczoraj. Filtrujemy po AdjustedExpectedDate (skorygowanej), nie po
// surowym EXPECTED_SHIP_DATE — patrz calcEngine.filterByAdjustedDate.
let selectedDate = addDays(startOfToday(), -1);

function reviewsByLineId() {
  return reviewsStore.getAllReviews(clientId);
}

function visibleLines() {
  return filterByAdjustedDate(enrichedLines, selectedDate);
}

function renderAll() {
  const lines = visibleLines();
  renderDashboard({ lines, reviewsByLineId: reviewsByLineId(), config });
  renderDelayedPanel({ lines, config, clientId, onChange: renderAll });
  updateDateFilterHint(lines.length);
}

function updateDateFilterHint(count) {
  const hintEl = document.getElementById('dateFilterHint');
  if (enrichedLines.length === 0) {
    hintEl.textContent = '';
    return;
  }
  hintEl.textContent = count > 0
    ? `${count} ${count === 1 ? 'linia' : 'linii'} dla tej daty`
    : 'Brak linii dla wybranej daty w zaimportowanym pliku';
}

function setImportStatus(text) {
  document.getElementById('importStatus').textContent = text;
}

function setDateFilterBounds() {
  const input = document.getElementById('dateFilter');
  const range = adjustedDateRange(enrichedLines);
  if (!range) {
    input.disabled = true;
    return;
  }
  input.disabled = false;
  input.min = toDateInputValue(range.min);
  input.max = toDateInputValue(range.max);

  // Jeśli domyślna data (wczoraj) leży poza zakresem zaimportowanego pliku
  // (typowe przy testowaniu na starszej próbce), pokaż zamiast niej najnowszą
  // dostępną datę — ale tylko przy pierwszym imporcie, nie nadpisuj świadomego
  // wyboru użytkownika przy kolejnych importach tego samego dnia.
  if (selectedDate < range.min || selectedDate > range.max) {
    selectedDate = range.max;
  }
  input.value = toDateInputValue(selectedDate);
}

async function handleFile(file) {
  if (!file) return;
  setImportStatus(`Wczytuję ${file.name}…`);
  try {
    const rows = await parseObdCsvFile(file, config.csv);
    enrichedLines = enrichLines(rows, config);
    setImportStatus(`${file.name} · ${enrichedLines.length} linii`);
    setDateFilterBounds();
    renderAll();
  } catch (err) {
    console.error(err);
    setImportStatus('Błąd wczytywania pliku — sprawdź konsolę');
  }
}

function wireImport() {
  const input = document.getElementById('csvInput');
  document.getElementById('importBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleFile(input.files?.[0]));
}

function wireDateFilter() {
  const input = document.getElementById('dateFilter');
  input.value = toDateInputValue(selectedDate);
  input.addEventListener('change', () => {
    const parsed = fromDateInputValue(input.value);
    if (!parsed) return;
    selectedDate = parsed;
    renderAll();
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
wireTabs();
wireTheme();
wireDelayedFilters();
document.getElementById('titleName').textContent = config.name;
