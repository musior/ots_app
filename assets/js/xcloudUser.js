// Dostęp do tożsamości zalogowanego użytkownika w hoście (Fiege Cloud). Appka żyje w iframe
// hosta, więc "xcloud" siedzi na window.parent, NIE na window (ten sam fakt osadzenia, na
// którym stoi synchronizacja motywu w app.js — window.self !== window.top).
//
// Owinięte w try/catch, nie tylko w ?. — jeśli host kiedyś okaże się innym originem niż ta
// appka, odczyt właściwości window.parent.xcloud rzuci SecurityError (polityka same-origin),
// a nie po prostu zwróci undefined tak jak zwykłe ?. na cross-origin iframe.
export function currentUserFullName(fallback = 'unknown') {
  try {
    return window.parent?.xcloud?.account?.fullname ?? fallback;
  } catch (err) {
    console.error('Nie udało się odczytać window.parent.xcloud (host innego originu?)', err);
    return fallback;
  }
}
