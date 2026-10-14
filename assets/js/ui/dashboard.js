import {
  calculateKpis,
  calculateCountryBreakdown,
  calculateReasonBreakdown,
} from "../calcEngine.js";
import { formatPercent } from "../dateUtils.js";

export const OK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12.5l5 5L20 6.5"/></svg>';
export const NOK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let countryRows = [];
let countryTotals = null;
let countrySort = { field: "total", dir: "desc" };

function pctClass(pct, target, warn) {
  if (pct >= target / 100) return "good";
  if (pct >= warn / 100) return "warn";
  return "bad";
}

// Karta/status KPI: kolor tła+ramki wg progu (good/warn/bad), a ikona OK/NOK
// binarnie wg tego, czy wynik dobił do celu (targetPct) czy nie.
function applyKpiStatus(cardEl, statusEl, pct, config, warnPct) {
  const cls = pctClass(pct, config.targetPct, warnPct);
  cardEl.classList.remove("kpi--good", "kpi--warn", "kpi--bad");
  cardEl.classList.add(`kpi--${cls}`);

  const isOk = pct >= config.targetPct / 100;
  statusEl.className = `kpi-status ${isOk ? "ok" : "nok"}`;
  statusEl.innerHTML = `
    <div class="kpi-status-icon">${isOk ? OK_ICON : NOK_ICON}</div>
    <span class="kpi-status-label">${isOk ? "OK" : "NOK"}</span>`;
}

