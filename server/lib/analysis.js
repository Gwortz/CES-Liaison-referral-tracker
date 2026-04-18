/**
 * Statistical model for referring provider data.
 *
 * Input: Array<{ provider, year, month, eyes }> — coalesced
 * Output: analysis object with SWOT buckets and summary
 *
 * Rebuild highlights:
 *  - Qualifying rule: trailing-12-month sum >= 20 (i.e. avg >= 5/quarter).
 *  - Four per-provider metrics: 3-mo avg, 12-mo avg (excl. zero months),
 *    prior-year same 3-mo avg (null if absent), absolute change (whole).
 *  - Volume-tiered thresholds (high/medium/standard/low).
 *  - Five SWOT categories evaluated in strict priority order:
 *      Zero Referrals -> Strengths -> Threats -> Weaknesses -> Opportunities.
 *  - Dual trend model (3-month and 12-month), ±2 thresholds.
 */

const QUALIFYING_TRAILING_SUM = 20;

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function monthKey(year, month) {
  return year * 12 + (month - 1);
}

function fromMonthKey(k) {
  return { year: Math.floor(k / 12), month: (k % 12) + 1 };
}

function monthLabel(k) {
  const { year, month } = fromMonthKey(k);
  return `${MONTH_SHORT[month - 1]} ${year}`;
}

function priorYearPeriodLabel(rmKey) {
  // Prior-year same 3 months ending rmKey-12
  const endK = rmKey - 12;
  const startK = endK - 2;
  const s = fromMonthKey(startK);
  const e = fromMonthKey(endK);
  if (s.year === e.year) {
    return `${MONTH_SHORT[s.month - 1]}-${MONTH_SHORT[e.month - 1]} ${e.year}`;
  }
  return `${MONTH_SHORT[s.month - 1]} ${s.year}-${MONTH_SHORT[e.month - 1]} ${e.year}`;
}

function buildByMonth(arr) {
  const m = new Map();
  for (const x of arr) m.set(x.key, (m.get(x.key) || 0) + x.eyes);
  return m;
}

function buildProviderSeries(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.provider)) map.set(e.provider, []);
    map.get(e.provider).push({ key: monthKey(e.year, e.month), eyes: e.eyes });
  }
  for (const arr of map.values()) arr.sort((a, b) => a.key - b.key);
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

/**
 * Sum of eyes in the trailing `n` months ending at rmKey (inclusive).
 * Missing months count as 0.
 */
function trailingSum(byMonth, rmKey, n) {
  let sum = 0;
  for (let k = rmKey - n + 1; k <= rmKey; k++) sum += byMonth.get(k) || 0;
  return sum;
}

/**
 * Whether the provider qualifies as of the given report-month key.
 */
function qualifyingAsOf(byMonth, rmKey) {
  return trailingSum(byMonth, rmKey, 12) >= QUALIFYING_TRAILING_SUM;
}

/**
 * 3-month rolling average across [rmKey-2, rmKey-1, rmKey].
 * Missing months: if the provider has any activity in the prior 6 months
 * (rmKey-8..rmKey-3), treat the missing month as 0 (they went dormant).
 * Otherwise exclude that slot (they simply weren't around yet).
 * Returns { avg, sufficient, valuesForTrend } where valuesForTrend is an
 * array of length 3 with nulls where excluded, used by threeMonthTrend.
 */
function threeMonthWindow(byMonth, rmKey) {
  const slots = [rmKey - 2, rmKey - 1, rmKey];
  const values = [];
  const valuesForTrend = [];
  let hasAny = false;
  for (const k of slots) {
    if (byMonth.has(k)) {
      const v = byMonth.get(k) || 0;
      values.push(v);
      valuesForTrend.push(v);
      hasAny = true;
    } else {
      // Check the prior 6 months for activity
      let priorActivity = false;
      for (let j = rmKey - 8; j <= rmKey - 3; j++) {
        if ((byMonth.get(j) || 0) > 0) { priorActivity = true; break; }
      }
      if (priorActivity) {
        values.push(0);
        valuesForTrend.push(0);
        hasAny = true;
      } else {
        valuesForTrend.push(null); // exclude
      }
    }
  }
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const sufficient = valuesForTrend.filter((v) => v !== null).length >= 2;
  return { avg, sufficient, valuesForTrend };
}

/**
 * 12-month rolling average across [rmKey-11..rmKey], averaging ONLY months
 * where eyes > 0 (excluding zero/missing months).
 */
