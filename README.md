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
- `js/clients/3me.js`, `js/clients/solventum.js` — ustawienia specyficzne dla klienta (kraje UE,
  target, temat maila). Każdy plik ma swój
  `reportNumber` — numer raportu w nazwie pliku CSV z SharePointa, po którym `js/app.js`
  rozpoznaje, do którego klienta należy wgrywany plik (3ME = "4009", Solventum = "8084").
- `js/clients/reasonCodes.js` — lista reason code'ów, współdzielona przez obu klientów (jedna lista dla obu)
- `js/csvParser.js` — wczytanie i sparsowanie pliku CSV (windows-1250, `;`)
- `js/calcEngine.js` — silnik wspólny dla obu klientów: `DELAY_STATUS` → region → KPI (Gross/Net).
  `DELAY_STATUS` porównuje wprost `EXPECTED_SHIP_DATE` z `LOADING DATE`, bez żadnych przesunięć per
  przewoźnik/kraj/dzień tygodnia (dawna logika `AdjustedExpectedDate` z Power Query została
  porzucona): `LOADING DATE` ≤ Expected → `OK`; `LOADING DATE` > Expected → `DELAY` („Opóźniona”);
  brak `LOADING DATE` po terminie → „Brak daty wyjazdu” (przed terminem → `OK`). Wyjątek: 3ME
  dla przewoźników DPD/MGS porównuje z `PHYSICAL_SHIP_DATE` (`config.selectDeliveryDate`, patrz
  `js/clients/3me.js`); Solventum zawsze zostaje przy `LOADING DATE`. Osobno
  `isReceivedAfterCutoff` zaznacza linie przyjęte (`RECEIVED_DATE`/`RECEIVED_TIME`) po dniu Expected
  albo w dniu Expected po 17:00 — czerwona ramka w panelu "Opóźnione linie", bez wpływu na status/KPI.
  `filterByExpectedDateRange` filtruje po dowolnym zakresie dat (obie granice włącznie), nie tylko
  po jednym dniu — to na nim stoi dashboard (KPI, tabela krajów, powody, panel "Opóźnione linie").
- `js/app.js` — jeden przycisk importu pozwala zaznaczyć pliki obu klientów naraz (multi-select);
  każdy trafia do właściwego klienta po `reportNumber` w nazwie pliku. Stan (zaimportowane linie,
  zakresy dat) jest trzymany osobno per klient, więc przełączanie zakładki 3ME/SLV nie gubi danych.
  Zakładki Dashboard i "Opóźnione linie" mają osobne zakresy (`st.ranges.dashboard` /
  `st.ranges.delayed`) — wspólne inputy "Od"/"Do" i "Cały miesiąc" zmieniają zakres otwartej
  zakładki. Domyślnie Dashboard = jeden dzień (poprzedni dzień roboczy), a "Opóźnione linie" = od
  najwcześniejszej daty w raporcie OBD do poprzedniego dnia roboczego (ustawiane przy każdym imporcie).
  Zapis do bazy i mail zawsze dotyczą dnia z zakładki Dashboard; przyciski są zablokowane, gdy jej
  zakres to więcej niż jeden dzień — szablon maila zakłada pojedynczy dzień (patrz `js/emailReport.js`).
- `js/xcloudUser.js` — `currentUserFullName(fallback)`: login zalogowanego w Fiege Cloud
  użytkownika. Appka żyje w iframe hosta, więc `xcloud` siedzi na `window.parent`, nie na
  `window` (patrz `account.fullname`, nie `account.username`) — owinięte w try/catch, bo
  cross-origin host rzuciłby `SecurityError` przy samym odczycie, nie tylko zwrócił `undefined`.
  Używane przy zapisie pojedynczej oceny (`js/ui/delayedPanel.js`) i przy zapisie całego dnia
  (`js/app.js` -> `otsDailyApi.upsertDailyResult`, pole `performedBy`).
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
- Rozpoznawanie pliku Solventum po `reportNumber` ("8084" w nazwie) — trzeba sprawdzić, czy
  automatyczny eksport z SharePointa faktycznie tak nazywa plik za każdym razem.
- Format `RECEIVED_TIME` — zakładamy "HHMM" (np. "1700"); "HHMMSS" też jest obsłużone
  (sekundy są obcinane). Do potwierdzenia na realnym pliku.

## Świadome różnice względem obecnego Power BI

- **Brak `AdjustedExpectedDate`.** Power BI przesuwa datę oczekiwaną o 0–6 dni zależnie od
  `CARRIER`, kraju i dnia tygodnia. Nowa aplikacja ocenia każdą linię wprost względem
  `EXPECTED_SHIP_DATE` z pliku i porównuje z `LOADING DATE` (jedyny wyjątek: 3ME dla przewoźników
  DPD/MGS porównuje z `PHYSICAL_SHIP_DATE`). Wyniki OTS będą się więc
  różnić od Power BI — to świadoma decyzja, nie błąd migracji.
