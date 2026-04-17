/**
 * Statistical model for referring provider data.
 *
 * Input: Array<{ provider, year, month, eyes }> — coalesced
 * Output: analysis object with SWOT buckets and summary
 */

const MIN_EYES = 6;
const MIN_MONTHS = 3;

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function monthKey(year, month) {
  return year * 12 + (month - 1);
}

function fromMonthKey(k) {
  return { year: Math.floor(k / 12), month: (k % 12) + 1 };
}

/**
 * Linear regression slope of y vs x = [0..n-1]. Returns slope in eyes/month.
 */
function slope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (values[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function trendDirection(slp) {
  if (slp > 0.25) return 'increasing';
  if (slp < -0.25) return 'declining';
  return 'flat';
}

function arrowFor(direction) {
  if (direction === 'increasing') return '↑';
  if (direction === 'declining') return '↓';
  return '→';
}

/**
 * Builds a per-provider time-series (sparse, by monthKey) and computes metrics.
 */
function buildProviderSeries(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.provider)) map.set(e.provider, []);
    map.get(e.provider).push({ key: monthKey(e.year, e.month), eyes: e.eyes });
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.key - b.key);
  }
  return map;
}

/**
 * Compute report-month context from entries (latest (year, month) present).
 */
function determineReportMonth(entries) {
  if (!entries.length) return null;
  let maxKey = -Infinity;
  for (const e of entries) {
    const k = monthKey(e.year, e.month);
    if (k > maxKey) maxKey = k;
  }
  return fromMonthKey(maxKey);
}

function monthTotal(entries, year, month) {
  return entries
    .filter((e) => e.year === year && e.month === month)
    .reduce((s, e) => s + e.eyes, 0);
}

function providersInMonth(entries, year, month) {
  const set = new Set();
  for (const e of entries) {
    if (e.year === year && e.month === month) set.add(e.provider);
  }
  return set.size;
}

function prevMonth(year, month) {
  const k = monthKey(year, month) - 1;
  return fromMonthKey(k);
}

