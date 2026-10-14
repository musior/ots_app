// Konfiguracja specyficzna dla klienta 3ME — przynależność regionalna i reason code'y.
// DELAY_STATUS liczy się wprost z EXPECTED_SHIP_DATE vs data wyjazdu, wspólnie dla obu
// klientów (patrz js/calcEngine.js -> computeDelayStatus), bez przesunięć per przewoźnik.

import { sharedReasonCodes } from './reasonCodes.js';

// Wyjątek tylko dla 3ME: gdy CARRIER to dokładnie DPD lub MGS, DELAY_STATUS porównujemy
// z PHYSICAL_SHIP_DATE zamiast domyślnego LOADING DATE (patrz calcEngine.selectDeliveryDate).
// Solventum tego wyjątku nie ma — zostaje przy domyślnym zachowaniu silnika.
function selectDeliveryDate3me(row) {
  const carrier = row.CARRIER ? String(row.CARRIER).trim().toUpperCase() : '';
  if (carrier === 'DPD' || carrier === 'MGS') return row.physicalShipDate;
  return row.loadingDate;
}

export const client3me = {
  id: '3me',
  name: '3ME',

  // Temat raportu mailowego to "OTS Fiege - <data>", nie "OTS 3ME" — nazwa klienta
  // w temacie różni się od nazwy klienta w UI, stąd osobne pole (patrz js/emailReport.js).
  emailSubjectLabel: 'Fiege',

  targetPct: 98.5,
  warnPct: 95, // próg, poniżej którego karta KPI świeci na czerwono zamiast żółto

  // Numer raportu w nazwie pliku eksportu z SharePointa — używany przez app.js do
  // rozpoznania, do którego klienta należy wgrywany plik (3ME = "4009", Solventum = "8084").
  reportNumber: '4009',

  csv: {
    delimiter: ';',
    encoding: 'windows-1250',
  },

  selectDeliveryDate: selectDeliveryDate3me,

  // Krok 3 z Power Query — lista krajów UE (dokładnie te teksty, bez polskich znaków,
  // bo tak są zapisane w NAME_COUNTRY źródłowego raportu).
  euCountries: [
    'AUSTRIA', 'BELGIA', 'BULGARIA', 'CYPR', 'CHORWACJA', 'CZECHY', 'DANIA', 'ESTONIA',
    'FINLANDIA', 'FRANCJA', 'GRECJA', 'HISZPANIA', 'HOLANDIA', 'IRLANDIA', 'LITWA', 'LOTWA',
    'LUXEMBURG', 'MALTA', 'NIEMCY', 'PORTUGALIA', 'RUMUNIA', 'SLOWACJA', 'SLOWENIA',
    'SZWECJA', 'WEGRY', 'WLOCHY',
  ],

  // Lista reason code'ów jest współdzielona z Solventum — patrz clients/reasonCodes.js.
  reasonCodes: sharedReasonCodes,
};
