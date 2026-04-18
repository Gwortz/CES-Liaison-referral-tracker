/**
 * Statistical model for referring provider data.
 *
 * Input: Array<{ provider, year, month, eyes }> — coalesced
 * Output: analysis object with SWOT buckets and summary
 */

const MIN_EYES = 6;
const WINDOW_MONTHS = 3;

/**
 * Returns true if the series has any rolling WINDOW_MONTHS calendar-month
 * window (missing months counted as 0 eyes) whose sum meets MIN_EYES.
 */
function qualifiesByWindow(arr, maxKey = Infinity) {
  const eligible = arr.filter((x) => x.key <= maxKey);
  if (!eligible.length) return false;
  const byKey = new Map(eligible.map((x) => [x.key, x.eyes]));
  const firstKey = eligible[0].key;
  const lastKey = eligible[eligible.length - 1].key;
  for (let end = firstKey + WINDOW_MONTHS - 1; end <= lastKey; end++) {
    let sum = 0;
    for (let k = end - WINDOW_MONTHS + 1; k <= end; k++) {
      sum += byKey.get(k) || 0;
    }
    if (sum >= MIN_EYES) return true;
  }
  return false;
}

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

/**
 * Trend arrow helper — always returns a safe ASCII character so nothing
 * ever renders as "undefined" or a box glyph in the PDF.
 */
export function trendArrow(trend) {
  const map = { increasing: '^', declining: 'v', flat: '-' };
  return map[trend] || '-';
}

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

  const series = buildProviderSeries(entries);

  // Identify qualifying providers (>=6 eyes in any consecutive 3-month window)
  const qualifying = new Map();
  for (const [provider, arr] of series) {
    if (!qualifiesByWindow(arr)) continue;
    const totalEyes = arr.reduce((s, x) => s + x.eyes, 0);
    const monthsPresent = arr.length;

    const values = arr.map((x) => x.eyes);
    const personalMean = mean(values);
    const personalStd = stddev(values);

    const last3Entries = arr.slice(-3);
    const last3Avg = mean(last3Entries.map((x) => x.eyes));

    const priorMatched = last3Entries.map((x) => {
      const found = arr.find((y) => y.key === x.key - 12);
      return found ? found.eyes : 0;
    });
    const priorAvg = mean(priorMatched);

    const slp = slope(last3Entries.map((x) => x.eyes));
    const direction = trendDirection(slp);

    const z = personalStd > 0 ? (last3Avg - personalMean) / personalStd : 0;

    const pctChange =
      priorAvg > 0 ? ((last3Avg - priorAvg) / priorAvg) * 100 : null;

    const nowMet = qualifiesByWindow(arr, monthKey(ry, rm));
    const prevMet = qualifiesByWindow(arr, monthKey(ry, rm) - 1);
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

  // Rank all qualifying providers by total historical referral volume BEFORE
  // the SWOT classification loop runs.
  const sortedByVolume = Array.from(qualifying.values()).sort(
    (a, b) => b.totalEyes - a.totalEyes
  );
  const top15 = new Set(sortedByVolume.slice(0, 15).map((x) => x.provider));

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

    // Weakness: declining AND has prior year data AND YoY is negative-or-flat (<+5%)
    if (
      declining &&
      p.priorAvg > 0 &&
      (p.pctChange === null || p.pctChange < 5)
    ) {
      weaknesses.push(p);
      continue;
    }

    // Opportunity: newly hit threshold, or trending strongly up vs personal norm
    if (p.newlyThreshold || p.zScore > 1.0) {
      opportunities.push(p);
      continue;
    }

    // Strength: top-15 volume AND not declining AND YoY isn't deep negative
    if (
      top15.has(p.provider) &&
      p.direction !== 'declining' &&
      (p.pctChange === null || p.pctChange > -15)
    ) {
      strengths.push(p);
    }
  }

  strengths.sort((a, b) => b.totalEyes - a.totalEyes);
  weaknesses.sort((a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0));
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

  // Reason strings — plain ASCII only (no sigma, no bullet arrows)
  const reasonFor = (p, type) => {
    const pctAbs =
      p.pctChange == null ? null : Math.abs(p.pctChange).toFixed(0) + '%';
    switch (type) {
      case 'strength':
        return `Top-15 referral volume (${Math.round(
          p.totalEyes
        )} eyes total) with ${p.direction} trend -- keep engaged.`;
      case 'weakness': {
        const parts = ['3-month trend is declining'];
        if (pctAbs && p.pctChange < 0) {
          parts.push(`down ${pctAbs} vs same period last year`);
        }
        return parts.join(' and ') + ' -- watch next month.';
      }
      case 'threat': {
        const bits = [];
        if (p.priorAvg > 0 && p.last3Avg < p.priorAvg && pctAbs)
          bits.push(`down ${pctAbs} vs same period last year`);
        if (p.zScore < -1.5)
          bits.push(
            `${Math.abs(p.zScore).toFixed(1)} SD below their personal average`
          );
        if (p.direction === 'declining')
          bits.push('declining 3 months in a row');
        return bits.length
          ? bits.join(' and ') + '.'
          : 'Multi-metric decline.';
      }
      case 'opportunity':
        if (p.newlyThreshold)
          return 'Just reached the referral threshold -- welcome and encourage.';
        return `3-month average is ${p.zScore.toFixed(
          1
        )} SD above this provider's personal norm -- reinforce the relationship.`;
      default:
        return '';
    }
  };

  const decorate = (p, type) => ({
    ...p,
    arrow: trendArrow(p.direction),
    reason: reasonFor(p, type),
  });

  const action = {
    thankList: strengths.map((p) => decorate(p, 'strength')),
    watchList: weaknesses.map((p) => decorate(p, 'weakness')),
    callList: threats.map((p) => decorate(p, 'threat')),
    welcomeList: opportunities.map((p) => decorate(p, 'opportunity')),
  };

  return {
    empty: false,
    reportMonth: { year: ry, month: rm },
    summary: {
      thisMonthTotal: Math.round(thisMonthTotal),
      lastMonthTotal: Math.round(lastMonthTotal),
      sameMonthPriorYearTotal: Math.round(sameMonthPriorYearTotal),
      momPct,
      yoyPct,
      activeProvidersThisMonth,
      qualifyingCount: qualifying.size,
      overallTrend,
    },
    swot: {
      strengths: strengths.map(enrich),
      weaknesses: weaknesses.map(enrich),
      opportunities: opportunities.map(enrich),
      threats: threats.map(enrich),
    },
    action,
  };
}

function enrich(p) {
  return {
    provider: p.provider,
    last3Avg: round1(p.last3Avg),
    priorAvg: round1(p.priorAvg),
    pctChange: p.pctChange == null ? null : round1(p.pctChange),
    direction: p.direction,
    arrow: trendArrow(p.direction),
    zScore: round2(p.zScore),
    totalEyes: Math.round(p.totalEyes),
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