export function analyze(entries) {
  if (!entries.length) {
    return { empty: true };
  }

  const reportMonth = determineReportMonth(entries);
  const { year: ry, month: rm } = reportMonth;

  // Last 3 months (based on reportMonth)
  const lastThreeKeys = [monthKey(ry, rm) - 2, monthKey(ry, rm) - 1, monthKey(ry, rm)];
  const lastThreeMonths = lastThreeKeys.map(fromMonthKey);

  // Same 3 months prior year
  const priorYearThreeKeys = lastThreeKeys.map((k) => k - 12);

  const series = buildProviderSeries(entries);

  // Identify providers meeting minimum threshold: >= 6 eyes across >= 3 months
  const qualifying = new Map(); // provider -> stats
  for (const [provider, arr] of series) {
    const totalEyes = arr.reduce((s, x) => s + x.eyes, 0);
    const monthsPresent = arr.length;
    if (totalEyes < MIN_EYES || monthsPresent < MIN_MONTHS) continue;

    const values = arr.map((x) => x.eyes);
    const personalMean = mean(values);
    const personalStd = stddev(values);

    // Recent 3 months they appear in — most recent entries (not necessarily reportMonth aligned)
    const last3Entries = arr.slice(-3);
    const last3Avg = mean(last3Entries.map((x) => x.eyes));

    // Same-period prior year: look up entries matching last3Entries' months shifted by -12
    const priorMatched = last3Entries.map((x) => {
      const found = arr.find((y) => y.key === x.key - 12);
      return found ? found.eyes : 0;
    });
    const priorAvg = mean(priorMatched);

    // Trend slope over last 3 months
    const slp = slope(last3Entries.map((x) => x.eyes));
    const direction = trendDirection(slp);

    // Personal Z-score
    const z = personalStd > 0 ? (last3Avg - personalMean) / personalStd : 0;

    // Percent change vs prior year same period
    const pctChange =
      priorAvg > 0 ? ((last3Avg - priorAvg) / priorAvg) * 100 : null;

    // Check if this is a new-to-threshold provider:
    // they hit threshold only considering months up through reportMonth,
    // but would not have met it one month earlier.
    const throughNow = arr.filter((x) => x.key <= monthKey(ry, rm));
    const throughPrev = arr.filter((x) => x.key <= monthKey(ry, rm) - 1);
    const nowMet =
      throughNow.reduce((s, x) => s + x.eyes, 0) >= MIN_EYES &&
      throughNow.length >= MIN_MONTHS;
    const prevMet =
      throughPrev.reduce((s, x) => s + x.eyes, 0) >= MIN_EYES &&
      throughPrev.length >= MIN_MONTHS;
    const newlyThreshold = nowMet && !prevMet;

    qualifying.set(provider, {
      provider,
      totalEyes,
      monthsPresent,
      personalMean,
      personalStd,
      last3Avg,
      priorAvg,
      pctChange,
      slope: slp,
      direction,
      zScore: z,
      newlyThreshold,
    });
  }

  // Top 10 by total referral volume
  const sortedByVolume = Array.from(qualifying.values()).sort(
    (a, b) => b.totalEyes - a.totalEyes
  );
  const top10 = new Set(sortedByVolume.slice(0, 10).map((x) => x.provider));

  // Categorize into SWOT
  const strengths = [];
  const weaknesses = [];
  const opportunities = [];
  const threats = [];

  for (const p of qualifying.values()) {
    const declining = p.direction === 'declining';
    const downVsPrior = p.priorAvg > 0 && p.last3Avg < p.priorAvg;
    const zBelow = p.zScore < -1.5;

    const threatFlags = [downVsPrior, zBelow, declining].filter(Boolean).length;
    const isThreat = threatFlags >= 2;

    if (isThreat) {
      threats.push(p);
      continue;
    }
    if (declining) {
      weaknesses.push(p);
      continue;
    }
    if (p.newlyThreshold || p.zScore > 1.0) {
      opportunities.push(p);
      // Can ALSO be strength; but not both to keep report clean → skip strength if opp
      continue;
    }
    if (top10.has(p.provider) && (p.direction === 'flat' || p.direction === 'increasing')) {
      strengths.push(p);
    }
  }

  // Sort each bucket for display
  strengths.sort((a, b) => b.totalEyes - a.totalEyes);
  weaknesses.sort((a, b) => a.pctChange ?? 0 - (b.pctChange ?? 0));
  opportunities.sort((a, b) => b.zScore - a.zScore);
  threats.sort((a, b) => (a.pctChange ?? -9999) - (b.pctChange ?? -9999));

  // Executive summary
  const thisMonthTotal = monthTotal(entries, ry, rm);
  const prev = prevMonth(ry, rm);
  const lastMonthTotal = monthTotal(entries, prev.year, prev.month);
  const sameMonthPriorYearTotal = monthTotal(entries, ry - 1, rm);
  const activeProvidersThisMonth = providersInMonth(entries, ry, rm);

  const momPct =
    lastMonthTotal > 0
      ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100
      : null;
  const yoyPct =
    sameMonthPriorYearTotal > 0
      ? ((thisMonthTotal - sameMonthPriorYearTotal) / sameMonthPriorYearTotal) * 100
      : null;

  let overallTrend;
  if (yoyPct == null && momPct == null) {
    overallTrend = 'No prior-period data available for comparison.';
  } else {
    const parts = [];
    if (momPct != null) {
      const dir = momPct > 1 ? 'up' : momPct < -1 ? 'down' : 'roughly flat';
      parts.push(`${dir} ${Math.abs(momPct).toFixed(1)}% vs last month`);
    }
    if (yoyPct != null) {
      const dir = yoyPct > 1 ? 'up' : yoyPct < -1 ? 'down' : 'roughly flat';
      parts.push(`${dir} ${Math.abs(yoyPct).toFixed(1)}% vs same month last year`);
    }
    overallTrend = `Overall referrals are ${parts.join(' and ')}.`;
  }

  // Monthly Action Report — build reason strings
  const reasonFor = (p, type) => {
    const pct =
      p.pctChange == null ? null : Math.abs(p.pctChange).toFixed(0) + '%';
    switch (type) {
      case 'strength':
        return `Top-10 volume (${p.totalEyes} eyes total) with ${p.direction} trend — keep engaged.`;
      case 'weakness':
        return `Trend declining 3 months in a row${
          pct && p.pctChange < 0 ? ` and down ${pct} vs same period last year` : ''
        } — watch next month.`;
      case 'threat': {
        const bits = [];
        if (p.priorAvg > 0 && p.last3Avg < p.priorAvg && pct)
          bits.push(`down ${pct} vs same period last year`);
        if (p.zScore < -1.5)
          bits.push(`${Math.abs(p.zScore).toFixed(1)}σ below their personal average`);
        if (p.direction === 'declining') bits.push('declining 3 months in a row');
        return bits.length ? bits.join(' and ') + '.' : 'Multi-metric decline.';
      }
      case 'opportunity':
        if (p.newlyThreshold)
          return `Just reached the referral threshold — welcome and encourage.`;
        return `3-month average ${p.zScore.toFixed(
          1
        )}σ above personal norm — reinforce the relationship.`;
    }
  };

  const action = {
    thankList: strengths.map((p) => ({ ...p, reason: reasonFor(p, 'strength') })),
    watchList: weaknesses.map((p) => ({ ...p, reason: reasonFor(p, 'weakness') })),
    callList: threats.map((p) => ({ ...p, reason: reasonFor(p, 'threat') })),
    welcomeList: opportunities.map((p) => ({
      ...p,
      reason: reasonFor(p, 'opportunity'),
    })),
  };

  return {
    empty: false,
    reportMonth: { year: ry, month: rm },
    summary: {
      thisMonthTotal,
      lastMonthTotal,
      sameMonthPriorYearTotal,
      momPct,
      yoyPct,
      activeProvidersThisMonth,
      qualifyingCount: qualifying.size,
      overallTrend,
    },
    swot: {
      strengths: strengths.map((p) => enrich(p)),
      weaknesses: weaknesses.map((p) => enrich(p)),
      opportunities: opportunities.map((p) => enrich(p)),
      threats: threats.map((p) => enrich(p)),
    },
    action,
  };
}

function enrich(p) {
  return {
    provider: p.provider,
    last3Avg: round2(p.last3Avg),
    priorAvg: round2(p.priorAvg),
    pctChange: p.pctChange == null ? null : round1(p.pctChange),
    direction: p.direction,
    arrow: arrowFor(p.direction),
    zScore: round2(p.zScore),
    totalEyes: p.totalEyes,
    monthsPresent: p.monthsPresent,
    newlyThreshold: p.newlyThreshold,
  };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
function round2(x) {
  return Math.round(x * 100) / 100;
}
