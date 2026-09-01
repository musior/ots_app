// Budowa treści/tematu raportu OTS do wysyłki mailem — patrz js/app.js (wireEmailButton).
// Wszystkie wskaźniki w tym raporcie to OTS Gross (surowy, bez uwzględniania zapisanych
// powodów opóźnień) — to świadoma decyzja, inna niż karty "OTS Total Net" w dashboardzie.
// Tabela Country/WMS_ORDER/REASON_CODE jest czysto informacyjna: pokazuje WSZYSTKIE
// ocenione linie (Magazyn + Klient) z danego dnia, niezależnie od tego, czy dany powód
// wpływałby na Net.
//
// Budujemy DWIE wersje treści: zwykły tekst (tabulatory jako separator — fallback, gdyby
// przeglądarka nie wspierała zapisu HTML do schowka) i HTML z prawdziwymi <table> —
// to ta druga sprawia, że wklejenie w Outlooku (Ctrl+V) daje sformatowaną tabelę,
// a nie tekst z tabulatorami (patrz js/app.js -> copyReportToClipboard).

import {
  filterByAdjustedDate,
  filterByAdjustedMonthToDate,
  calculateGross,
  calculateCountryBreakdown,
  groupNeedingReviewByObd,
} from "./calcEngine.js";
import { formatDateDMY } from "./dateUtils.js";

// Stali odbiorcy w polu "Do" — jednakowi dla obu klientów (3ME i Solventum), ustalone z użytkownikiem.
const REPORT_TO_RECIPIENTS = [
  "Witold.Masson@fiege.pl",
  "Dawid.Kalamala@fiege.pl",
  "ADM3M@Fiege.pl",
  "magazyn3m.dg@fiege.pl",
  "CSExport3M@Fiege.pl",
  "CS.Outbound.3M@fiege.pl",
  "Bogumila.Kania@fiege.pl",
];

const TABLE_STYLE =
  "border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:4px 0 12px;";
const TH_STYLE =
  "border:1px solid #999999;padding:4px 10px;background:#f2f2f2;text-align:left;";
const TD_STYLE = "border:1px solid #999999;padding:4px 10px;";

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function htmlTable(headers, rows) {
  const thead = `<tr>${headers.map((h) => `<th style="${TH_STYLE}">${escapeHtml(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td style="${TD_STYLE}">${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table style="${TABLE_STYLE}" cellspacing="0" cellpadding="0"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function regionSummary(lines) {
  return {
    Total: calculateGross(lines),
    PL: calculateGross(lines.filter((l) => l.region === "PL")),
    EU: calculateGross(lines.filter((l) => l.region === "EU")),
    "NON EU": calculateGross(lines.filter((l) => l.region === "NON EU")),
  };
}

function regionRows(summary) {
  return [
    ["Total", pct(summary.Total)],
    ["PL", pct(summary.PL)],
    ["EU", pct(summary.EU)],
    ["NON EU", pct(summary["NON EU"])],
  ];
}

// Wiersze Country/WMS_ORDER/REASON_CODE dla wszystkich OBD danego dnia, które mają
// zapisaną ocenę (dowolny "faultOwner") — jeden wiersz raportu na OBD, tak jak w panelu
// "Opóźnione linie" (ocena dotyczy całego OBD, nie pojedynczej linii/OBD_LINE).
function explainedRows(dayLines, reviewsByObd) {
  return groupNeedingReviewByObd(dayLines)
    .map((g) => ({
      country: g.country || "—",
      wmsOrder: g.wmsOrder || "—",
      review: reviewsByObd[g.obd],
    }))
    .filter((g) => g.review && g.review.reasonCode)
    .map(({ country, wmsOrder, review }) => [
      country,
      wmsOrder,
      review.reasonCode,
    ]);
}

export function buildEmailReport({
  config,
  enrichedLines,
  selectedDate,
  reviewsByObd,
}) {
  const dayLines = filterByAdjustedDate(enrichedLines, selectedDate);
  const monthLines = filterByAdjustedMonthToDate(enrichedLines, selectedDate);
  const dateStr = formatDateDMY(selectedDate);

  const daily = regionSummary(dayLines);
  const monthly = regionSummary(monthLines);
  const countryRows = calculateCountryBreakdown(dayLines);
  const explained = explainedRows(dayLines, reviewsByObd);

  const headline = `Wynik OTS za dzień ${dateStr} wynosi ${pct(daily.Total)}`;
  const countryHeaders = [
    "Country",
    "Total",
    "On Time",
    "Missed",
    "J CONFIRMATION",
    "% OTS",
  ];
  const countryRowsFormatted = countryRows.map((row) => [
    row.country,
    row.total,
    row.onTime,
    row.missed,
    row.jConfirmation,
    pct(row.grossPct),
  ]);

  // --- Wersja tekstowa (fallback, gdyby przeglądarka nie wspierała zapisu HTML do schowka) ---
  const textLines = [];
  textLines.push(headline);
  textLines.push("");
  textLines.push("Country\tWMS_ORDER\tREASON_CODE");
  if (explained.length === 0) {
    textLines.push("Brak ocenionych linii tego dnia.");
  } else {
    explained.forEach((row) => textLines.push(row.join("\t")));
  }
  textLines.push("");
  textLines.push("Wyniki dzienne:");
  textLines.push("ID\t% OTS");
  regionRows(daily).forEach((row) => textLines.push(row.join("\t")));
  textLines.push("");
  textLines.push("Wyniki miesięczne:");
  textLines.push("ID\t% OTS");
  regionRows(monthly).forEach((row) => textLines.push(row.join("\t")));
  textLines.push("");
  textLines.push(countryHeaders.join("\t"));
  countryRowsFormatted.forEach((row) => textLines.push(row.join("\t")));
  textLines.push("");

  // --- Wersja HTML (prawdziwe <table> — to ona daje sformatowaną tabelę po wklejeniu w Outlooku) ---
  const explainedTable =
    explained.length === 0
      ? '<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">Brak ocenionych linii tego dnia.</p>'
      : htmlTable(["Country", "WMS_ORDER", "REASON_CODE"], explained);

  const htmlBody = `
    <div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">
      <p><b>${escapeHtml(headline)}</b></p>
      ${explainedTable}
      <p>Wyniki dzienne:</p>
      ${htmlTable(["ID", "% OTS"], regionRows(daily))}
      <p>Wyniki miesięczne:</p>
      ${htmlTable(["ID", "% OTS"], regionRows(monthly))}
      ${htmlTable(countryHeaders, countryRowsFormatted)}
    </div>
  `.trim();

  const subject = `OTS ${config.emailSubjectLabel} - ${dateStr}`;
  const to = REPORT_TO_RECIPIENTS.join(",");
  return { subject, to, textBody: textLines.join("\n"), htmlBody };
}
