import { addDays, mondayIndexedDayOfWeek, isSameDay } from './dateUtils.js';

// --- Krok 1: AdjustedExpectedDate -----------------------------------------
// Replika 1:1 kroku "Dodano kolumnę AdjustedExpectedDate" z Power Query.
// Implementacja jest celowo dosłowna względem wzoru DAX, nie względem komentarzy
// w oryginalnym kodzie (w paru miejscach komentarz i wzór się rozjeżdżają —
// tu liczy się to, co faktycznie liczy dziś Power BI).
export function computeAdjustedExpectedDate(row, config) {
  const expected = row.expectedShipDate;
  if (!expected) return null;

  const country = String(row.COUNTRY ?? '').trim();
  const carrier = row.CARRIER ? String(row.CARRIER).trim().toUpperCase() : '';
  const isCarrierEmpty = carrier === '';
  const dow = mondayIndexedDayOfWeek(expected); // 0=poniedziałek ... 6=niedziela

  const matchesGroup = (codes) => codes.some((code) => carrier.includes(code));
  const isGroup1 = matchesGroup(config.carrierGroups.group1);
  const isGroup2 = matchesGroup(config.carrierGroups.group2);
  const isGroup3 = matchesGroup(config.carrierGroups.group3);
  const isLit = carrier.includes(config.litKeyword);
  const isDomestic = Number(country) === Number(config.domesticCountryCode);

  let base;
  if (isLit) {
    if (dow === 0) base = expected;
    else if (dow === 1 || dow === 2) base = addDays(expected, 2 - dow + 1);
    else if (dow === 3 || dow === 4) base = addDays(expected, 4 - dow);
    else base = expected;
  } else if (isCarrierEmpty && !isDomestic) {
    base = addDays(expected, 3);
  } else if (isCarrierEmpty && isDomestic) {
    base = expected;
  } else if (isGroup1) {
    base = addDays(expected, 1);
  } else if (isGroup2) {
    base = dow === 3 ? addDays(expected, 4) : addDays(expected, 2);
  } else if (isGroup3) {
    base = addDays(expected, 3);
  } else {
    base = expected;
  }

  // Korekta weekendowa — tylko dla gałęzi grup 1/2/3/LIT, tak jak w źródle
  // (gałąź "pusty CARRIER" nie jest nią objęta).
  if (isGroup1 || isGroup2 || isGroup3 || isLit) {
    const baseDow = mondayIndexedDayOfWeek(base);
    if (baseDow > 4) {
      base = addDays(base, 7 - baseDow);
    }
  }

  return base;
}

// --- Krok 2: DELAY_STATUS --------------------------------------------------
export function computeDelayStatus(adjustedExpectedDate, physicalShipDate, today) {
  if (!adjustedExpectedDate) return null;
  if (adjustedExpectedDate >= today && !physicalShipDate) return 'OK';
  if (physicalShipDate && physicalShipDate <= adjustedExpectedDate) return 'OK';
  if (!physicalShipDate) return 'Zamówienie potwierdzone';
  return 'DELAY';
}

// --- Krok 3: PL / EU / NON EU ----------------------------------------------
export function computeRegion(row, config) {
  const country = row.NAME_COUNTRY ? String(row.NAME_COUNTRY).trim().toUpperCase() : '';
  if (country === 'POLSKA') return 'PL';
  if (config.euCountries.includes(country)) return 'EU';
  return 'NON EU';
}

export function enrichLine(row, config, today) {
  const adjustedExpectedDate = computeAdjustedExpectedDate(row, config);
  const delayStatus = computeDelayStatus(adjustedExpectedDate, row.physicalShipDate, today);
  const region = computeRegion(row, config);
  return { ...row, adjustedExpectedDate, delayStatus, region };
}

export function enrichLines(rows, config, today = new Date()) {
  today.setHours(0, 0, 0, 0);
  return rows.map((row) => enrichLine(row, config, today));
}