function twelveMonthAverage(byMonth, rmKey) {
  const nonZero = [];
  for (let k = rmKey - 11; k <= rmKey; k++) {
    const v = byMonth.get(k) || 0;
    if (v > 0) nonZero.push(v);
  }
  if (!nonZero.length) return 0;
  return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
}

/**
 * Prior-year same 3-month period average.
 * Returns null when that prior-year window has NO data at all.
 */
function priorYearSame3Avg(byMonth, rmKey) {
  const slots = [rmKey - 14, rmKey - 13, rmKey - 12];
  let hasAny = false;
  let sum = 0;
  let count = 0;
  for (const k of slots) {
    if (byMonth.has(k)) {
      hasAny = true;
      sum += byMonth.get(k) || 0;
      count += 1;
    }
  }
  if (!hasAny) return null;
  // Present slots averaged over 3 (missing counted as 0 -- they had opportunity)
  return sum / 3;
}

/**
 * 3-month trend: compare newest present month vs oldest present month in
 * [rmKey-2, rmKey-1, rmKey]. Threshold +/- 2 eyes.
 */
function threeMonthTrend(valuesForTrend) {
  const present = valuesForTrend
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v !== null);
  if (present.length < 2) return { trend: 'insufficient', diff: null };
  const oldest = present[0].v;
  const newest = present[present.length - 1].v;
  const diff = newest - oldest;
  if (diff >= 2) return { trend: 'increasing', diff };
  if (diff <= -2) return { trend: 'declining', diff };
  return { trend: 'flat', diff };
}

/**
 * 12-month trend: first half [rmKey-11..rmKey-6] vs second half
 * [rmKey-5..rmKey]. Missing months count as zero. Compare the half-averages.
 */
function twelveMonthTrend(byMonth, rmKey) {
  const firstHalf = [];
  const secondHalf = [];
  for (let k = rmKey - 11; k <= rmKey - 6; k++) firstHalf.push(byMonth.get(k) || 0);
  for (let k = rmKey - 5; k <= rmKey; k++) secondHalf.push(byMonth.get(k) || 0);
  const a = firstHalf.reduce((s, v) => s + v, 0) / 6;
  const b = secondHalf.reduce((s, v) => s + v, 0) / 6;
  const diff = b - a;
  if (diff >= 2) return { trend: 'increasing', diff };
  if (diff <= -2) return { trend: 'declining', diff };
  return { trend: 'flat', diff };
}

function tierForAvg(twelveMoAvg) {
  if (twelveMoAvg >= 15) return { name: 'high', threshold: 4 };
  if (twelveMoAvg >= 8) return { name: 'medium', threshold: 3 };
  if (twelveMoAvg >= 4) return { name: 'standard', threshold: 2 };
  return { name: 'low', threshold: 2 };
}

// Trend symbols: ASCII for PDF safety (WinAnsi), Unicode for web display.
const TREND_SYMBOL_ASCII = { increasing: '^', declining: 'v', flat: '-', insufficient: '?' };
const TREND_SYMBOL_UNI = { increasing: '\u25B2', declining: '\u25BC', flat: '\u2192', insufficient: '?' };

function combinedSymbol(t3, t12, pickMap) {
  return `${pickMap[t3] || pickMap.insufficient}${pickMap[t12] || pickMap.insufficient}`;
}

export function trendArrow(trend) {
  return TREND_SYMBOL_ASCII[trend] || '-';
}

