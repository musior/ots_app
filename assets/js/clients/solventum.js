// Konfiguracja specyficzna dla klienta Solventum (ten sam format raportu OBD co dla 3ME —
// Solventum to dawna działalność healthcare 3M, spin-off z 2024). DELAY_STATUS, region
// (PL/EU/NON EU) i KPI (Gross/Net) są w pełni współdzielone z js/calcEngine.js — status
// liczy się wprost z EXPECTED_SHIP_DATE vs LOADING DATE, bez reguł per przewoźnik.

import { sharedReasonCodes } from './reasonCodes.js';

export const clientSolventum = {
  id: 'solventum',
  name: 'Solventum',

  // Temat raportu mailowego to "OTS Solventum - <data>" (patrz js/emailReport.js).
  emailSubjectLabel: 'Solventum',

  // Potwierdzone: ten sam target/próg co dla 3ME.
  targetPct: 98.5,
  warnPct: 95,

  // Numer raportu w nazwie pliku eksportu z SharePointa — używany przez app.js do
  // rozpoznania, do którego klienta należy wgrywany plik (3ME = "4009", Solventum = "8084").
  reportNumber: '8084',

  csv: {
    delimiter: ';',
    encoding: 'windows-1250',
  },

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
