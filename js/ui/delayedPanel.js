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

function refreshRowSaveState(tr) {
  const select = tr.querySelector('.reason');
  const saveBtn = tr.querySelector('.save-btn');
  const ownerChosen = tr.querySelector('.owner-btn[aria-pressed="true"]');
  saveBtn.disabled = !(select.value && ownerChosen);
}

// Zapisuje stan wiersza po zatwierdzeniu (pojedynczo albo masowo) — działa
// wyłącznie na przekazanym <tr>, nigdy nie przebudowuje reszty tabeli, więc
// nie kasuje niezapisanych jeszcze zmian w innych wierszach.
function lockRow(tr, review) {
  const select = tr.querySelector('.reason');
  const ownerToggle = tr.querySelector('.owner-toggle');
  const ownerBtns = tr.querySelectorAll('.owner-btn');
  const saveBtn = tr.querySelector('.save-btn');
  const editBtn = tr.querySelector('.edit-btn');

  select.value = review.reasonCode;
  select.disabled = true;
  ownerBtns.forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.owner === review.faultOwner));
    b.disabled = true;
  });
  ownerToggle.dataset.locked = 'true';
  tr.dataset.status = 'done';

  tr.querySelector('.status-cell').innerHTML = `
    <span class="chip chip--done"><i class="dot"></i>Uzupełnione</span>
    <div class="row-meta">${review.reviewedBy} · ${new Date(review.reviewedAt).toLocaleString('pl-PL')}</div>`;

  saveBtn.style.display = 'none';
  editBtn.style.display = '';
}

function unlockRow(tr) {
  const select = tr.querySelector('.reason');
  const ownerToggle = tr.querySelector('.owner-toggle');
  const ownerBtns = tr.querySelectorAll('.owner-btn');
  const saveBtn = tr.querySelector('.save-btn');
  const editBtn = tr.querySelector('.edit-btn');

  select.disabled = false;
  ownerBtns.forEach((b) => (b.disabled = false));
  ownerToggle.dataset.locked = 'false';
  tr.dataset.status = 'pending';
  tr.querySelector('.status-cell').innerHTML = '<span class="chip chip--pending"><i class="dot"></i>Do uzupełnienia</span>';
  editBtn.style.display = 'none';
  saveBtn.style.display = '';
  refreshRowSaveState(tr);
}

// Wiersz reprezentuje jeden OBD (może obejmować kilka linii/OBD_LINE) —
// ocena (kod przyczyny + wina) dotyczy całego OBD naraz.
function buildRow(group) {
  const existing = reviewsStore.getReview(currentClientId, group.obd);
  const saved = !!(existing && existing.reasonCode && existing.faultOwner);

  const tr = document.createElement('tr');
  tr.dataset.obd = group.obd;
  tr.dataset.kraj = group.country || '';
  tr.dataset.status = saved ? 'done' : 'pending';
  tr.dataset.search = `${group.wmsOrder || ''} ${group.obd || ''}`.toLowerCase();

  const status = statusLabel(group.delayStatus);

  tr.innerHTML = `
    <td><input type="checkbox" class="row-select" /></td>
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
    <td class="status-cell">
      <span class="chip ${saved ? 'chip--done' : 'chip--pending'}"><i class="dot"></i>${saved ? 'Uzupełnione' : 'Do uzupełnienia'}</span>
      ${saved ? `<div class="row-meta">${existing.reviewedBy} · ${new Date(existing.reviewedAt).toLocaleString('pl-PL')}</div>` : ''}
    </td>
    <td class="save-cell">
      <button type="button" class="btn btn--sm btn--primary save-btn" ${saved ? 'disabled style="display:none"' : ''}>Zapisz</button>
      <button type="button" class="link-btn edit-btn" style="${saved ? '' : 'display:none'}">Edytuj</button>
    </td>`;

  if (saved) {
    tr.querySelector('.reason').disabled = true;
    tr.querySelectorAll('.owner-btn').forEach((b) => (b.disabled = true));
  }

  tr.querySelector('.reason').addEventListener('change', () => refreshRowSaveState(tr));

  tr.querySelectorAll('.owner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ownerToggle = tr.querySelector('.owner-toggle');
      if (ownerToggle.dataset.locked === 'true') return;
      tr.querySelectorAll('.owner-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      refreshRowSaveState(tr);
    });
  });

  tr.querySelector('.save-btn').addEventListener('click', () => {
    const select = tr.querySelector('.reason');
    const owner = tr.querySelector('.owner-btn[aria-pressed="true"]')?.dataset.owner;
    if (!select.value || !owner) return;
    const savedReview = reviewsStore.saveReview(currentClientId, group.obd, { reasonCode: select.value, faultOwner: owner });
    lockRow(tr, savedReview);
    updateStats();
    applyFilters();
    onChangeCallback?.();
  });

  tr.querySelector('.edit-btn').addEventListener('click', () => {
    // Celowo NIE kasujemy tu zapisu w reviewsStore — dopóki ktoś nie kliknie
    // "Zapisz" ponownie, poprzednia klasyfikacja zostaje. Odblokowanie działa
    // tylko na tym jednym wierszu, więc nie rusza innych edytowanych wierszy.
    unlockRow(tr);
    updateStats();
    applyFilters();
    onChangeCallback?.();
  });

  tr.querySelector('.row-select').addEventListener('change', updateBulkBarState);

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