export function analyze(entries) {
  if (!entries.length) return { empty: true };

  const reportMonth = determineReportMonth(entries);
  const { year: ry, month: rm } = reportMonth;
  const rmKey = monthKey(ry, rm);
  const priorPeriodLabel = priorYearPeriodLabel(rmKey);

  const series = buildProviderSeries(entries);

  // Identify qualifying providers (trailing-12 sum >= 20).
  const qualifying = new Map();
  for (const [provider, arr] of series) {
    const byMonth = buildByMonth(arr);
    if (!qualifyingAsOf(byMonth, rmKey)) continue;

    const totalEyes = arr.reduce((s, x) => s + x.eyes, 0);
    const monthsPresent = arr.length;

    const { avg: last3Avg, valuesForTrend } = threeMonthWindow(byMonth, rmKey);
    const twelveMoAvg = twelveMonthAverage(byMonth, rmKey);
    const priorAvg = priorYearSame3Avg(byMonth, rmKey);
    const absoluteChange = priorAvg == null
      ? null
      : Math.round(last3Avg * 3) - Math.round(priorAvg * 3); // total eyes over the 3mo

    const pctChange = priorAvg && priorAvg > 0
      ? ((last3Avg - priorAvg) / priorAvg) * 100
      : null;

    const t3 = threeMonthTrend(valuesForTrend);
    const t12 = twelveMonthTrend(byMonth, rmKey);

    const tier = tierForAvg(twelveMoAvg);

    const qualifiedAsOfPrior6 = qualifyingAsOf(byMonth, rmKey - 6);
    const isNewProvider = !qualifiedAsOfPrior6;

    const currentMonthEyes = byMonth.get(rmKey) || 0;
    const trailing12BeforeThis = trailingSum(byMonth, rmKey - 1, 12);
    const isZeroReferrals = currentMonthEyes === 0 && trailing12BeforeThis >= 1;

    qualifying.set(provider, {
      provider,
      totalEyes,
      monthsPresent,
      last3Avg,
      twelveMoAvg,
      priorAvg, // may be null
      absoluteChange, // may be null
      pctChange, // may be null
      threeMonthTrend: t3.trend,
      twelveMonthTrend: t12.trend,
      threeMonthDiff: t3.diff,
      twelveMonthDiff: t12.diff,
      tier,
      isNewProvider,
      isZeroReferrals,
      currentMonthEyes,
    });
  }

  // Classification in strict priority order:
  //   1) Zero Referrals -> 2) Strengths -> 3) Threats
  //   -> 4) Weaknesses -> 5) Opportunities
  const zeroReferrals = [];
  const strengths = [];
  const threats = [];
  const weaknesses = [];
  const opportunities = [];

  for (const p of qualifying.values()) {
    // 1) Zero Referrals This Month
    if (p.isZeroReferrals) {
      zeroReferrals.push(p);
      continue;
    }

    // 2) Strengths — surging providers
    //    last3Avg - twelveMoAvg >= tier.threshold AND threeMonthTrend === 'increasing'
    const surging =
      (p.last3Avg - p.twelveMoAvg) >= p.tier.threshold &&
      p.threeMonthTrend === 'increasing';
    if (surging) {
      strengths.push(p);
      continue;
    }

    // 3) Threats — material decline vs prior year (or vs 12mo baseline when no PY)
    let isThreat = false;
    if (p.priorAvg != null) {
      if ((p.priorAvg - p.last3Avg) >= p.tier.threshold) isThreat = true;
    } else {
      if ((p.twelveMoAvg - p.last3Avg) >= p.tier.threshold) isThreat = true;
    }
    if (isThreat) {
      threats.push(p);
      continue;
    }

    // 4) Weaknesses — softening, below 12mo baseline or declining trend
    //    Excludes seasonal dips: if priorAvg < twelveMoAvg (seasonal low),
    //    only flag when (priorAvg - last3Avg) >= tier.threshold.
    const belowBaseline = (p.twelveMoAvg - p.last3Avg) >= p.tier.threshold;
    const trendingDown =
      p.threeMonthTrend === 'declining' || p.twelveMonthTrend === 'declining';
    let isWeakness = belowBaseline || trendingDown;
    if (isWeakness && p.priorAvg != null && p.priorAvg < p.twelveMoAvg) {
      // Seasonal low — require a real drop vs prior-year seasonal norm
      isWeakness = (p.priorAvg - p.last3Avg) >= p.tier.threshold;
    }
    if (isWeakness) {
      weaknesses.push(p);
      continue;
    }

    // 5) Opportunities — new qualifiers, or improving without surging
    const improving =
      p.threeMonthTrend === 'increasing' || p.twelveMonthTrend === 'increasing';
    if (p.isNewProvider || improving) {
      opportunities.push(p);
      continue;
    }
  }

  // Sort strategies
  zeroReferrals.sort((a, b) => b.twelveMoAvg - a.twelveMoAvg);
  strengths.sort((a, b) => (b.last3Avg - b.twelveMoAvg) - (a.last3Avg - a.twelveMoAvg));
  // Threats: rank by absoluteChange ascending (most negative first)
  threats.sort((a, b) => {
    const av = a.absoluteChange ?? (a.last3Avg - a.twelveMoAvg) * 3;
    const bv = b.absoluteChange ?? (b.last3Avg - b.twelveMoAvg) * 3;
    return av - bv;
  });
  weaknesses.sort((a, b) => (a.last3Avg - a.twelveMoAvg) - (b.last3Avg - b.twelveMoAvg));
  opportunities.sort((a, b) => (b.last3Avg - b.twelveMoAvg) - (a.last3Avg - a.twelveMoAvg));

  // ---- Executive summary aggregates ----
  const thisMonthTotal = monthTotal(entries, ry, rm);
  const prev = prevMonth(ry, rm);
  const lastMonthTotal = monthTotal(entries, prev.year, prev.month);
  const sameMonthPriorYearTotal = monthTotal(entries, ry - 1, rm);
  const activeProvidersThisMonth = providersInMonth(entries, ry, rm);

  let last3MonthsTotal = 0;
  let priorYear3MonthsTotal = 0;
  for (let i = 0; i < 3; i++) {
    const cur = fromMonthKey(rmKey - i);
    last3MonthsTotal += monthTotal(entries, cur.year, cur.month);
    priorYear3MonthsTotal += monthTotal(entries, cur.year - 1, cur.month);
  }

  let ytdTotal = 0;
  for (let m = 1; m <= rm; m++) ytdTotal += monthTotal(entries, ry, m);

  let priorYearSamePeriodTotal = 0;
  for (let m = 1; m <= rm; m++)
    priorYearSamePeriodTotal += monthTotal(entries, ry - 1, m);
  let priorYearFullTotal = 0;
  for (let m = 1; m <= 12; m++)
    priorYearFullTotal += monthTotal(entries, ry - 1, m);

  let predictedAnnualTotal;
  let predictionMethod;
  if (rm >= 12) {
    predictedAnnualTotal = ytdTotal;
    predictionMethod = 'actual (full year present)';
  } else if (priorYearSamePeriodTotal > 0 && priorYearFullTotal > 0) {
    predictedAnnualTotal = Math.round(
      (ytdTotal * priorYearFullTotal) / priorYearSamePeriodTotal
    );
    predictionMethod = 'seasonally adjusted from prior year';
  } else {
    predictedAnnualTotal = Math.round((ytdTotal * 12) / rm);
    predictionMethod = 'linear extrapolation';
  }

  const momPct =
    lastMonthTotal > 0
      ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100
      : null;
  const yoyPct =
    sameMonthPriorYearTotal > 0
      ? ((thisMonthTotal - sameMonthPriorYearTotal) / sameMonthPriorYearTotal) * 100
      : null;

  // Plain-English overall assessment
  const overallAssessment = buildOverallAssessment({
    momPct,
    yoyPct,
    counts: {
      strengths: strengths.length,
      threats: threats.length,
      weaknesses: weaknesses.length,
      opportunities: opportunities.length,
      zeroReferrals: zeroReferrals.length,
    },
  });

  // Short overallTrend line (preserved for compatibility with existing UI/PDF helpers)
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

  // Reason text per bucket — plain ASCII, no Unicode.
  const reasonFor = (p, type) => {
    const tierName = p.tier.name;
    const last3 = p.last3Avg.toFixed(1);
    const twelve = p.twelveMoAvg.toFixed(1);
    const prior = p.priorAvg == null ? null : p.priorAvg.toFixed(1);
    switch (type) {
      case 'strength':
        return `Surging: 3mo avg ${last3} vs 12mo avg ${twelve} (${tierName} tier, +${p.tier.threshold} threshold). 3mo trend increasing -- thank and keep engaged.`;
      case 'threat': {
        if (prior != null && p.absoluteChange != null) {
          return `Material decline: 3mo avg ${last3} vs prior ${prior} for ${priorPeriodLabel} (${tierName} tier). Absolute change ${p.absoluteChange} eyes -- call immediately.`;
        }
        return `Material decline: 3mo avg ${last3} vs 12mo avg ${twelve} (${tierName} tier, no prior year data) -- call immediately.`;
      }
      case 'weakness': {
        if (prior != null) {
          return `Softening: 3mo avg ${last3} vs 12mo avg ${twelve}, prior-year ${prior} (${tierName} tier) -- watch next month.`;
        }
        return `Softening: 3mo avg ${last3} vs 12mo avg ${twelve} (${tierName} tier, no prior year data) -- watch next month.`;
      }
      case 'opportunity':
        if (p.isNewProvider) {
          return `Newly qualifying provider (3mo avg ${last3}, 12mo avg ${twelve}) -- welcome and encourage.`;
        }
        return `Improving: 3mo avg ${last3} vs 12mo avg ${twelve} (${tierName} tier) -- reinforce the relationship.`;
      case 'zero': {
        return `No referrals this month; 12mo avg was ${twelve} (${tierName} tier) -- personal outreach needed.`;
      }
      default:
        return '';
    }
  };

  const decorate = (p, type) => {
    const e = enrich(p, priorPeriodLabel);
    return { ...e, reason: reasonFor(p, type) };
  };

  const action = {
    thankList: strengths.map((p) => decorate(p, 'strength')),
    callList: threats.map((p) => decorate(p, 'threat')),
    watchList: weaknesses.map((p) => decorate(p, 'weakness')),
    welcomeList: opportunities.map((p) => decorate(p, 'opportunity')),
    zeroList: zeroReferrals.map((p) => decorate(p, 'zero')),
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
      zeroReferralCount: zeroReferrals.length,
      callListCount: threats.length,
      overallTrend,
      overallAssessment,
      last3MonthsTotal: Math.round(last3MonthsTotal),
      priorYear3MonthsTotal: Math.round(priorYear3MonthsTotal),
      ytdTotal: Math.round(ytdTotal),
      predictedAnnualTotal: Math.round(predictedAnnualTotal),
      predictionMethod,
      priorPeriodLabel,
    },
    swot: {
      zeroReferrals: zeroReferrals.map((p) => enrich(p, priorPeriodLabel)),
      strengths: strengths.map((p) => enrich(p, priorPeriodLabel)),
      threats: threats.map((p) => enrich(p, priorPeriodLabel)),
      weaknesses: weaknesses.map((p) => enrich(p, priorPeriodLabel)),
      opportunities: opportunities.map((p) => enrich(p, priorPeriodLabel)),
    },
    action,
  };
}

