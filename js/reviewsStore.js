// Warstwa zapisu ocenionych OBD ("kod przyczyny" + "wina") — ocena dotyczy
// całego OBD (może obejmować kilka linii/OBD_LINE), nie pojedynczego wiersza.
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

export function getReview(clientId, obd) {
  return getAllReviews(clientId)[obd] || null;
}

export function saveReview(clientId, obd, { reasonCode, faultOwner, reviewedBy = 'Ty' }) {
  const all = getAllReviews(clientId);
  all[obd] = {
    reasonCode,
    faultOwner,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  };
  localStorage.setItem(storageKey(clientId), JSON.stringify(all));
  return all[obd];
}

export function deleteReview(clientId, obd) {
  const all = getAllReviews(clientId);
  delete all[obd];
  localStorage.setItem(storageKey(clientId), JSON.stringify(all));
}
