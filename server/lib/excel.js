import * as XLSX from 'xlsx';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function toTitleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function isExcludedName(name) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/no referring phys/i.test(trimmed)) return true;
  return false;
}

function parseMonthHeader(headerText, fallbackYear) {
  if (!headerText || typeof headerText !== 'string') return null;
  const text = headerText.toLowerCase();
  const monthIdx = MONTH_NAMES.findIndex((m) => text.includes(m));
  if (monthIdx === -1) return null;
  const yearMatch = text.match(/(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : fallbackYear;
  if (!year) return null;
  return { year, month: monthIdx + 1 }; // 1-indexed month
}

/**
 * Parses the uploaded workbook. Each sheet is a year. Within each sheet,
 * columns are paired: (provider, eyes) for each month. Row 1 is headers.
 *
 * Returns: Array<{ year, month, provider, eyes }>
 */
export function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const entries = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    if (rows.length < 2) continue;

    const header = rows[0] || [];
    const fallbackYear = parseInt(sheetName.match(/(19|20)\d{2}/)?.[0] || '', 10) || null;

    // Walk header columns two at a time: provider col then eyes col
    const monthColumns = []; // { col, year, month }
    for (let c = 0; c < header.length; c += 2) {
      const cellText = header[c] == null ? '' : String(header[c]);
      const info = parseMonthHeader(cellText, fallbackYear);
      if (info) monthColumns.push({ col: c, ...info });
    }
    if (!monthColumns.length) continue;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      for (const mc of monthColumns) {
        const rawName = row[mc.col];
        const rawEyes = row[mc.col + 1];
        if (isExcludedName(rawName)) continue;
        const eyes = Number(rawEyes);
        if (!Number.isFinite(eyes) || eyes <= 0) continue;
        entries.push({
          year: mc.year,
          month: mc.month,
          provider: toTitleCase(String(rawName)),
          eyes,
        });
      }
    }
  }

  return entries;
}

/**
 * Combine duplicate (provider, year, month) rows by summing eyes.
 */
export function coalesceEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = `${e.provider}|${e.year}|${e.month}`;
    const existing = map.get(key);
    if (existing) existing.eyes += e.eyes;
    else map.set(key, { ...e });
  }
  return Array.from(map.values());
}
