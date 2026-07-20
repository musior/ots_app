import { groupNeedingReviewByObd } from '../calcEngine.js';
import * as reviewsStore from '../reviewsStore.js';

let currentGroups = [];
let currentConfig = null;
let currentClientId = null;
let onChangeCallback = null;

function statusLabel(delayStatus) {
  if (delayStatus === 'DELAY') return { text: 'Opóźnienie', cls: 'bad' };
  return { text: 'Zamówienie potwierdzone', cls: 'warn' };
}

function reasonOptionsHtml(selected) {
  let html = '<option value="">— wybierz —</option>';
  for (const code of currentConfig.reasonCodes) {
    html += `<option${code === selected ? ' selected' : ''}>${code}</option>`;
  }
  return html;
}

// Wiersz reprezentuje jeden OBD (może obejmować kilka linii/OBD_LINE) —
// ocena (kod przyczyny + wina) dotyczy całego OBD naraz.
function buildRow(group) {
  const existing = reviewsStore.getReview(currentClientId, group.obd);
  const saved = !!(existing && existing.reasonCode && existing.faultOwner);

  const tr = document.createElement('tr');
  tr.dataset.kraj = group.country || '';
  tr.dataset.status = saved ? 'done' : 'pending';
  tr.dataset.search = `${group.wmsOrder || ''} ${group.obd || ''}`.toLowerCase();

  const status = statusLabel(group.delayStatus);

  tr.innerHTML = `
    <td class="kraj">${group.country || '—'}</td>
    <td class="num">${group.wmsOrder || '—'}</td>
    <td class="num">${group.obd || '—'}</td>
    <td class="num">${group.lineCount}</td>
    <td><span class="chip algo-badge algo-badge--${status.cls}"><i class="dot"></i>${status.text}</span></td>
    <td><select class="reason">${reasonOptionsHtml(existing?.reasonCode)}</select></td>
    <td><div class="owner-toggle" data-locked="${saved}">
        <button type="button" class="owner-btn" data-owner="magazyn" aria-pressed="${existing?.faultOwner === 'magazyn'}">Magazyn</button>
        <button type="button" class="owner-btn" data-owner="klient" aria-pressed="${existing?.faultOwner === 'klient'}">Klient</button>
      </div></td>
    <td>
      <span class="chip ${saved ? 'chip--done' : 'chip--pending'}"><i class="dot"></i>${saved ? 'Uzupełnione' : 'Do uzupełnienia'}</span>
      ${saved ? `<div class="row-meta">${existing.reviewedBy} · ${new Date(existing.reviewedAt).toLocaleString('pl-PL')}</div>` : ''}
    </td>
    <td class="save-cell">
      <button type="button" class="btn btn--sm btn--primary save-btn" ${saved ? 'disabled style="display:none"' : ''}>Zapisz</button>
      <button type="button" class="link-btn edit-btn" style="${saved ? '' : 'display:none'}">Edytuj</button>
    </td>`;

  const select = tr.querySelector('.reason');
  const ownerToggle = tr.querySelector('.owner-toggle');
  const ownerBtns = tr.querySelectorAll('.owner-btn');
  const saveBtn = tr.querySelector('.save-btn');
  const editBtn = tr.querySelector('.edit-btn');
  const chip = tr.querySelectorAll('.chip')[1];

  if (saved) {
    select.disabled = true;
    ownerBtns.forEach((b) => (b.disabled = true));
  }

  function refreshSaveState() {
    const ownerChosen = tr.querySelector('.owner-btn[aria-pressed="true"]');
    saveBtn.disabled = !(select.value && ownerChosen);
  }
  select.addEventListener('change', refreshSaveState);

  ownerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (ownerToggle.dataset.locked === 'true') return;
      ownerBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      refreshSaveState();
    });
  });

  saveBtn.addEventListener('click', () => {
    const owner = tr.querySelector('.owner-btn[aria-pressed="true"]')?.dataset.owner;
    if (!select.value || !owner) return;
    const savedReview = reviewsStore.saveReview(currentClientId, group.obd, {
      reasonCode: select.value,
      faultOwner: owner,
    });
    select.disabled = true;
    ownerBtns.forEach((b) => (b.disabled = true));
    ownerToggle.dataset.locked = 'true';
    tr.dataset.status = 'done';
    chip.className = 'chip chip--done';
    chip.innerHTML = '<i class="dot"></i>Uzupełnione';
    const meta = document.createElement('div');
    meta.className = 'row-meta';
    meta.textContent = `${savedReview.reviewedBy} · ${new Date(savedReview.reviewedAt).toLocaleString('pl-PL')}`;
    tr.children[7].appendChild(meta);
    saveBtn.style.display = 'none';
    editBtn.style.display = '';
    onChangeCallback?.();
  });

  editBtn.addEventListener('click', () => {
    // Celowo NIE kasujemy tu zapisu w reviewsStore — dopóki ktoś nie kliknie
    // "Zapisz" ponownie, poprzednia klasyfikacja zostaje w bazie. Inaczej
    // pełny re-render panelu (wywoływany po zapisaniu innego wiersza) mógłby
    // bezpowrotnie skasować w połowie edytowany OBD.
    select.disabled = false;
    ownerBtns.forEach((b) => (b.disabled = false));
    ownerToggle.dataset.locked = 'false';
    tr.dataset.status = 'pending';
    chip.className = 'chip chip--pending';
    chip.innerHTML = '<i class="dot"></i>Do uzupełnienia';
    const meta = tr.children[7].querySelector('.row-meta');
    if (meta) meta.remove();
    editBtn.style.display = 'none';
    saveBtn.style.display = '';
    refreshSaveState();
    onChangeCallback?.();
  });

  return tr;
}

