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

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

function periodLabel(startK, endK) {
  const s = fromMonthKey(startK);
  const e = fromMonthKey(endK);
  if (s.year === e.year) {
    return `${MONTH_SHORT[s.month - 1]}-${MONTH_SHORT[e.month - 1]} ${e.year}`;
  }
  return `${MONTH_SHORT[s.month - 1]} ${s.year}-${MONTH_SHORT[e.month - 1]} ${e.year}`;
}

function priorYearPeriodLabel(rmKey) {
  // Prior-year same 3 months ending rmKey-12
  return periodLabel(rmKey - 14, rmKey - 12);
}

function prev3PeriodLabel(rmKey) {
  // Preceding 3-month window: [rmKey-5, rmKey-4, rmKey-3]
  return periodLabel(rmKey - 5, rmKey - 3);
}

function prev12PeriodLabel(rmKey) {
  // Preceding 12-month window: [rmKey-23 .. rmKey-12]
  return periodLabel(rmKey - 23, rmKey - 12);
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
 * 3-month rolling average across [endKey-2, endKey-1, endKey].
 * Missing months: if the provider has any activity in the 6 months immediately
 * preceding this window (endKey-8..endKey-3), treat the missing month as 0
 * (they went dormant). Otherwise exclude that slot (they weren't around yet).
 * Returns { avg, sufficient, valuesForTrend }.
 */
function threeMonthWindowAt(byMonth, endKey) {
  const slots = [endKey - 2, endKey - 1, endKey];
  const values = [];
  const valuesForTrend = [];
  for (const k of slots) {
    if (byMonth.has(k)) {
      const v = byMonth.get(k) || 0;
      values.push(v);
      valuesForTrend.push(v);
    } else {
      let priorActivity = false;
      for (let j = endKey - 8; j <= endKey - 3; j++) {
        if ((byMonth.get(j) || 0) > 0) { priorActivity = true; break; }
      }
      if (priorActivity) {
        values.push(0);
        valuesForTrend.push(0);
      } else {
        valuesForTrend.push(null);
      }
    }
  }
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const sufficient = valuesForTrend.filter((v) => v !== null).length >= 2;
  return { avg, sufficient, valuesForTrend };
}

// Back-compat wrapper for current-window call sites.
function threeMonthWindow(byMonth, rmKey) {
  return threeMonthWindowAt(byMonth, rmKey);
}

/**
 * 12-month rolling average across [endKey-11..endKey], averaging ONLY months
 * where eyes > 0 (excluding zero/missing months). Returns 0 when no non-zero
 * months exist in the window.
 */
function twelveMonthAverageAt(byMonth, endKey) {
  const nonZero = [];
  for (let k = endKey - 11; k <= endKey; k++) {
    const v = byMonth.get(k) || 0;
    if (v > 0) nonZero.push(v);
  }
  if (!nonZero.length) return 0;
  return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
}

function twelveMonthAverage(byMonth, rmKey) {
  return twelveMonthAverageAt(byMonth, rmKey);
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

// Trend labels — plain readable text (Option B). PDFKit's default Helvetica
// uses WinAnsi encoding and cannot render Unicode arrows reliably, so we use
// the same bracketed labels in both PDF and web outputs.
const TREND_LABEL = {
  increasing: 'UP',
  declining: 'DOWN',
  flat: 'STABLE',
  insufficient: 'UNKNOWN',
};

function combinedSymbol(t3, t12) {
  const a = TREND_LABEL[t3] || TREND_LABEL.insufficient;
  const b = TREND_LABEL[t12] || TREND_LABEL.insufficient;
  return `[${a}/${b}]`;
}

function singleSymbol(t) {
  return `[${TREND_LABEL[t] || TREND_LABEL.insufficient}]`;
}

export function trendArrow(trend) {
  return singleSymbol(trend);
}

export function analyze(entries) {
  if (!entries.length) return { empty: true };

  const reportMonth = determineReportMonth(entries);
  const { year: ry, month: rm } = reportMonth;
  const rmKey = monthKey(ry, rm);
  const priorPeriodLabel = priorYearPeriodLabel(rmKey);
  const prev3Period = prev3PeriodLabel(rmKey);
  const prev12Period = prev12PeriodLabel(rmKey);
  const labels = {
    priorPeriodLabel,
    prev3PeriodLabel: prev3Period,
    prev12PeriodLabel: prev12Period,
  };

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
    // Immediately-preceding rolling windows, for trend context
    const { avg: prev3Avg } = threeMonthWindowAt(byMonth, rmKey - 3);
    const prev12Avg = twelveMonthAverageAt(byMonth, rmKey - 12);
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
      prev3Avg,
      prev12Avg,
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

  // Compute top-15 by total historical referral volume BEFORE the SWOT loop.
  // This ranking is fixed and must drive Strengths selection.
  const topByVolume = Array.from(qualifying.values()).sort(
    (a, b) => b.totalEyes - a.totalEyes
  );
  const top15 = new Set(topByVolume.slice(0, 15).map((p) => p.provider));

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

    // 2) Strengths — top-15 by total historical volume, non-declining at
    //    both resolutions, and still producing meaningful volume (>=5/mo).
    const isStrength =
      top15.has(p.provider) &&
      p.threeMonthTrend !== 'declining' &&
      p.twelveMonthTrend !== 'declining' &&
      p.last3Avg >= 5;
    if (isStrength) {
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

    // 4) Weaknesses — softening, below 12mo baseline or declining trend.
    //    Seasonal-low override: when the prior-year same 3-mo window was
    //    seasonally low (below the 12-mo baseline), a current drop vs the
    //    12-mo baseline may simply be the same seasonal pattern repeating.
    //    In that case only, we demand a real drop vs the prior-year seasonal
    //    norm before calling it a weakness.
    //    We ONLY relax the `belowBaseline` trigger this way. A genuine 3-mo
    //    or 12-mo declining trend is a real signal and must never be
    //    explained away by a weak prior year (e.g. Kevin Stallard: 3-mo avg
    //    fell from 19 to 13.3 eyes/mo with a [13, 20, 7] declining window;
    //    his prior-year Jan-Mar being slightly below baseline should not
    //    silence that).
    const belowBaseline = (p.twelveMoAvg - p.last3Avg) >= p.tier.threshold;
    const trendingDown =
      p.threeMonthTrend === 'declining' || p.twelveMonthTrend === 'declining';
    let isWeakness = belowBaseline || trendingDown;
    if (
      isWeakness &&
      !trendingDown &&
      p.priorAvg != null &&
      p.priorAvg < p.twelveMoAvg
    ) {
      isWeakness = (p.priorAvg - p.last3Avg) >= p.tier.threshold;
    }
    if (isWeakness) {
      weaknesses.push(p);
      continue;
    }

    // 5) Opportunities — strict positive criteria only.
    //    Hard exclusions first:
    if (p.absoluteChange != null && p.absoluteChange < 0) continue;
    if (p.threeMonthTrend === 'declining') continue;
    if (p.twelveMonthTrend === 'declining') continue;

    const pathNewQualifier =
      p.isNewProvider && p.threeMonthTrend !== 'declining';
    const pathImproving =
      p.absoluteChange != null &&
      p.absoluteChange > 0 &&
      p.threeMonthTrend !== 'declining' &&
      p.twelveMonthTrend !== 'declining';

    if (pathNewQualifier || pathImproving) {
      opportunities.push(p);
      continue;
    }
  }

  // Sort strategies
  zeroReferrals.sort((a, b) => b.twelveMoAvg - a.twelveMoAvg);
  // Strengths: rank by top-15 historical volume order (Stallard first, etc.)
  const volumeRank = new Map(topByVolume.map((p, i) => [p.provider, i]));
  strengths.sort(
    (a, b) => (volumeRank.get(a.provider) ?? 9999) - (volumeRank.get(b.provider) ?? 9999)
  );
  // Threats: rank by absoluteChange ascending (most negative first)
  threats.sort((a, b) => {
    const av = a.absoluteChange ?? (a.last3Avg - a.twelveMoAvg) * 3;
    const bv = b.absoluteChange ?? (b.last3Avg - b.twelveMoAvg) * 3;
    return av - bv;
  });
  weaknesses.sort((a, b) => (a.last3Avg - a.twelveMoAvg) - (b.last3Avg - b.twelveMoAvg));
  // Opportunities: rank by absoluteChange descending (biggest positive first),
  // new qualifiers (absoluteChange=null) last.
  opportunities.sort((a, b) => {
    const av = a.absoluteChange ?? -1;
    const bv = b.absoluteChange ?? -1;
    return bv - av;
  });

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

  const trailing3YoyPct =
    priorYear3MonthsTotal > 0
      ? ((last3MonthsTotal - priorYear3MonthsTotal) / priorYear3MonthsTotal) * 100
      : null;
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

  // Contradicting-trends note: only when single-month YoY and trailing 3-month
  // YoY point in opposite directions (each with >1% magnitude).
  const contradictingTrendsNote = buildContradictingTrendsNote({
    yoyPct,
    trailing3YoyPct,
    reportMonthName: MONTH_FULL[rm - 1],
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

  // Reason text per bucket — plain ASCII, no Unicode. All averages are eyes/month.
  const reasonFor = (p, type) => {
    const tierName = p.tier.name;
    const last3 = p.last3Avg.toFixed(1);
    const twelve = p.twelveMoAvg.toFixed(1);
    const prior = p.priorAvg == null ? null : p.priorAvg.toFixed(1);
    switch (type) {
      case 'strength':
        return `Top-15 historical volume (${Math.round(p.totalEyes)} total eyes). 3-mo monthly avg ${last3} eyes/mo, 12-mo monthly avg ${twelve} eyes/mo, both trends stable or growing -- thank and keep engaged.`;
      case 'threat': {
        if (prior != null && p.absoluteChange != null) {
          return `Material decline: 3-mo monthly avg ${last3} eyes/mo vs prior-year ${prior} eyes/mo for ${priorPeriodLabel} (${tierName} tier). Absolute change ${p.absoluteChange} eyes -- call immediately.`;
        }
        return `Material decline: 3-mo monthly avg ${last3} eyes/mo vs 12-mo monthly avg ${twelve} eyes/mo (${tierName} tier, no prior year data) -- call immediately.`;
      }
      case 'weakness': {
        if (prior != null) {
          return `Softening: 3-mo monthly avg ${last3} eyes/mo vs 12-mo monthly avg ${twelve} eyes/mo, prior-year ${prior} eyes/mo (${tierName} tier) -- watch next month.`;
        }
        return `Softening: 3-mo monthly avg ${last3} eyes/mo vs 12-mo monthly avg ${twelve} eyes/mo (${tierName} tier, no prior year data) -- watch next month.`;
      }
      case 'opportunity':
        if (p.isNewProvider) {
          return `Newly qualifying provider (3-mo monthly avg ${last3} eyes/mo, 12-mo monthly avg ${twelve} eyes/mo) -- welcome and encourage.`;
        }
        return `Improving: 3-mo monthly avg ${last3} eyes/mo vs 12-mo monthly avg ${twelve} eyes/mo (${tierName} tier) -- reinforce the relationship.`;
      case 'zero': {
        return `No referrals this month; 12-mo monthly avg was ${twelve} eyes/mo (${tierName} tier) -- personal outreach needed.`;
      }
      default:
        return '';
    }
  };

  const decorate = (p, type) => {
    const e = enrich(p, labels);
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
      trailing3YoyPct,
      activeProvidersThisMonth,
      qualifyingCount: qualifying.size,
      zeroReferralCount: zeroReferrals.length,
      callListCount: threats.length,
      overallTrend,
      overallAssessment,
      contradictingTrendsNote,
      last3MonthsTotal: Math.round(last3MonthsTotal),
      priorYear3MonthsTotal: Math.round(priorYear3MonthsTotal),
      ytdTotal: Math.round(ytdTotal),
      predictedAnnualTotal: Math.round(predictedAnnualTotal),
      predictionMethod,
      priorPeriodLabel,
      prev3PeriodLabel: prev3Period,
      prev12PeriodLabel: prev12Period,
    },
    swot: {
      zeroReferrals: zeroReferrals.map((p) => enrich(p, labels)),
      strengths: strengths.map((p) => enrich(p, labels)),
      threats: threats.map((p) => enrich(p, labels)),
      weaknesses: weaknesses.map((p) => enrich(p, labels)),
      opportunities: opportunities.map((p) => enrich(p, labels)),
    },
    action,
  };
}

function buildContradictingTrendsNote({ yoyPct, trailing3YoyPct, reportMonthName }) {
  if (yoyPct == null || trailing3YoyPct == null) return null;
  const THR = 1; // %-point threshold to count either direction as material
  if (Math.abs(yoyPct) <= THR || Math.abs(trailing3YoyPct) <= THR) return null;
  // Opposite signs only
  if ((yoyPct > 0) === (trailing3YoyPct > 0)) return null;

  const monthSign = yoyPct > 0 ? '+' : '-';
  const monthAbs = Math.abs(yoyPct).toFixed(1);
  const trailDir = trailing3YoyPct > 0 ? 'up' : 'down';
  const trailAbs = Math.abs(trailing3YoyPct).toFixed(1);
  const tone = yoyPct > 0 ? 'strong' : 'soft';
  const recovery =
    yoyPct > 0
      ? `${reportMonthName} may be partially recovering from softer prior months rather than representing a sustained trend change`
      : `${reportMonthName} may reflect a temporary dip rather than a sustained reversal of the positive trailing trend`;

  return `Note: The ${tone} ${reportMonthName} performance (${monthSign}${monthAbs}% vs last year) contrasts with the trailing 3-month period which is ${trailDir} ${trailAbs}% vs the same period last year. This suggests ${recovery}. Monitor over the next 2-3 months to confirm direction.`;
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

  return `Overall referrals are ${momText} and ${yoyText}. ${counts.strengths} top-volume provider(s) are stable or growing, ${counts.threats} show material decline, ${counts.weaknesses} are softening, ${counts.opportunities} are emerging opportunities, and ${counts.zeroReferrals} sent zero this month. Recommendation: ${tone}.`;
}

function enrich(p, labels) {
  // Accept either the legacy (string) or new (object) form
  const lbls =
    typeof labels === 'string'
      ? { priorPeriodLabel: labels, prev3PeriodLabel: '', prev12PeriodLabel: '' }
      : labels || {};
  const trendLabel = combinedSymbol(p.threeMonthTrend, p.twelveMonthTrend);

  // Per-resolution deltas: current rolling avg vs immediately-preceding rolling avg.
  // Threshold uses the tier's eyes-per-month sensitivity.
  const tierThr = p.tier.threshold;
  const delta3 = p.last3Avg - p.prev3Avg;
  const delta12 = p.twelveMoAvg - p.prev12Avg;
  const bucket = (d) => (d >= tierThr ? 'increasing' : d <= -tierThr ? 'declining' : 'flat');
  const d3Bucket = bucket(delta3);
  const d12Bucket = bucket(delta12);
  const d3Label = singleSymbol(d3Bucket);
  const d12Label = singleSymbol(d12Bucket);

  return {
    provider: p.provider,
    // Current rolling monthly averages (eyes/month)
    last3Avg: round1(p.last3Avg),
    twelveMoAvg: round1(p.twelveMoAvg),
    // Immediately-preceding rolling monthly averages (eyes/month)
    prev3Avg: round1(p.prev3Avg),
    prev12Avg: round1(p.prev12Avg),
    prev3PeriodLabel: lbls.prev3PeriodLabel || '',
    prev12PeriodLabel: lbls.prev12PeriodLabel || '',
    // Per-resolution deltas and arrows
    delta3: round1(delta3),
    delta12: round1(delta12),
    delta3Symbol: d3Label,
    delta3SymbolAscii: d3Label,
    delta12Symbol: d12Label,
    delta12SymbolAscii: d12Label,
    // Prior-year same 3-month comparison (nullable)
    priorAvg: p.priorAvg == null ? null : round1(p.priorAvg),
    priorPeriodLabel: p.priorAvg == null ? 'No prior year data' : (lbls.priorPeriodLabel || ''),
    absoluteChange: p.absoluteChange == null ? null : Math.round(p.absoluteChange),
    pctChange: p.pctChange == null ? null : round1(p.pctChange),
    // Dual overall trend
    threeMonthTrend: p.threeMonthTrend,
    twelveMonthTrend: p.twelveMonthTrend,
    trendSymbol: trendLabel,        // same bracketed label in web and PDF
    trendSymbolAscii: trendLabel,   // same bracketed label in web and PDF
    arrow: trendLabel,              // legacy alias
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
