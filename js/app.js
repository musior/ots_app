import { client3me } from './clients/3me.js';
import { parseObdCsvFile } from './csvParser.js';
import { enrichLines } from './calcEngine.js';
import * as reviewsStore from './reviewsStore.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderDelayedPanel, wireDelayedFilters } from './ui/delayedPanel.js';

const config = client3me;
const clientId = client3me.id;

let enrichedLines = [];

function reviewsByLineId() {
  return reviewsStore.getAllReviews(clientId);
}

function renderAll() {
  renderDashboard({ lines: enrichedLines, reviewsByLineId: reviewsByLineId(), config });
  renderDelayedPanel({ lines: enrichedLines, config, clientId, onChange: renderAll });
}

function setImportStatus(text) {
  document.getElementById('importStatus').textContent = text;
}

async function handleFile(file) {
  if (!file) return;
  setImportStatus(`Wczytuję ${file.name}…`);
  try {
    const rows = await parseObdCsvFile(file, config.csv);
    enrichedLines = enrichLines(rows, config);
    setImportStatus(`${file.name} · ${enrichedLines.length} linii`);
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
wireTabs();
wireTheme();
wireDelayedFilters();
document.getElementById('titleName').textContent = config.name;
