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
  // Formuła AdjustedExpectedDate różni się realnie między klientami (inne grupy
  // przewoźników / dodatkowe reguły) — config może podać własną implementację
  // (patrz clients/solventum.js), reszta silnika (DELAY_STATUS, region, KPI) zostaje wspólna.
  const computeDate = config.computeAdjustedExpectedDate || computeAdjustedExpectedDate;
  const adjustedExpectedDate = computeDate(row, config);
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

// reviewsByObd: { [OBD]: { reasonCode, faultOwner, reviewedBy, reviewedAt } }
// Ocena (reason code + wina) jest przypisywana per OBD, nie per pojedynczy wiersz
// (OBD_LINE) — jeden OBD może mieć kilka linii, ale to jedna decyzja na cały OBD.
export function calculateKpis(lines, reviewsByObd, config) {
  const total = lines.length;
  const onTime = lines.filter((l) => l.delayStatus === 'OK').length;
  const gross = total === 0 ? 0 : onTime / total;

  // Suma_OBD_Line: dla OBD ocenionych jako "Klient" (Opóźnienie ujęte w OTS = Nie)
  // doliczamy do licznika Net liczbę wierszy (linii), jakie ten OBD reprezentuje —
  // nie sumę wartości w kolumnie OBD_LINE, tylko faktyczną liczbę wierszy.
  const lineCountByObd = new Map();
  for (const line of lines) {
    lineCountByObd.set(line.OBD, (lineCountByObd.get(line.OBD) || 0) + 1);
  }

  let sumaObdLine = 0;
  for (const [obd, count] of lineCountByObd) {
    const review = reviewsByObd[obd];
    if (review && review.faultOwner === 'klient' && config.reasonCodes.includes(review.reasonCode)) {
      sumaObdLine += count;
    }
  }

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
// Liczy w liniach (wierszach), nie w OBD — jeden oceniony OBD z 4 liniami
// wnosi 4 do sumy, tak samo jak wchodzi do Suma_OBD_Line w KPI.
export function calculateReasonBreakdown(lines, reviewsByObd) {
  const groups = groupNeedingReviewByObd(lines);
  const map = new Map();
  for (const group of groups) {
    const review = reviewsByObd[group.obd];
    if (!review || !review.reasonCode) continue;
    if (!map.has(review.reasonCode)) {
      map.set(review.reasonCode, { reasonCode: review.reasonCode, magazyn: 0, klient: 0 });
    }
    const entry = map.get(review.reasonCode);
    if (review.faultOwner === 'magazyn') entry.magazyn += group.lineCount;
    else if (review.faultOwner === 'klient') entry.klient += group.lineCount;
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

// Grupuje linie wymagające przeglądu po OBD — jeden OBD może mieć kilka wierszy
// (OBD_LINE), ale w panelu "Opóźnione linie" ocenia się go jako całość: jeden
// kod przyczyny + jedna wina na cały OBD, a nie osobno na każdą linię.
// Zakłada, że pola istotne dla statusu (CARRIER, COUNTRY, EXPECTED_SHIP_DATE,
// PHYSICAL_SHIP_DATE) są wspólne dla wszystkich linii tego samego OBD — tak jest
// w źródłowym raporcie, bo dotyczą całej przesyłki, nie pojedynczej pozycji.
export function groupNeedingReviewByObd(lines) {
  const map = new Map();
  for (const line of linesNeedingReview(lines)) {
    if (!map.has(line.OBD)) {
      map.set(line.OBD, {
        obd: line.OBD,
        wmsOrder: line.WMS_ORDER,
        country: line.NAME_COUNTRY,
        delayStatus: line.delayStatus,
        lineCount: 0,
        totalQty: 0,
      });
    }
    const group = map.get(line.OBD);
    group.lineCount += 1;
    group.totalQty += Number(line.OBD_QTY) || 0;
  }
  return [...map.values()];
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
