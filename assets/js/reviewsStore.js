// Warstwa przechowywania ocenionych OBD ("kod przyczyny" + "wina") — WYŁĄCZNIE w pamięci
// (nie localStorage). Stan jest hydratowany z backendu przy każdym imporcie pliku (patrz
// js/app.js -> handleFiles, js/backend/otsDailyApi.js -> fetchDelayedLinesReviews) i żyje
// tylko do najbliższego przeładowania strony / kolejnego importu. Trwały zapis z powrotem
// do backendu dzieje się osobno, dopiero przy jawnym zapisie dnia (przycisk "Zapis do API" /
// docelowo wysyłka maila) — dopóki ktoś tego nie kliknie, oceny zrobione w tej sesji
// istnieją TYLKO w pamięci przeglądarki i giną przy odświeżeniu strony czy zamknięciu karty.
//
// Ocena dotyczy całego OBD (może obejmować kilka linii/OBD_LINE), nie pojedynczego wiersza.

const storeByClient = new Map();

function storeFor(clientId) {
  if (!storeByClient.has(clientId)) storeByClient.set(clientId, {});
  return storeByClient.get(clientId);
}

export function getAllReviews(clientId) {
  return { ...storeFor(clientId) };
}

export function getReview(clientId, obd) {
  return storeFor(clientId)[obd] || null;
}

export function saveReview(clientId, obd, { reasonCode, faultOwner, reviewedBy = 'Ty' }) {
  const store = storeFor(clientId);
  store[obd] = {
    reasonCode,
    faultOwner,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  };
  return store[obd];
}

export function deleteReview(clientId, obd) {
  delete storeFor(clientId)[obd];
}

// Nadpisuje CAŁY stan ocen dla klienta danymi z backendu — wołane przy imporcie pliku.
// Celowo nadpisuje, nie scala: import ma pokazać dokładnie to, co jest zapisane po stronie
// serwera, a nie mieszankę starego stanu w pamięci (np. z poprzedniego importu) z nowym.
export function hydrateFromBackend(clientId, reviewsByObd) {
  storeByClient.set(clientId, { ...reviewsByObd });
}
