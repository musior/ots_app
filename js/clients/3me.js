// Konfiguracja specyficzna dla klienta 3ME — logika wyliczania AdjustedExpectedDate,
// przynależności regionalnej i reason code'ów pochodzi 1:1 z zapytania Power Query / DAX
// używanego dziś w Power BI. Klient Solventum dostanie analogiczny plik z własnymi regułami —
// silnik obliczeniowy (js/calcEngine.js) jest wspólny dla obu.

export const client3me = {
  id: '3me',
  name: '3ME',
  targetPct: 98.5,
  warnPct: 95, // próg, poniżej którego gauge świeci na czerwono zamiast żółto (jak na oryginalnym dashboardzie)

  // Kod kraju (kolumna COUNTRY, numeryczna) używany do wykrycia przesyłek krajowych,
  // gdy CARRIER jest pusty. Wzięty wprost z formuły DAX ("060") — w przykładowym pliku
  // nie było wierszy z Polski, więc wymaga potwierdzenia na realnych danych.
  domesticCountryCode: '060',

  csv: {
    delimiter: ';',
    encoding: 'windows-1250',
  },

  // Dopasowanie po CARRIER robione jest przez "zawiera", tak jak Text.Contains w Power Query.
  carrierGroups: {
    group1: ['ROM', 'BRI'], // +1 dzień
    group2: ['SRE', 'BOS', 'KOS', 'MOL', 'TUR', 'MCD', 'DH', 'SO', 'JUE'], // +2 dni (+4 w czwartek)
    group3: ['UKS', 'GRU', 'AZB', 'KYI', 'UKR', 'LOT', 'ODB', 'TAD'], // +3 dni
  },
  litKeyword: 'LIT',

  // Krok 3 z Power Query — lista krajów UE (dokładnie te teksty, bez polskich znaków,
  // bo tak są zapisane w NAME_COUNTRY źródłowego raportu).
  euCountries: [
    'AUSTRIA', 'BELGIA', 'BULGARIA', 'CYPR', 'CHORWACJA', 'CZECHY', 'DANIA', 'ESTONIA',
    'FINLANDIA', 'FRANCJA', 'GRECJA', 'HISZPANIA', 'HOLANDIA', 'IRLANDIA', 'LITWA', 'LOTWA',
    'LUXEMBURG', 'MALTA', 'NIEMCY', 'PORTUGALIA', 'RUMUNIA', 'SLOWACJA', 'SLOWENIA',
    'SZWECJA', 'WEGRY', 'WLOCHY',
  ],

  // Zamknięta lista reason code'ów dla 3ME — używana zarówno w dropdownie panelu
  // "Opóźnione linie", jak i w formule %OTS Net (Suma_OBD_Line).
  reasonCodes: [
    '3M request',
    'Volume arrangement',
    'According to schedule',
    'Carrier issue',
    'IT issue',
    'Kitting/Converting',
    'Labeling',
    'Waiting for 3M feedback',
    'Customer pre-advice',
    '3M Customer service cancel N16',
    'HCSPIN in-transit',
    'Holiday',
  ],
};
