// Wspólna, zamknięta lista reason code'ów — używana zarówno przez 3ME, jak i Solventum
// (potwierdzone: to jedna i ta sama lista dla obu klientów, nie dwie osobne). Używana
// w dropdownie panelu "Opóźnione linie" oraz w formule %OTS Net (Suma_OBD_Line, patrz
// js/calcEngine.js).
export const sharedReasonCodes = [
  '3M request',
  'According to schedule',
  'ADM/ Late WMS confirmation',
  'Carrier issue',
  'IT issue',
  'Kitting/ Converting',
  'Labeling',
  'Volume arrangement',
  'Waiting for 3M feedback',
  'WH delay',
  'WH delay/incorrect order release',
  'WH delay/ Late WMS confirmation',
  'Customer pre-advice',
  '3M Customer service cancel N16',
  'HCSPIN in-transit',
  'Holiday',
  'Force Majeure',
  'Solventum request',
  'Waiting for Solventum feedback',
];
