import { parseNumericDate } from './dateUtils.js';

function splitLine(line, delimiter) {
  return line.split(delimiter);
}

// Odpowiednik kroków źródłowych w Power Query: import CSV -> nagłówki -> typy -> filtr
// na EXPECTED_SHIP_DATE <> null. Nie zajmuje się jeszcze AdjustedExpectedDate/DELAY_STATUS/region —
// to robi calcEngine.js na już sparsowanych wierszach.
export async function parseObdCsvFile(file, { delimiter = ';', encoding = 'windows-1250' } = {}) {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder(encoding);
  const text = decoder.decode(buffer);

  const rawLines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (rawLines.length < 2) return [];

  const headers = splitLine(rawLines[0], delimiter).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < rawLines.length; i++) {
    const values = splitLine(rawLines[i], delimiter);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] !== undefined ? values[idx].trim() : '';
    });

    if (!row.OBD || !row.EXPECTED_SHIP_DATE) continue;

    row.lineId = `${row.OBD}_${row.OBD_LINE}`;
    row.expectedShipDate = parseNumericDate(row.EXPECTED_SHIP_DATE);
    row.physicalShipDate = parseNumericDate(row.PHYSICAL_SHIP_DATE);
    row.confirmedDate = parseNumericDate(row.CONFIRMED_DATE);
    row.OBD_LINE = Number(row.OBD_LINE) || 0;
    row.OBD_QTY = Number(row.OBD_QTY) || 0;

    if (!row.expectedShipDate) continue;

    rows.push(row);
  }

  return rows;
}
