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

/**
 * Normalize display form of a provider name:
 * - standardize "Jr" / "Sr" punctuation
 * - drop trailing degree suffixes ("MD", "DO")
 * - canonicalize Roman numerals II / III
 * - tidy double commas and extra spaces
 */
export function cleanNameForDisplay(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\bJr\.?\b/gi, 'Jr')
    .replace(/\bSr\.?\b/gi, 'Sr')
    .replace(/\bMd\.?\b/gi, '')
    .replace(/\bDo\.?\b/gi, '')
    .replace(/\bIii\b/gi, 'III')
    .replace(/\bIi\b/gi, 'II')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',') // strip space before comma ("Glenn , Jason" -> "Glenn, Jason")
    .trim();
}

/**
 * Produce a matching key that collapses punctuation, comma position, and
 * middle-name abbreviations (e.g. "Mark Elliott" vs "Mark E.") so the same
 * provider written in different ways across months/years can be merged.
 */
export function matchKey(name) {
  const flat = name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = flat.split(' ').filter(Boolean);
  if (tokens.length <= 2) return tokens.join(' ');
  // Keep the first two tokens (usually surname + suffix or surname + first name).
  // Reduce every additional token to its first letter to merge middle-name
  // abbreviations.
  return [tokens[0], tokens[1], ...tokens.slice(2).map((t) => t[0])].join(' ');
}

function isExcludedName(name) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (lower.includes('no referring')) return true;
  if (lower.includes('grand total')) return true;
  if (lower === 'total' || lower.startsWith('total ')) return true;
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
        const titleCased = toTitleCase(String(rawName));
        const display = cleanNameForDisplay(titleCased);
        if (!display) continue;
        entries.push({
          year: mc.year,
          month: mc.month,
          provider: display,
          eyes,
        });
      }
    }
  }

  return entries;
}

/**
 * Merge duplicate provider name variants by matchKey, sum eyes per
 * (provider, year, month), and pick the longest display name as canonical.
 */
export function coalesceEntries(entries) {
  // Group entries by matchKey
  const groups = new Map();
  for (const e of entries) {
    const key = matchKey(e.provider);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const out = [];
  for (const [, list] of groups) {
    // Pick the longest display name (tie-break alphabetically) as canonical
    const display = list
      .map((e) => e.provider)
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];

    // Sum eyes per (year, month)
    const monthMap = new Map();
    for (const e of list) {
      const k = `${e.year}|${e.month}`;
      monthMap.set(k, (monthMap.get(k) || 0) + e.eyes);
    }
    for (const [k, eyes] of monthMap) {
      const [y, m] = k.split('|').map(Number);
      out.push({ year: y, month: m, provider: display, eyes });
    }
  }
  return out;
}