function buildOverallAssessment({ momPct, yoyPct, counts }) {
  const momText =
    momPct == null
      ? 'no prior-month comparison available'
      : momPct > 1
      ? `up ${momPct.toFixed(1)}% vs last month`
      : momPct < -1
      ? `down ${Math.abs(momPct).toFixed(1)}% vs last month`
      : 'roughly flat vs last month';
  const yoyText =
    yoyPct == null
      ? 'no prior-year comparison available'
      : yoyPct > 1
      ? `up ${yoyPct.toFixed(1)}% vs the same month last year`
      : yoyPct < -1
      ? `down ${Math.abs(yoyPct).toFixed(1)}% vs the same month last year`
      : 'roughly flat vs the same month last year';

  const tone =
    counts.threats + counts.zeroReferrals > counts.strengths + counts.opportunities
      ? 'attention is needed on the call and zero-referral lists first'
      : counts.strengths + counts.opportunities > counts.threats + counts.zeroReferrals
      ? 'momentum is positive -- prioritize thank-you touches and nurture opportunities'
      : 'the month is mixed -- balance retention visits with outreach to softening providers';

  return `Overall referrals are ${momText} and ${yoyText}. ${counts.strengths} provider(s) are surging, ${counts.threats} show material decline, ${counts.weaknesses} are softening, ${counts.opportunities} are emerging opportunities, and ${counts.zeroReferrals} sent zero this month. Recommendation: ${tone}.`;
}

