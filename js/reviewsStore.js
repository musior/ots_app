// Warstwa zapisu ocenionych linii ("kod przyczyny" + "wina").
// Dziś: localStorage, per klient. Docelowo backend zastąpi wyłącznie treść
// tych funkcji (fetch zamiast localStorage) — reszta aplikacji się nie zmienia.

const KEY_PREFIX = 'ots_reviews_';

function storageKey(clientId) {
  return `${KEY_PREFIX}${clientId}`;
}

export function getAllReviews(clientId) {
  try {
    const raw = localStorage.getItem(storageKey(clientId));
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Nie udało się odczytać zapisanych recenzji z localStorage', err);
    return {};
  }
}

export function getReview(clientId, lineId) {
  return getAllReviews(clientId)[lineId] || null;
}

export function saveReview(clientId, lineId, { reasonCode, faultOwner, reviewedBy = 'Ty' }) {
  const all = getAllReviews(clientId);
  all[lineId] = {
    reasonCode,
    faultOwner,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  };
  localStorage.setItem(storageKey(clientId), JSON.stringify(all));
  return all[lineId];
}

export function deleteReview(clientId, lineId) {
  const all = getAllReviews(clientId);
  delete all[lineId];
  localStorage.setItem(storageKey(clientId), JSON.stringify(all));
}
