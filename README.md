# OTS — On Time Shipment (klienci: 3ME, Solventum)

Frontend + logika liczenia wskaźnika OTS. Zapisane oceny linii ("kod przyczyny" + "wina")
żyją WYŁĄCZNIE w backendzie (`/api/apps/spa/ots-daily`, patrz `js/backend/otsDailyApi.js`)
— `js/reviewsStore.js` trzyma je tylko w pamięci na czas sesji, hydratowane z backendu przy
każdym imporcie pliku. Świadoma decyzja: dopóki nikt nie kliknie "Wyślij raport mailem" (ten
przycisk zapisuje dzień do backendu I wysyła maila naraz — patrz niżej), oceny zrobione w
danej sesji **nie przetrwają** odświeżenia strony ani ponownego importu — `localStorage`
celowo nie jest już używany jako bufor/fallback.

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
  inaczej pada na implementację 3ME zaszytą w tym pliku. `DELAY_STATUS` porównuje się domyślnie z
  `LOADING DATE` (nie `PHYSICAL_SHIP_DATE`) przez `config.selectDeliveryDate` — 3ME ma tu wyjątek dla
  przewoźników DPD/MGS (patrz `js/clients/3me.js`), Solventum zawsze zostaje przy `LOADING DATE`.
  `filterByAdjustedDateRange` filtruje po dowolnym zakresie dat (obie granice włącznie), nie tylko
  po jednym dniu — to na nim stoi dashboard (KPI, tabela krajów, powody, panel "Opóźnione linie").
- `js/app.js` — jeden przycisk importu pozwala zaznaczyć pliki obu klientów naraz (multi-select);
  każdy trafia do właściwego klienta po `reportNumber` w nazwie pliku. Stan (zaimportowane linie,
  wybrany zakres dat `dateFrom`/`dateTo`) jest trzymany osobno per klient, więc przełączanie zakładki
  3ME/SLV nie gubi danych. Domyślnie `dateFrom === dateTo` (jeden dzień — poprzedni dzień roboczy),
  przycisk "Cały miesiąc" rozszerza zakres do miesiąca kalendarzowego. Przycisk maila jest zablokowany,
  gdy zakres to więcej niż jeden dzień — szablon maila zakłada pojedynczy dzień (patrz `js/emailReport.js`).
- `js/reviewsStore.js` — oceny linii w pamięci (nie localStorage!), osobno per klient. Publiczne
  API (`getAllReviews`/`getReview`/`saveReview`/`deleteReview`) zostało bez zmian względem
  wersji na localStorage — `js/ui/delayedPanel.js` nie musiał się zmienić. Doszła
  `hydrateFromBackend(clientId, reviewsByObd)`, nadpisująca cały stan danymi z serwera.
- `js/backend/otsDailyApi.js` — klient `/api/apps/spa/ots-daily`: `upsertDailyResult` zapisuje
  jeden wiersz per (`department`, `report_date`) z polami rdzeniowymi (`total_lines`,
  `gross_on_time_lines`, `net_on_time_lines`) ustalonymi z KG, a WSZYSTKO inne (`countries`,
  `reasons`, `delayedLines` — pełny stan panelu "Opóźnione linie", patrz
  `calcEngine.buildDelayedLinesSnapshot`) w polu `meta` jako zserializowany JSON. `id` nadaje
  backend (autoincrement, brak filtrowanego GET) — `fetchAllRows` ściąga WSZYSTKIE strony
  (endpoint jest paginowany, `per_page` domyślnie 50) i filtrujemy/szukamy w JS.
  `fetchDelayedLinesReviews(department)` odtwarza `reviewsByObd` ze wszystkich zapisanych dni —
  wołane w `js/app.js` (`handleFiles`) przy każdym imporcie, żeby hydratować `reviewsStore`.
- `js/emailReport.js` — buduje temat/adresatów/treść raportu OTS do wysyłki mailem. Adresaci
  ("Do", nie "DW") to stała lista (`REPORT_TO_RECIPIENTS`), jednakowa dla obu klientów.
  Wszystkie liczby w treści to **OTS Gross** (surowy, bez uwzględniania zapisanych powodów
  opóźnień) — inaczej niż karta "OTS Total Net" w dashboardzie. Zwraca zarówno wersję tekstową
  (tabulatory, fallback), jak i HTML (prawdziwe `<table>`) — `js/app.js` zapisuje OBIE
  równolegle do schowka przez `ClipboardItem`, dzięki czemu wklejenie w Outlooku (Ctrl+V) daje
  sformatowaną tabelę, a nie tekst z tabulatorami. `mailto:` otwiera tylko pusty mail z
  adresatami+tematem (adresaci idą bezpośrednio po `mailto:`, nie jako `?to=...` — to nie jest
  parametr zdefiniowany w RFC 6068; świadomie bez `body=...` — przy tabeli krajów łatwo
  przekroczyć praktyczny limit długości linku `mailto:` i Outlook obciąłby treść bez
  ostrzeżenia), więc wysyłający musi wkleić. Przycisk "Wyślij
  raport mailem" w `js/app.js` (`wireEmailButton`) robi to WSZYSTKO na raz z jednego kliknięcia:
  najpierw zapisuje dzień do backendu (`otsDailyApi.upsertDailyResult`), potem kopiuje treść do
  schowka, potem otwiera maila — status przy przycisku pokazuje wynik obu kroków (zapis może się
  nie udać niezależnie od kopiowania, i odwrotnie).
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