function renderCountryTable() {
  // Brak danych dla aktywnego klienta (patrz renderEmptyDashboard) — tabela już pokazuje
  // placeholder "Brak zaimportowanych danych", nie ma czego przeliczać/filtrować.
  if (!countryTotals) return;

  const search = document
    .getElementById("countrySearch")
    .value.trim()
    .toUpperCase();
  const filtered = search
    ? countryRows.filter((r) => r.country.toUpperCase().includes(search))
    : countryRows.slice();

  const { field, dir } = countrySort;
  const mul = dir === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (field === "country") return a.country.localeCompare(b.country) * mul;
    return (a[field] - b[field]) * mul;
  });

  document.querySelectorAll("#view-dashboard th[data-field]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.field === field);
    const arrow = th.querySelector(".sort-arrow");
    if (arrow)
      arrow.textContent =
        th.dataset.field === field ? (dir === "asc" ? "▲" : "▼") : "";
  });

  const countryBody = document.getElementById("countryTable");
  countryBody.innerHTML = "";
  if (filtered.length === 0) {
    countryBody.innerHTML =
      '<tr><td colspan="5" style="color:var(--text-muted)">Brak kraju pasującego do wyszukiwania</td></tr>';
  } else {
    for (const row of filtered) {
      const cls = pctClass(
        row.grossPct,
        countryTotals.targetPct,
        countryTotals.warnPct,
      );
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="kraj">${row.country}</td>
        <td class="num">${row.total}</td>
        <td class="num">${row.onTime}</td>
        <td class="num">${row.toExplain}</td>
        <td class="num"><span class="pct-cell"><i class="pct-dot ${cls}"></i>${formatPercent(row.grossPct)}</span></td>`;
      countryBody.appendChild(tr);
    }
  }

  const totalTr = document.createElement("tr");
  totalTr.className = "total";
  totalTr.innerHTML = `
    <td class="kraj">Suma</td>
    <td class="num">${countryTotals.total}</td>
    <td class="num">${countryTotals.onTime}</td>
    <td class="num">${countryTotals.total - countryTotals.onTime}</td>
    <td class="num">${formatPercent(countryTotals.gross)}</td>`;
  countryBody.appendChild(totalTr);

  document.getElementById("countryHint").textContent =
    `${filtered.length}/${countryRows.length} ${countryRows.length === 1 ? "kraj" : "krajów"}`;
}

function wireCountryTableControls() {
  document
    .getElementById("countrySearch")
    .addEventListener("input", renderCountryTable);
  document.querySelectorAll("#view-dashboard th[data-field]").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.dataset.field;
      if (countrySort.field === field) {
        countrySort.dir = countrySort.dir === "asc" ? "desc" : "asc";
      } else {
        countrySort = { field, dir: field === "country" ? "asc" : "desc" };
      }
      renderCountryTable();
    });
  });
}

let controlsWired = false;

// Resetuje karty KPI i tabele do neutralnego stanu "—" / brak danych — używane, gdy dla
// aktywnego klienta nic jeszcze nie zaimportowano. Bez tego calculateKpis policzyłby
// KPI z 0 linii jako 0,00% i pokazałby mylące "NOK", zamiast po prostu pustego stanu.
export function renderEmptyDashboard() {
  for (const id of ["Gross", "Net", "PL", "EU", "NONEU"]) {
    const cardEl = document.getElementById("card" + id);
    const statusEl = document.getElementById("status" + id);
    const valueEl = document.getElementById("value" + id);
    if (!cardEl || !statusEl || !valueEl) continue;
    cardEl.classList.remove("kpi--good", "kpi--warn", "kpi--bad");
    statusEl.className = "kpi-status";
    statusEl.innerHTML = "";
    valueEl.textContent = "—";
  }
  document.getElementById("subGross").textContent = "";
  document.getElementById("subNet").textContent = "";

  countryRows = [];
  countryTotals = null;
  document.getElementById("countryTable").innerHTML =
    '<tr><td colspan="5" style="color:var(--text-muted)">Brak zaimportowanych danych</td></tr>';
  document.getElementById("countryHint").textContent = "";

  document.getElementById("reasonTable").innerHTML =
    '<tr><td colspan="4" style="color:var(--text-muted)">Brak jeszcze uzupełnionych linii</td></tr>';
}

export function renderDashboard({ lines, reviewsByObd, config }) {
  const warnPct = config.warnPct;
  const kpis = calculateKpis(lines, reviewsByObd, config);

  applyKpiStatus(
    document.getElementById("cardGross"),
    document.getElementById("statusGross"),
    kpis.gross,
    config,
    warnPct,
  );
  document.getElementById("valueGross").textContent = formatPercent(kpis.gross);
  document.getElementById("subGross").innerHTML =
    `<b class="num">${kpis.onTime}</b>/<span class="num">${kpis.total}</span> linii na czas · próg <b>${String(config.targetPct).replace(".", ",")}%</b>`;

  applyKpiStatus(
    document.getElementById("cardNet"),
    document.getElementById("statusNet"),
    kpis.net,
    config,
    warnPct,
  );
  document.getElementById("valueNet").textContent = formatPercent(kpis.net);
  document.getElementById("subNet").textContent =
    kpis.sumaObdLine > 0
      ? `w tym ${kpis.sumaObdLine} nie obniżających wyniku netto.`
      : "brak uzupełnionych powodów opóźnień (wszystkie linie obniżają wynik netto).";

  for (const region of ["PL", "EU", "NON EU"]) {
    const key = region.replace(" ", "");
    const cardEl = document.getElementById("card" + key);
    const statusEl = document.getElementById("status" + key);
    const valueEl = document.getElementById("value" + key);
    if (!cardEl || !statusEl || !valueEl) continue;
    const pct = kpis.regions[region] ?? 0;
    applyKpiStatus(cardEl, statusEl, pct, config, warnPct);
    valueEl.textContent = formatPercent(pct);
  }

  // Tabela wg kraju — dane liczymy raz tutaj, ale renderowanie (z filtrem/sortem)
  // jest osobną funkcją, żeby szukanie/sortowanie nie wymagało przeliczania KPI.
  countryRows = calculateCountryBreakdown(lines);
  countryTotals = {
    total: kpis.total,
    onTime: kpis.onTime,
    gross: kpis.gross,
    targetPct: config.targetPct,
    warnPct,
  };
  if (!controlsWired) {
    wireCountryTableControls();
    controlsWired = true;
  }
  renderCountryTable();

  // Tabela wg reason code
  const reasons = calculateReasonBreakdown(lines, reviewsByObd);
  const reasonBody = document.getElementById("reasonTable");
  reasonBody.innerHTML = "";
  if (reasons.length === 0) {
    reasonBody.innerHTML =
      '<tr><td colspan="4" style="color:var(--text-muted)">Brak jeszcze uzupełnionych linii</td></tr>';
  } else {
    for (const r of reasons) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.reasonCode}</td>
        <td class="num">${r.magazyn}</td>
        <td class="num">${r.klient}</td>
        <td class="num">${r.total}</td>`;
      reasonBody.appendChild(tr);
    }
  }

  return kpis;
}
