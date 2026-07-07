/**
 * Statistical significance testing for provider referral trends.
 *
 * For each provider with an adequate history, the most recent 3-month window
 * is compared against that provider's own trailing-12-month baseline (the 12
 * months immediately before the window), seasonally adjusted using
 * practice-wide monthly indices, under a quasi-Poisson model whose dispersion
 * absorbs the provider's normal month-to-month volatility. Referral counts in
 * this dataset are overdispersed (variance ~2x the mean), so a plain Poisson
 * test would badly over-flag.
 *
 * Benjamini-Hochberg FDR control is applied across all providers tested in
 * the month, because testing ~130 providers at p<0.05 would produce ~7 false
 * alarms every month by chance alone.
 *
 * Tiers:
 *   'significant' — survives BH-FDR at 10% (near-certain real change)
 *   'likely'      — p < 0.05 individually but does not survive FDR
 *   null          — tested, within normal variation
 * Providers without a full baseline (too new, or under 12 baseline eyes) are
 * not tested and are absent from the results map.
 */

const CUR_N = 3; // current window: 3 months ending at report month
const BASE_N = 12; // baseline: the 12 months immediately before the window
const MIN_BASELINE_EYES = 12; // >= 1 eye/mo baseline so a rate is estimable
const FDR_LEVEL = 0.1;
const LIKELY_P = 0.05;

const monthKey = (y, m) => y * 12 + (m - 1);

// Standard normal CDF (Abramowitz & Stegun 7.1.26 approximation)
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * @param {Array<{year, month, provider, eyes}>} entries coalesced entries
 * @param {number} rmKey report-month key (year*12 + month-1)
 * @returns {{ testedCount: number, results: Map<string, object> }}
 */
export function computeSignificance(entries, rmKey) {
  // Per-provider monthly totals
  const series = new Map();
  for (const e of entries) {
    const k = monthKey(e.year, e.month);
    if (!series.has(e.provider)) series.set(e.provider, new Map());
    const m = series.get(e.provider);
    m.set(k, (m.get(k) || 0) + e.eyes);
  }

  // Practice-wide seasonal indices from monthly totals across all years
  const totals = new Map();
  for (const m of series.values())
    for (const [k, v] of m) totals.set(k, (totals.get(k) || 0) + v);
  const byCal = Array.from({ length: 12 }, () => []);
  for (const [k, v] of totals) byCal[((k % 12) + 12) % 12].push(v);
  const calAvg = byCal.map((a) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
  );
  const grandAvg = calAvg.reduce((a, b) => a + b, 0) / 12;
  const seasonalIndex = calAvg.map((v) => (grandAvg > 0 ? v / grandAvg : 1));
  const idxAt = (k) => seasonalIndex[((k % 12) + 12) % 12] || 1;

  const tested = [];
  for (const [provider, m] of series) {
    const val = (k) => m.get(k) || 0;

    let observed = 0;
    let curIdxSum = 0;
    for (let k = rmKey - CUR_N + 1; k <= rmKey; k++) {
      observed += val(k);
      curIdxSum += idxAt(k);
    }

    let baseline = 0;
    let baseIdxSum = 0;
    for (let k = rmKey - CUR_N - BASE_N + 1; k <= rmKey - CUR_N; k++) {
      baseline += val(k);
      baseIdxSum += idxAt(k);
    }
    if (baseline < MIN_BASELINE_EYES) continue;

    // Provider must have existed for the full baseline period; newer
    // providers have no stable rate to test against.
    const firstK = Math.min(...m.keys());
    if (firstK > rmKey - CUR_N - BASE_N + 1) continue;

    const seasonAdj = curIdxSum / CUR_N / (baseIdxSum / BASE_N);
    const expected = (baseline / BASE_N) * CUR_N * seasonAdj;
    if (!(expected > 0)) continue;

    // Per-provider dispersion (variance/mean of monthly counts) over the
    // active span; clamped to [1, 4], defaulting to the dataset-typical 2.
    let phi = 2;
    const span = [];
    for (let k = firstK; k <= rmKey; k++) span.push(val(k));
    if (span.length >= 12) {
      const mean = span.reduce((a, b) => a + b, 0) / span.length;
      const variance =
        span.reduce((a, b) => a + (b - mean) ** 2, 0) / (span.length - 1);
      if (mean > 0) phi = Math.max(1, Math.min(4, variance / mean));
    }

    const z = (observed - expected) / Math.sqrt(phi * expected);
    const p = 2 * (1 - normCdf(Math.abs(z)));
    tested.push({
      provider,
      observed,
      expected,
      pctChange: ((observed - expected) / expected) * 100,
      z,
      p,
      direction: z >= 0 ? 'up' : 'down',
    });
  }

  // Benjamini-Hochberg: largest i with p_(i) <= (i/n) * FDR marks the cutoff
  tested.sort((a, b) => a.p - b.p);
  let cut = -1;
  for (let i = 0; i < tested.length; i++) {
    if (tested[i].p <= ((i + 1) / tested.length) * FDR_LEVEL) cut = i;
  }

  const results = new Map();
  tested.forEach((r, i) => {
    const tier = i <= cut ? 'significant' : r.p < LIKELY_P ? 'likely' : null;
    results.set(r.provider, { ...r, tier });
  });

  return { testedCount: tested.length, results };
}