function applyFilters() {
  const kraj = document.getElementById('filterKraj').value;
  const status = document.getElementById('filterStatus').value;
  const q = document.getElementById('filterSearch').value.trim().toLowerCase();
  const tbody = document.getElementById('delayedTable');
  let visible = 0;
  tbody.querySelectorAll('tr').forEach((tr) => {
    let ok = true;
    if (kraj && tr.dataset.kraj !== kraj) ok = false;
    if (status && tr.dataset.status !== status) ok = false;
    if (q && !tr.dataset.search.includes(q)) ok = false;
    tr.style.display = ok ? '' : 'none';
    if (ok) visible += 1;
  });
  document.getElementById('visibleCount').textContent = String(visible);
}

function updateStats() {
  const all = document.querySelectorAll('#delayedTable tr');
  let done = 0;
  all.forEach((tr) => {
    if (tr.dataset.status === 'done') done += 1;
  });
  const total = all.length;
  document.getElementById('statPending').textContent = String(total - done);
  document.getElementById('statDone').textContent = String(done);
  document.getElementById('statTotal').textContent = String(total);
  document.getElementById('tabBadge').textContent = String(total - done);
  document.getElementById('totalCount').textContent = String(total);
}

export function renderDelayedPanel({ lines, config, clientId, onChange }) {
  currentGroups = groupNeedingReviewByObd(lines);
  currentConfig = config;
  currentClientId = clientId;
  onChangeCallback = onChange;

  const tbody = document.getElementById('delayedTable');
  tbody.innerHTML = '';
  for (const group of currentGroups) {
    tbody.appendChild(buildRow(group));
  }

  const krajSelect = document.getElementById('filterKraj');
  const countries = [...new Set(currentGroups.map((g) => g.country).filter(Boolean))].sort();
  krajSelect.innerHTML = '<option value="">Wszystkie kraje</option>' + countries.map((c) => `<option>${c}</option>`).join('');

  updateStats();
  applyFilters();
}

export function wireDelayedFilters() {
  ['filterKraj', 'filterStatus'].forEach((id) => document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('filterSearch').addEventListener('input', applyFilters);
}
