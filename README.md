# OTS — On Time Shipment (klient: 3ME)

Frontend + logika liczenia wskaźnika OTS, na razie bez backendu — zapisane oceny
linii ("kod przyczyny" + "wina") trzymane są w `localStorage` przeglądarki
(`js/reviewsStore.js`). Docelowo tylko ta jedna warstwa zostanie podmieniona na
wywołania do backendu.

## Uruchomienie

Aplikacja używa modułów ES (`<script type="module">`), więc **nie da się** jej
otworzyć bezpośrednio z dysku (`file://`) — przeglądarki blokują import
modułów przez CORS. Trzeba odpalić lokalny serwer statyczny, np.:

- VSCode: rozszerzenie **Live Server** → prawy klik na `index.html` → "Open with Live Server"
- albo w terminalu: `npx serve .` lub `python -m http.server`

## Struktura

- `index.html`, `css/styles.css` — UI (dashboard + panel „Opóźnione linie")
- `js/clients/3me.js` — reguły specyficzne dla klienta (grupy przewoźników, kraje UE, reason code'y, target)
- `js/csvParser.js` — wczytanie i sparsowanie pliku CSV (windows-1250, `;`)
- `js/calcEngine.js` — logika 1:1 z Power Query/DAX: `AdjustedExpectedDate` → `DELAY_STATUS` → region → KPI (Gross/Net)
- `js/reviewsStore.js` — zapis ocenionych linii (dziś: localStorage)
- `js/ui/` — renderowanie dashboardu (karty KPI, tabela krajów) i panelu opóźnionych linii
- `data/` — przykładowe pliki OBD do testów lokalnych (w `.gitignore`, nigdy nie trafiają do repo)

## Do potwierdzenia na realnych danych

- `data/przyklad_3ME_OBD.csv` w tym repo jest zapisany jako UTF-8 (wklejony w rozmowie), a docelowy
  plik z SharePointa jest w windows-1250 — do testowania logiki liczenia to nie ma znaczenia
  (kolumny użyte w obliczeniach są czysto ASCII), ale nazwy miast/firm w tym konkretnym pliku
  będą wyglądać źle. Do testu samego dekodowania encodingu potrzebny jest prawdziwy eksport z WMS.

## Świadome różnice względem obecnego Power BI

- **Polska (`COUNTRY = 60`) z pustym `CARRIER`.** Obecna formuła Power Query rzutuje `COUNTRY`
  na `Int64.Type`, więc `Text.From(60)` daje `"60"`, a nie `"060"` — porównanie
  `country <> "060"` jest więc zawsze prawdziwe, nawet dla Polski, i Power BI dziś przesuwa
  `AdjustedExpectedDate` o +3 dni również dla krajowych linii z pustym przewoźnikiem. To wygląda
  na niezamierzony błąd w obecnej logice (branch "krajowe, bez przesunięcia" nigdy się nie
  uruchamia). Po konsultacji zdecydowaliśmy **naprawić to w nowej aplikacji**: Polska + pusty
  `CARRIER` → data bez przesunięcia (`js/calcEngine.js`, porównanie liczbowe
  `Number(country) === Number(domesticCountryCode)`, więc `"60"` i `"060"` są traktowane jako ten
  sam kod). Skutek: dla tych konkretnych linii `AdjustedExpectedDate` w nowej aplikacji **będzie
  się różnić** od tego, co dziś pokazuje Power BI (u nas zostaje np. 17 lipca, w Power BI wychodzi
  20 lipca) — to świadoma decyzja, nie błąd migracji. Warto to zaznaczyć osobom, które będą
  porównywać liczby ze starym narzędziem podczas przejścia.
