# OTS — On Time Shipment (klienci: 3ME, Solventum)

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

- `index.html`, `css/styles.css` — UI (rail z wyborem klienta, dashboard + panel „Opóźnione linie")
- `js/clients/3me.js`, `js/clients/solventum.js` — reguły specyficzne dla klienta (grupy przewoźników,
  własna implementacja `computeAdjustedExpectedDate`, kraje UE, target). Każdy plik ma swój
  `reportNumber` — numer raportu w nazwie pliku CSV z SharePointa, po którym `js/app.js`
  rozpoznaje, do którego klienta należy wgrywany plik (3ME = "4009", Solventum = "8084").
- `js/clients/reasonCodes.js` — lista reason code'ów, współdzielona przez obu klientów (jedna lista dla obu)
- `js/csvParser.js` — wczytanie i sparsowanie pliku CSV (windows-1250, `;`)
- `js/calcEngine.js` — silnik wspólny dla obu klientów: `DELAY_STATUS` → region → KPI (Gross/Net) są
  identyczne; `AdjustedExpectedDate` różni się per klient, więc `enrichLine` woła
  `config.computeAdjustedExpectedDate`, jeśli klient go dostarczy (patrz `js/clients/solventum.js`),
  inaczej pada na implementację 3ME zaszytą w tym pliku.
- `js/app.js` — jeden przycisk importu pozwala zaznaczyć pliki obu klientów naraz (multi-select);
  każdy trafia do właściwego klienta po `reportNumber` w nazwie pliku. Stan (zaimportowane linie,
  wybrana data filtra) jest trzymany osobno per klient, więc przełączanie zakładki 3ME/SLV nie gubi danych.
- `js/reviewsStore.js` — zapis ocenionych linii, osobno per klient (dziś: localStorage)
- `js/ui/` — renderowanie dashboardu (karty KPI, tabela krajów) i panelu opóźnionych linii
- `data/` — przykładowe pliki OBD do testów lokalnych (w `.gitignore`, nigdy nie trafiają do repo)

## Do potwierdzenia na realnych danych

- `data/przyklad_3ME_OBD.csv` w tym repo jest zapisany jako UTF-8 (wklejony w rozmowie), a docelowy
  plik z SharePointa jest w windows-1250 — do testowania logiki liczenia to nie ma znaczenia
  (kolumny użyte w obliczeniach są czysto ASCII), ale nazwy miast/firm w tym konkretnym pliku
  będą wyglądać źle. Do testu samego dekodowania encodingu potrzebny jest prawdziwy eksport z WMS.
- `js/clients/solventum.js` — `computeAdjustedExpectedDateSolventum` jest dosłownym portem formuły
  Power Query dostarczonej przez klienta, ale nie był jeszcze uruchomiony na prawdziwym eksporcie
  Solventum (brak przykładowego pliku w repo w momencie pisania). Do potwierdzenia na realnych
  danych: (1) rozpoznawanie pliku po `reportNumber` ("8084" w nazwie) — trzeba sprawdzić, czy
  automatyczny eksport z SharePointa faktycznie tak nazywa plik za każdym razem; (2) `domesticCountryCode`
  i `isDomestic` — w dostarczonym Power Query kolumna `COUNTRY` zostaje typu **text** (nie Int64 jak
  dla 3ME), więc problem "060 vs 60" opisany niżej może tu w ogóle nie występować (zależy, jak
  źródłowy WMS zapisuje ten kod dla Solventum) — zostaliśmy przy tym samym, bezpieczniejszym
  porównaniu liczbowym dla spójności, ale warto zweryfikować na pliku z polskimi wierszami.

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
