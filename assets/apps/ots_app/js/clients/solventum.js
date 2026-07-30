// Konfiguracja specyficzna dla klienta Solventum — logika wyliczania AdjustedExpectedDate
// pochodzi 1:1 z zapytania Power Query dostarczonego przez klienta (ten sam format raportu
// OBD co dla 3ME — Solventum to dawna działalność healthcare 3M, spin-off z 2024 — ale z
// innymi regułami przesunięć przewoźników). DELAY_STATUS, region (PL/EU/NON EU) i KPI
// (Gross/Net) są w pełni współdzielone z js/calcEngine.js — tylko AdjustedExpectedDate
// jest podpięty jako override (patrz computeAdjustedExpectedDate w enrichLine).

import { addDays, mondayIndexedDayOfWeek } from '../dateUtils.js';
import { sharedReasonCodes } from './reasonCodes.js';

function matchesAny(carrier, codes) {
  return codes.some((code) => carrier.includes(code));
}

// Krok 1 z dostarczonego Power Query — dosłowny port formuły "AdjustedExpectedDate".
// Grupa 4 (LAS/LIS/ESS) ma zupełnie inną logikę niż pozostałe grupy: mapowanie po dniu
// tygodnia zamiast stałego przesunięcia, i celowo NIE dostaje korekty weekendowej —
// tak wygląda oryginalna formuła, to nie jest uproszczenie.
export function computeAdjustedExpectedDateSolventum(row, config) {
  const expected = row.expectedShipDate;
  if (!expected) return null;

  const country = String(row.COUNTRY ?? '').trim();
  const carrier = row.CARRIER ? String(row.CARRIER).trim().toUpperCase() : '';
  const isCarrierEmpty = carrier === '';
  const dow = mondayIndexedDayOfWeek(expected); // 0 = poniedziałek ... 6 = niedziela

  const { group1, group2, group3, group4 } = config.carrierGroups;
  const isGroup1 = matchesAny(carrier, group1);
  const isGroup2 = matchesAny(carrier, group2);
  const isGroup3 = matchesAny(carrier, group3);
  const isGroup4 = matchesAny(carrier, group4);

  // Porównanie liczbowe, nie tekstowe — ta sama świadoma decyzja co dla 3ME (patrz
  // README „Świadome różnice względem obecnego Power BI”), żeby "60" i "060" liczyły się
  // jako ten sam kod kraju niezależnie od zapisu w pliku. W dostarczonym Power Query dla
  // Solventum COUNTRY zostaje typu text (`country <> "060"`) — inaczej niż w PQ dla 3ME,
  // które rzutuje na Int64 i przez to gubi wiodące zero. Możliwe więc, że tu bug 060 vs 60
  // w ogóle by nie wystąpił — ale zostajemy przy tej samej, bezpieczniejszej konwencji
  // porównania liczbowego dla spójności między klientami. Do potwierdzenia na realnym pliku.
  const isDomestic = Number(country) === Number(config.domesticCountryCode);

  if (isGroup4) {
    if (dow === 1 || dow === 3) return addDays(expected, 1); // wtorek, czwartek -> +1 dzień
    return expected; // pon/śr/pt i pozostałe -> bez zmian
  }

  if (isCarrierEmpty) {
    return isDomestic ? expected : addDays(expected, 3);
  }

  let carrierShift;
  if (isGroup1) carrierShift = 1;
  else if (isGroup2) carrierShift = dow === 3 ? 4 : 2; // czwartek -> +4, inne dni -> +2
  else if (isGroup3) carrierShift = 3;
  else return expected; // przewoźnik spoza znanych grup -> bez zmian

  const weekendShift = dow === 4 ? 3 : 0; // piątek w grupach 1-3 -> dodatkowe +3 dni
  return addDays(expected, carrierShift + weekendShift);
}

export const clientSolventum = {
  id: 'solventum',
  name: 'Solventum',

  // Potwierdzone: ten sam target/próg co dla 3ME.
  targetPct: 98.5,
  warnPct: 95,

  // Numer raportu w nazwie pliku eksportu z SharePointa — używany przez app.js do
  // rozpoznania, do którego klienta należy wgrywany plik (3ME = "4009", Solventum = "8084").
  reportNumber: '8084',

  // Jak dla 3ME: kod kraju (kolumna COUNTRY) używany do wykrycia przesyłek krajowych,
  // gdy CARRIER jest pusty. Wzięty wprost z formuły ("060").
  domesticCountryCode: '060',

  csv: {
    delimiter: ';',
    encoding: 'windows-1250',
  },

  // Dopasowanie po CARRIER przez "zawiera" (Text.Contains), tak jak w Power Query.
  carrierGroups: {
    group1: ['ROM', 'BRI'], // +1 dzień
    group2: ['SRB', 'BOS', 'KOS', 'MOL', 'TUR', 'MCD', 'DH', 'SO', 'ZUS'], // +2 dni (+4 w czwartek)
    group3: ['UKS', 'GRU', 'AZB', 'KYI', 'UKR', 'LOT', 'ODB', 'TAD'], // +3 dni
    group4: ['LAS', 'LIS', 'ESS'], // własna logika wg dnia tygodnia, patrz computeAdjustedExpectedDateSolventum
  },

  computeAdjustedExpectedDate: computeAdjustedExpectedDateSolventum,

  // Krok 3 z dostarczonego Power Query — identyczna lista jak dla 3ME, więc
  // calcEngine.computeRegion jest w pełni reużywalny bez zmian.
  euCountries: [
    'AUSTRIA', 'BELGIA', 'BULGARIA', 'CYPR', 'CHORWACJA', 'CZECHY', 'DANIA', 'ESTONIA',
    'FINLANDIA', 'FRANCJA', 'GRECJA', 'HISZPANIA', 'HOLANDIA', 'IRLANDIA', 'LITWA', 'LOTWA',
    'LUXEMBURG', 'MALTA', 'NIEMCY', 'PORTUGALIA', 'RUMUNIA', 'SLOWACJA', 'SLOWENIA',
    'SZWECJA', 'WEGRY', 'WLOCHY',
  ],

  // Lista reason code'ów jest współdzielona z 3ME — patrz clients/reasonCodes.js.
  reasonCodes: sharedReasonCodes,
};