// --- Masowe zatwierdzanie: zaznacz kilka OBD, wybierz jeden kod przyczyny
// i jedną winę, zapisz wszystkie naraz. -------------------------------------
function selectedRows() {
  return [...document.querySelectorAll('#delayedTable .row-select:checked')].map((cb) => cb.closest('tr'));
}

function updateBulkBarState() {
  const rows = selectedRows();
  document.getElementById('bulkBar').hidden = rows.length === 0;
  document.getElementById('bulkCount').textContent = String(rows.length);
  refreshBulkSaveState();
}

function refreshBulkSaveState() {
  const reason = document.getElementById('bulkReason').value;
  const owner = document.querySelector('#bulkOwnerToggle .owner-btn[aria-pressed="true"]')?.dataset.owner;
  document.getElementById('bulkSaveBtn').disabled = !(reason && owner && selectedRows().length > 0);
}

function resetBulkBar() {
  document.getElementById('bulkReason').value = '';
  document.querySelectorAll('#bulkOwnerToggle .owner-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  updateBulkBarState();
}

function wireBulkBar() {
  document.getElementById('bulkReason').addEventListener('change', refreshBulkSaveState);

  document.querySelectorAll('#bulkOwnerToggle .owner-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bulkOwnerToggle .owner-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      refreshBulkSaveState();
    });
  });

  document.getElementById('bulkSaveBtn').addEventListener('click', () => {
    const reasonCode = document.getElementById('bulkReason').value;
    const faultOwner = document.querySelector('#bulkOwnerToggle .owner-btn[aria-pressed="true"]')?.dataset.owner;
    if (!reasonCode || !faultOwner) return;

    for (const tr of selectedRows()) {
      const savedReview = reviewsStore.saveReview(currentClientId, tr.dataset.obd, { reasonCode, faultOwner });
      lockRow(tr, savedReview);
      tr.querySelector('.row-select').checked = false;
    }

    resetBulkBar();
    updateStats();
    applyFilters();
    onChangeCallback?.();
  });

  document.getElementById('bulkClearBtn').addEventListener('click', () => {
    document.querySelectorAll('#delayedTable .row-select:checked').forEach((cb) => { cb.checked = false; });
    updateBulkBarState();
  });

  document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
    document.querySelectorAll('#delayedTable tr').forEach((tr) => {
      if (tr.style.display === 'none') return; // tylko wiersze widoczne po filtrach
      const cb = tr.querySelector('.row-select');
      if (cb) cb.checked = e.target.checked;
    });
    updateBulkBarState();
  });
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

  document.getElementById('bulkReason').innerHTML = reasonOptionsHtml(null);
  document.getElementById('selectAllCheckbox').checked = false;
  resetBulkBar();

  updateStats();
  applyFilters();
}

export function wireDelayedFilters() {
  ['filterKraj', 'filterStatus'].forEach((id) => document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('filterSearch').addEventListener('input', applyFilters);
  wireBulkBar();
}