// --- KPI: Gross / Net / regiony --------------------------------------------
export function calculateGross(lines) {
  const total = lines.length;
  if (total === 0) return 0;
  const onTime = lines.filter((l) => l.delayStatus === 'OK').length;
  return onTime / total;
}

// reviewsByLineId: { [lineId]: { reasonCode, faultOwner, reviewedBy, reviewedAt } }
export function calculateKpis(lines, reviewsByLineId, config) {
  const total = lines.length;
  const onTime = lines.filter((l) => l.delayStatus === 'OK').length;
  const gross = total === 0 ? 0 : onTime / total;

  // Suma_OBD_Line: dla linii ocenionych jako "Klient" (Opóźnienie ujęte w OTS = Nie)
  // sumujemy wartość OBD_LINE — dosłownie jak w Power BI, nie liczbę linii.
  const sumaObdLine = lines.reduce((sum, line) => {
    const review = reviewsByLineId[line.lineId];
    if (review && review.faultOwner === 'klient' && config.reasonCodes.includes(review.reasonCode)) {
      return sum + (Number(line.OBD_LINE) || 0);
    }
    return sum;
  }, 0);

  const net = total === 0 ? 0 : (onTime + sumaObdLine) / total;

  const regions = {};
  for (const region of ['PL', 'EU', 'NON EU']) {
    regions[region] = calculateGross(lines.filter((l) => l.region === region));
  }

  return { total, onTime, gross, net, sumaObdLine, regions };
}

// --- Rozbicie wg kraju (widok dashboardu) -----------------------------------
export function calculateCountryBreakdown(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = line.NAME_COUNTRY || '—';
    if (!map.has(key)) map.set(key, { country: key, total: 0, onTime: 0 });
    const entry = map.get(key);
    entry.total += 1;
    if (line.delayStatus === 'OK') entry.onTime += 1;
  }
  return [...map.values()]
    .map((e) => ({ ...e, toExplain: e.total - e.onTime, grossPct: e.total === 0 ? 0 : e.onTime / e.total }))
    .sort((a, b) => b.total - a.total);
}

// --- Rozbicie wg reason code (na podstawie zapisanych recenzji) ------------
export function calculateReasonBreakdown(lines, reviewsByLineId) {
  const map = new Map();
  for (const line of lines) {
    const review = reviewsByLineId[line.lineId];
    if (!review || !review.reasonCode) continue;
    if (!map.has(review.reasonCode)) {
      map.set(review.reasonCode, { reasonCode: review.reasonCode, magazyn: 0, klient: 0 });
    }
    const entry = map.get(review.reasonCode);
    if (review.faultOwner === 'magazyn') entry.magazyn += 1;
    else if (review.faultOwner === 'klient') entry.klient += 1;
  }
  return [...map.values()]
    .map((e) => ({ ...e, total: e.magazyn + e.klient }))
    .sort((a, b) => b.total - a.total);
}

// Linie, które algorytm oznaczył jako niepewne/spóźnione i które trafiają
// do panelu "Opóźnione linie" (wszystko poza DELAY_STATUS === "OK").
export function linesNeedingReview(lines) {
  return lines.filter((l) => l.delayStatus !== 'OK');
}

// --- Filtr daty na dashboardzie ---------------------------------------------
// Ważne: filtrujemy po AdjustedExpectedDate (data po korekcie przewoźnika/weekendu),
// NIE po surowym EXPECTED_SHIP_DATE z pliku — tak jak w Power BI.
export function filterByAdjustedDate(lines, date) {
  if (!date) return lines;
  return lines.filter((l) => isSameDay(l.adjustedExpectedDate, date));
}

// Zakres dostępnych dat (po AdjustedExpectedDate) w aktualnie zaimportowanym pliku —
// używane do ograniczenia inputa z datą i podpowiedzi w UI.
export function adjustedDateRange(lines) {
  const dates = lines.map((l) => l.adjustedExpectedDate).filter(Boolean);
  if (dates.length === 0) return null;
  const timestamps = dates.map((d) => d.getTime());
  return { min: new Date(Math.min(...timestamps)), max: new Date(Math.max(...timestamps)) };
}
