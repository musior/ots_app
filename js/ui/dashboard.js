import { calculateKpis, calculateCountryBreakdown, calculateReasonBreakdown } from '../calcEngine.js';
import { formatPercent } from '../dateUtils.js';
import { renderGauge } from './gauge.js';

function pctClass(pct, target, warn) {
  if (pct >= target / 100) return 'good';
  if (pct >= warn / 100) return 'warn';
  return 'bad';
}

export function renderDashboard({ lines, reviewsByLineId, config }) {
  const warnPct = config.warnPct;
  const kpis = calculateKpis(lines, reviewsByLineId, config);

  renderGauge(document.getElementById('gaugeGross'), { value: kpis.gross * 100, good: config.targetPct, warn: warnPct });
  document.getElementById('valueGross').textContent = formatPercent(kpis.gross);
  document.getElementById('subGross').innerHTML =
    `<b class="num">${kpis.onTime}</b>/<span class="num">${kpis.total}</span> linii na czas · próg <b>${String(config.targetPct).replace('.', ',')}%</b>`;

  renderGauge(document.getElementById('gaugeNet'), { value: kpis.net * 100, good: config.targetPct, warn: warnPct });
  document.getElementById('valueNet').textContent = formatPercent(kpis.net);
  document.getElementById('subNet').textContent = kpis.sumaObdLine > 0
    ? `w tym ${kpis.sumaObdLine} wybaczonych (wina: klient)`
    : 'brak jeszcze wybaczonych linii';

  for (const region of ['PL', 'EU', 'NON EU']) {
    const gaugeEl = document.getElementById('gauge' + region.replace(' ', ''));
    const valueEl = document.getElementById('value' + region.replace(' ', ''));
    if (!gaugeEl || !valueEl) continue;
    const pct = kpis.regions[region] ?? 0;
    renderGauge(gaugeEl, { value: pct * 100, good: config.targetPct, warn: warnPct });
    valueEl.textContent = formatPercent(pct);
  }

  // Tabela wg kraju
  const countries = calculateCountryBreakdown(lines);
  const countryBody = document.getElementById('countryTable');
  countryBody.innerHTML = '';
  for (const row of countries) {
    const cls = pctClass(row.grossPct, config.targetPct, warnPct);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="kraj">${row.country}</td>
      <td class="num">${row.total}</td>
      <td class="num">${row.onTime}</td>
      <td class="num">${row.toExplain}</td>
      <td class="num"><span class="pct-cell"><i class="pct-dot ${cls}"></i>${formatPercent(row.grossPct)}</span></td>`;
    countryBody.appendChild(tr);
  }
  const totalTr = document.createElement('tr');
  totalTr.className = 'total';
  totalTr.innerHTML = `
    <td class="kraj">Suma</td>
    <td class="num">${kpis.total}</td>
    <td class="num">${kpis.onTime}</td>
    <td class="num">${kpis.total - kpis.onTime}</td>
    <td class="num">${formatPercent(kpis.gross)}</td>`;
  countryBody.appendChild(totalTr);

  document.getElementById('countryHint').textContent = `${countries.length} ${countries.length === 1 ? 'kraj' : 'krajów'}`;

  // Tabela wg reason code
  const reasons = calculateReasonBreakdown(lines, reviewsByLineId);
  const reasonBody = document.getElementById('reasonTable');
  reasonBody.innerHTML = '';
  if (reasons.length === 0) {
    reasonBody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Brak jeszcze uzupełnionych linii</td></tr>';
  } else {
    for (const r of reasons) {
      const tr = document.createElement('tr');
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
