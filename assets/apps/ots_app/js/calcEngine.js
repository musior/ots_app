import { addDays, mondayIndexedDayOfWeek, isSameDay, startOfWeek, fromDateInputValue, toDateInputValue } from './dateUtils.js';

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
// Porównanie robi się z "datą dostawy" wybraną przez selectDeliveryDate (domyślnie
// LOADING DATE, nie PHYSICAL_SHIP_DATE — patrz csvParser.js/row.loadingDate) — to
// świadoma korekta logiki, bo LOADING DATE jest właściwą datą do oceny terminowości.
export function computeDelayStatus(adjustedExpectedDate, deliveryDate, today) {
  if (!adjustedExpectedDate) return null;
  if (adjustedExpectedDate >= today && !deliveryDate) return 'OK';
  if (deliveryDate && deliveryDate <= adjustedExpectedDate) return 'OK';
  if (!deliveryDate) return 'Zamówienie potwierdzone';
  return 'DELAY';
}

// Domyślny wybór pola daty do porównania z AdjustedExpectedDate — LOADING DATE.
// Config klienta może to nadpisać (patrz clients/3me.js -> selectDeliveryDate: dla
// przewoźników DPD/MGS 3ME chce PHYSICAL_SHIP_DATE zamiast LOADING DATE).
export function selectDeliveryDate(row) {
  return row.loadingDate;
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
  const pickDeliveryDate = config.selectDeliveryDate || selectDeliveryDate;
  const delayStatus = computeDelayStatus(adjustedExpectedDate, pickDeliveryDate(row), today);
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
  const needsReviewObds = new Set();
  for (const line of lines) {
    lineCountByObd.set(line.OBD, (lineCountByObd.get(line.OBD) || 0) + 1);
    if (line.delayStatus !== 'OK') needsReviewObds.add(line.OBD);
  }

  // Zapisana ocena liczy się do Net tylko, jeśli to OBD PRZY TYM imporcie nadal
  // faktycznie wymaga przeglądu (delayStatus !== 'OK'). Ocena mogła zostać zapisana
  // przy wcześniejszym imporcie, gdy linia jeszcze wyglądała na opóźnioną — jeśli od
  // tego czasu WMS potwierdził wysyłkę na czas, review zostaje w store (do wglądu
  // historycznego), ale przestaje sztucznie zawyżać Net (bo linia i tak już liczy się
  // do `onTime` powyżej).
  let sumaObdLine = 0;
  for (const [obd, count] of lineCountByObd) {
    if (!needsReviewObds.has(obd)) continue;
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

// --- Rozbicie wg kraju (widok dashboardu + raport mailowy) ------------------
// Kolejność zwracanych wierszy to kolejność pierwszego wystąpienia kraju w `lines`
// (kolejność z pliku CSV) — celowo bez sortowania tutaj: dashboard.js i tak sortuje
// wg własnego stanu (countrySort) przy renderze, a raport mailowy (js/emailReport.js)
// ma pokazywać kraje w kolejności zgodnej ze źródłowym raportem.
export function calculateCountryBreakdown(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = line.NAME_COUNTRY || '—';
    if (!map.has(key)) map.set(key, { country: key, total: 0, onTime: 0, missed: 0, jConfirmation: 0 });
    const entry = map.get(key);
    entry.total += 1;
    if (line.delayStatus === 'OK') entry.onTime += 1;
    else if (line.delayStatus === 'DELAY') entry.missed += 1;
    else entry.jConfirmation += 1; // 'Zamówienie potwierdzone'
  }
  return [...map.values()]
    .map((e) => ({ ...e, toExplain: e.total - e.onTime, grossPct: e.total === 0 ? 0 : e.onTime / e.total }));
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
// LOADING DATE) są wspólne dla wszystkich linii tego samego OBD — tak jest
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

// Pełny stan panelu "Opóźnione linie" (kraj, WMS Order, OBD, liczba linii, status algorytmu,
// kod przyczyny, wina, kto/kiedy ocenił) — jeden wpis na OBD, łącznie z jeszcze NIE ocenionymi
// (reasonCode/faultOwner = null). Używane przy zapisie dnia do backendu (patrz
// js/backend/otsDailyApi.js), żeby dało się później odtworzyć panel i wynik Net z danych
// zapisanych po stronie serwera, nie tylko z localStorage tej jednej przeglądarki.
export function buildDelayedLinesSnapshot(lines, reviewsByObd) {
  return groupNeedingReviewByObd(lines).map((group) => {
    const review = reviewsByObd[group.obd];
    return {
      obd: group.obd,
      wmsOrder: group.wmsOrder,
      country: group.country,
      lineCount: group.lineCount,
      algorithmStatus: group.delayStatus,
      reasonCode: review?.reasonCode ?? null,
      faultOwner: review?.faultOwner ?? null,
      reviewedBy: review?.reviewedBy ?? null,
      reviewedAt: review?.reviewedAt ?? null,
    };
  });
}

// --- Filtr daty na dashboardzie ---------------------------------------------
// Ważne: filtrujemy po AdjustedExpectedDate (data po korekcie przewoźnika/weekendu),
// NIE po surowym EXPECTED_SHIP_DATE z pliku — tak jak w Power BI.
export function filterByAdjustedDate(lines, date) {
  if (!date) return lines;
  return lines.filter((l) => isSameDay(l.adjustedExpectedDate, date));
}

// Zakres dat (obie granice włącznie, po AdjustedExpectedDate) — dashboard używa tego
// zamiast filterByAdjustedDate, żeby pokazać wyniki (KPI, tabela krajów, powody, panel
// "Opóźnione linie") za dowolny okres, np. cały miesiąc, nie tylko jeden dzień. Pojedynczy
// dzień to po prostu zakres, gdzie from === to.
export function filterByAdjustedDateRange(lines, from, to) {
  if (!from && !to) return lines;
  return lines.filter((l) => {
    if (!l.adjustedExpectedDate) return false;
    if (from && l.adjustedExpectedDate < from) return false;
    if (to && l.adjustedExpectedDate > to) return false;
    return true;
  });
}

// Linie od 1. dnia miesiąca zawierającego podaną datę do TEJ daty włącznie (month-to-date,
// po AdjustedExpectedDate) — używane do wyników miesięcznych w raporcie mailowym
// (js/emailReport.js). Celowo NIE cały miesiąc kalendarzowy: raport OBD obejmuje ~3 miesiące
// do przodu, więc przyszłe, jeszcze niewydarzone wysyłki obniżałyby wskaźnik OTS, mimo że
// nic się jeszcze nie spóźniło.
export function filterByAdjustedMonthToDate(lines, date) {
  if (!date) return lines;
  const year = date.getFullYear();
  const month = date.getMonth();
  return lines.filter(
    (l) => l.adjustedExpectedDate
      && l.adjustedExpectedDate.getFullYear() === year
      && l.adjustedExpectedDate.getMonth() === month
      && l.adjustedExpectedDate <= date,
  );
}

// --- Agregacja wyników zapisanych w backendzie (zakładka DASH) --------------
// results: [{ department, reportDate, totalLines, grossOnTimeLines, netOnTimeLines }],
// patrz js/backend/otsDailyApi.js -> fetchAllResults. To są już zapisane dzienne wyniki
// (po jednym na department+report_date), nie surowe linie OBD.

export function filterResultsByDepartment(results, department) {
  if (!department || department === 'all') return results;
  return results.filter((r) => r.department === department);
}

// fromIso/toIso: "YYYY-MM-DD" albo null (bez ograniczenia z danej strony). Porównanie
// leksykograficzne stringów działa poprawnie dla tego formatu, bez parsowania na Date.
export function filterResultsByDateRange(results, fromIso, toIso) {
  return results.filter((r) => {
    if (fromIso && r.reportDate < fromIso) return false;
    if (toIso && r.reportDate > toIso) return false;
    return true;
  });
}

// Najpóźniejsza report_date w zbiorze (string "YYYY-MM-DD") albo null, gdy pusty —
// używane jako domyślny górny koniec zakresu na wykresie DASH ("do dnia, w którym są dane").
export function maxReportDate(results) {
  if (results.length === 0) return null;
  return results.reduce((max, r) => (r.reportDate > max ? r.reportDate : max), results[0].reportDate);
}

// Grupowanie po dniu — potrzebne głównie wtedy, gdy dla jednego dnia zapisano wyniki
// kilku departmentów naraz (widok "Wszyscy klienci"), więc trzeba je zsumować, a nie
// tylko posortować.
export function groupResultsByDay(results) {
  const map = new Map();
  for (const r of results) {
    if (!map.has(r.reportDate)) {
      map.set(r.reportDate, { key: r.reportDate, totalLines: 0, grossOnTimeLines: 0, netOnTimeLines: 0 });
    }
    const entry = map.get(r.reportDate);
    entry.totalLines += r.totalLines;
    entry.grossOnTimeLines += r.grossOnTimeLines;
    entry.netOnTimeLines += r.netOnTimeLines;
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// Grupowanie po tygodniu (poniedziałek-niedziela, patrz dateUtils.startOfWeek).
export function groupResultsByWeek(results) {
  const map = new Map();
  for (const r of results) {
    const weekStart = startOfWeek(fromDateInputValue(r.reportDate));
    const key = toDateInputValue(weekStart);
    if (!map.has(key)) {
      map.set(key, { key, weekStart, totalLines: 0, grossOnTimeLines: 0, netOnTimeLines: 0 });
    }
    const entry = map.get(key);
    entry.totalLines += r.totalLines;
    entry.grossOnTimeLines += r.grossOnTimeLines;
    entry.netOnTimeLines += r.netOnTimeLines;
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// Sumuje total/gross/net_on_time_lines po wszystkich wynikach i liczy z tego JEDEN wspólny
// %Gross/%Net (ważona suma, nie średnia z dni) — pod kartę KPI wybranego okresu w zakładce
// DASH (patrz ui/dashView.js -> renderPeriodPanel), niezależnie od tego, ile dni/tygodni
// się w nim mieści.
export function aggregateResults(results) {
  const totals = results.reduce(
    (acc, r) => {
      acc.totalLines += r.totalLines;
      acc.grossOnTimeLines += r.grossOnTimeLines;
      acc.netOnTimeLines += r.netOnTimeLines;
      return acc;
    },
    { totalLines: 0, grossOnTimeLines: 0, netOnTimeLines: 0 },
  );
  return {
    grossPct: totals.totalLines === 0 ? 0 : totals.grossOnTimeLines / totals.totalLines,
    netPct: totals.totalLines === 0 ? 0 : totals.netOnTimeLines / totals.totalLines,
  };
}

// Dolicza %Gross/%Net do zgrupowanych wpisów — ważona suma (sum linii on-time / sum linii),
// NIE średnia z dziennych procentów, bo dni mają różny wolumen.
export function withPct(entries) {
  return entries.map((e) => ({
    ...e,
    grossPct: e.totalLines === 0 ? 0 : e.grossOnTimeLines / e.totalLines,
    netPct: e.totalLines === 0 ? 0 : e.netOnTimeLines / e.totalLines,
  }));
}

// Zakres dostępnych dat (po AdjustedExpectedDate) w aktualnie zaimportowanym pliku —
// używane do ograniczenia inputa z datą i podpowiedzi w UI.
export function adjustedDateRange(lines) {
  const dates = lines.map((l) => l.adjustedExpectedDate).filter(Boolean);
  if (dates.length === 0) return null;
  const timestamps = dates.map((d) => d.getTime());
  return { min: new Date(Math.min(...timestamps)), max: new Date(Math.max(...timestamps)) };
}