function enrich(p, priorPeriodLabel) {
  const trendSymbolAscii = combinedSymbol(p.threeMonthTrend, p.twelveMonthTrend, TREND_SYMBOL_ASCII);
  const trendSymbol = combinedSymbol(p.threeMonthTrend, p.twelveMonthTrend, TREND_SYMBOL_UNI);
  return {
    provider: p.provider,
    last3Avg: round1(p.last3Avg),
    twelveMoAvg: round1(p.twelveMoAvg),
    priorAvg: p.priorAvg == null ? null : round1(p.priorAvg),
    priorPeriodLabel: p.priorAvg == null ? 'No prior year data' : priorPeriodLabel,
    absoluteChange: p.absoluteChange == null ? null : Math.round(p.absoluteChange),
    pctChange: p.pctChange == null ? null : round1(p.pctChange),
    threeMonthTrend: p.threeMonthTrend,
    twelveMonthTrend: p.twelveMonthTrend,
    trendSymbol,        // Unicode: for web display
    trendSymbolAscii,   // ASCII: for PDF (WinAnsi safe)
    arrow: trendSymbolAscii, // legacy alias
    direction: p.threeMonthTrend, // legacy alias
    tier: p.tier.name,
    tierThreshold: p.tier.threshold,
    totalEyes: Math.round(p.totalEyes),
    monthsPresent: p.monthsPresent,
    isNewProvider: p.isNewProvider,
    isZeroReferrals: p.isZeroReferrals,
    currentMonthEyes: Math.round(p.currentMonthEyes),
  };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
