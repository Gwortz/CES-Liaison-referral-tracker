import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SWOT_CRITERIA = {
  strengths:
    'Top-15 providers by total historical eye volume whose 3-mo monthly avg is at least 5 eyes/mo, with neither the 3-mo nor 12-mo trend declining, and not materially below the same 3-month period last year.',
  threats:
    "Material decline: 3-mo monthly avg has dropped vs the prior-year same 3-month period (or vs the 12-mo baseline when no prior-year data) by at least the provider's volume-tier threshold.",
  weaknesses:
    "Softening: 3-mo monthly avg is below the 12-mo monthly avg by at least the provider's tier threshold, or either the 3-mo or 12-mo trend is declining. A seasonal-low override prevents flagging when last year's same 3 months were already a seasonal trough.",
  opportunities:
    'Strictly positive movement: either a newly qualifying provider (did not qualify 6 months ago but does now) with a non-declining 3-mo trend, or an improving provider with a positive change vs prior year and no declining trends.',
  zeroReferrals:
    'Zero eyes this month, but at least one referral in the trailing 12 months. Recent activity makes the silence notable. Always classified here regardless of other criteria.',
};

function pct(n) {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(1)}%`;
}

function avg(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(1);
}

function whole(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(Number(n)).toString();
}

function signed(n) {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${Math.round(n)}`;
}

export default function ReportPreview() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('ces_last_report');
    if (!raw) {
      navigate('/dashboard');
      return;
    }
    setPayload(JSON.parse(raw));
  }, [navigate]);

  if (!payload) return null;

  const { market, analysis } = payload;

  async function download() {
    setErr(null);
    setDownloading(true);
    try {
      const blob = await api.downloadPdf(market, analysis);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CES_${market}_${analysis.reportMonth.year}-${String(
        analysis.reportMonth.month
      ).padStart(2, '0')}_Report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    } finally {
      setDownloading(false);
    }
  }

  const monthLabel = MONTH_LABELS[(analysis.reportMonth.month || 1) - 1];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {market} — {monthLabel} {analysis.reportMonth.year}
          </h1>
          <p className="text-sm text-slate-600">Commonwealth Eye Surgery — Report preview</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/dashboard"
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Back
          </Link>
          <button
            onClick={download}
            disabled={downloading}
            className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:bg-sky-400 text-white font-medium"
          >
            {downloading ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2 mb-4">
          {err}
        </div>
      )}

      <Section title="Legend — How to read each provider entry">
        <Legend />
      </Section>

      <Section title="Executive Summary">
        <SummaryGrid summary={analysis.summary} />
        <p className="mt-3 text-slate-700">
          {analysis.summary.overallAssessment || analysis.summary.overallTrend}
        </p>
        {analysis.summary.contradictingTrendsNote && (
          <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {analysis.summary.contradictingTrendsNote}
          </div>
        )}
        <TopThreePerCategory swot={analysis.swot} />
      </Section>

      <Section title="Trailing & Forecast">
        <TrailingForecast summary={analysis.summary} />
      </Section>

      <Section title="SWOT Analysis (top 15 per category)">
        <div className="space-y-4">
          <Category
            label="Strengths (Top volume, stable or growing)"
            description={SWOT_CRITERIA.strengths}
            color="emerald"
            items={analysis.swot.strengths || []}
          />
          <Category
            label="Threats (Material Decline)"
            description={SWOT_CRITERIA.threats}
            color="red"
            items={analysis.swot.threats || []}
          />
          <Category
            label="Weaknesses (Softening)"
            description={SWOT_CRITERIA.weaknesses}
            color="amber"
            items={analysis.swot.weaknesses || []}
          />
          <Category
            label="Opportunities (Emerging)"
            description={SWOT_CRITERIA.opportunities}
            color="sky"
            items={analysis.swot.opportunities || []}
          />
          <Category
            label="Zero Referrals This Month"
            description={SWOT_CRITERIA.zeroReferrals}
            color="slate"
            items={analysis.swot.zeroReferrals || []}
          />
        </div>
      </Section>

      <Section title="Monthly Action Report (top 15 per list)">
        <ActionList
          title="Call List — Threats (personal visit or call this week)"
          color="red"
          items={analysis.action.callList}
        />
        <ActionList
          title="Watch List — Weaknesses (monitor next month)"
          color="amber"
          items={analysis.action.watchList}
        />
        <ActionList
          title="Welcome List — Opportunities (reach out and encourage)"
          color="sky"
          items={analysis.action.welcomeList}
        />
        <ActionList
          title="Thank List — Strengths (keep the relationship warm)"
          color="emerald"
          items={analysis.action.thankList}
        />
        <ActionList
          title="Zero Referrals List (reach out personally)"
          color="slate"
          items={analysis.action.zeroList || []}
        />
      </Section>
    </div>
  );
}

function Legend() {
  const items = [
    ['3-mo monthly avg', 'Average referrals per month over the most recent 3 months (ending in the report month).'],
    ['prev 3-mo', 'The 3 months immediately before that window, for short-term trend comparison. Shows the delta and direction (UP/STABLE/DOWN).'],
    ['12-mo monthly avg', 'Average referrals per month over the most recent 12 months, excluding any months the provider sent zero referrals.'],
    ['prev 12-mo', 'The 12 months immediately before that window, for longer-term trend comparison.'],
    ['prior-year 3-mo monthly avg', 'Average referrals per month for the same 3 months one year earlier, for year-over-year context.'],
    ['abs change', 'Whole-eye total difference between the current 3-month total and the prior-year same-3-month total (not a monthly average).'],
    ['overall trend [3-mo/12-mo]', 'Combined direction at both resolutions. Each is UP (rose materially), STABLE (within the noise band), or DOWN.'],
    ['Tier', 'Volume tier: HIGH (12-mo avg ≥ 15 eyes/mo), MEDIUM (8–14), STANDARD (4–7), LOW (<4). Higher tiers use larger thresholds before a change is flagged.'],
  ];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
      {items.map(([term, def]) => (
        <div key={term} className="leading-snug">
          <dt className="inline font-semibold text-slate-800">{term}:</dt>{' '}
          <dd className="inline text-slate-600">{def}</dd>
        </div>
      ))}
    </dl>
  );
}

function TopThreePerCategory({ swot }) {
  const top3 = (list) =>
    (list || []).slice(0, 3).map((p) => displayName(p.provider)).join(', ') ||
    'none';
  const rows = [
    ['Top 3 Strengths', top3(swot.strengths), 'text-emerald-700'],
    ['Top 3 Threats', top3(swot.threats), 'text-red-700'],
    ['Top 3 Weaknesses', top3(swot.weaknesses), 'text-amber-700'],
    ['Top 3 Opportunities', top3(swot.opportunities), 'text-sky-700'],
    ['Top 3 Zero Referrals', top3(swot.zeroReferrals), 'text-slate-700'],
  ];
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1 text-sm">
      {rows.map(([label, names, color]) => (
        <div key={label}>
          <span className={`font-semibold ${color}`}>{label}:</span>{' '}
          <span className="text-slate-800">{names}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-200 pb-2 mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TrailingForecast({ summary }) {
  const last3 = summary.last3MonthsTotal ?? 0;
  const prior3 = summary.priorYear3MonthsTotal ?? 0;
  const ytd = summary.ytdTotal ?? 0;
  const predicted = summary.predictedAnnualTotal ?? 0;
  const method = summary.predictionMethod || '';

  const trailingDelta =
    prior3 > 0 ? ((last3 - prior3) / prior3) * 100 : null;

  const cards = [
    {
      label: 'Referrals, last 3 months',
      value: whole(last3),
      sub: 'trailing through report month',
    },
    {
      label: 'Same 3 months, prior year',
      value: whole(prior3),
      sub:
        trailingDelta != null
          ? `${pct(trailingDelta)} vs last 3 months`
          : 'no prior-year data',
    },
    {
      label: 'Year-to-date referrals',
      value: whole(ytd),
      sub: 'Jan through report month',
    },
    {
      label: 'Predicted annual total',
      value: whole(predicted),
      sub: method,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {c.label}
          </div>
          <div className="text-2xl font-semibold text-slate-800">{c.value}</div>
          <div className="text-xs text-slate-500 mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function SummaryGrid({ summary }) {
  const cells = [
    { label: 'This month', value: summary.thisMonthTotal },
    { label: 'Last month', value: summary.lastMonthTotal },
    { label: 'Same month last year', value: summary.sameMonthPriorYearTotal },
    { label: 'MoM change', value: pct(summary.momPct) },
    { label: 'YoY change', value: pct(summary.yoyPct) },
    { label: 'Active providers', value: summary.activeProvidersThisMonth },
    { label: 'Qualifying providers', value: summary.qualifyingCount },
    { label: 'Zero-referral providers', value: summary.zeroReferralCount ?? 0 },
    { label: 'Call List count', value: summary.callListCount ?? 0 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className="bg-white border border-slate-200 rounded-lg p-3"
        >
          <div className="text-xs uppercase tracking-wide text-slate-500">{c.label}</div>
          <div className="text-xl font-semibold text-slate-800">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

const COLOR_CLASSES = {
  emerald: {
    header: 'bg-emerald-700',
    border: 'border-emerald-200',
    tint: 'bg-emerald-50',
    dot: 'bg-emerald-700',
  },
  amber: {
    header: 'bg-amber-600',
    border: 'border-amber-200',
    tint: 'bg-amber-50',
    dot: 'bg-amber-600',
  },
  sky: {
    header: 'bg-sky-700',
    border: 'border-sky-200',
    tint: 'bg-sky-50',
    dot: 'bg-sky-700',
  },
  red: {
    header: 'bg-red-700',
    border: 'border-red-200',
    tint: 'bg-red-50',
    dot: 'bg-red-700',
  },
  slate: {
    header: 'bg-slate-600',
    border: 'border-slate-200',
    tint: 'bg-slate-50',
    dot: 'bg-slate-600',
  },
};

function signedDec(n) {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${Number(n).toFixed(1)}`;
}

function displayName(name) {
  return String(name || '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

function ProviderMetaLine({ p }) {
  return (
    <div className="text-xs text-slate-700 mt-1 space-y-0.5">
      <div>
        <span className="text-slate-500">3-mo monthly avg:</span>{' '}
        <b>{avg(p.last3Avg)}</b> eyes/mo
        {p.prev3Avg != null && (
          <span className="text-slate-500">
            {' '}(<span className="font-mono">{p.delta3Symbol}</span>{' '}
            {signedDec(p.delta3)} vs prev 3-mo <b>{avg(p.prev3Avg)}</b>
            {p.prev3PeriodLabel ? `, ${p.prev3PeriodLabel}` : ''})
          </span>
        )}
        <span className="mx-2 text-slate-300">|</span>
        <span className="text-slate-500">12-mo monthly avg:</span>{' '}
        <b>{avg(p.twelveMoAvg)}</b> eyes/mo
        {p.prev12Avg != null && (
          <span className="text-slate-500">
            {' '}(<span className="font-mono">{p.delta12Symbol}</span>{' '}
            {signedDec(p.delta12)} vs prev 12-mo <b>{avg(p.prev12Avg)}</b>
            {p.prev12PeriodLabel ? `, ${p.prev12PeriodLabel}` : ''})
          </span>
        )}
      </div>
      <div>
        {p.priorAvg != null ? (
          <span>
            <span className="text-slate-500">Prior-year 3-mo monthly avg:</span>{' '}
            <b>{avg(p.priorAvg)}</b> eyes/mo ({p.priorPeriodLabel})
          </span>
        ) : (
          <span className="italic text-slate-500">No prior-year data</span>
        )}
        {p.absoluteChange != null && (
          <>
            <span className="mx-2 text-slate-300">|</span>
            <span>
              abs change <b>{signed(p.absoluteChange)}</b> eyes
            </span>
          </>
        )}
        <span className="mx-2 text-slate-300">|</span>
        <span>
          overall trend (3-mo/12-mo):{' '}
          <b className="font-mono">{p.trendSymbol || p.arrow}</b>
        </span>
      </div>
    </div>
  );
}

function Category({ label, description, color, items }) {
  const c = COLOR_CLASSES[color];
  const MAX = 15;
  const shown = (items || []).slice(0, MAX);
  const countLabel =
    (items || []).length > shown.length
      ? `top ${shown.length} of ${items.length}`
      : `${(items || []).length}`;
  return (
    <div className={`rounded-lg border ${c.border} overflow-hidden`}>
      <div className={`${c.header} text-white font-semibold px-3 py-1.5 text-sm`}>
        {label} ({countLabel})
      </div>
      <div className={`${c.tint} p-3 space-y-2`}>
        {description && (
          <p className="text-xs italic text-slate-600 leading-snug">
            {description}
          </p>
        )}
        {!shown.length && <p className="text-slate-500 text-sm">None this month.</p>}
        {shown.map((p) => (
          <div key={p.provider} className="bg-white rounded-md border border-slate-200 p-2">
            <div className="font-medium text-slate-800">
              {displayName(p.provider)}{' '}
              <span className="text-slate-500 font-mono">{p.trendSymbol || p.arrow}</span>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                {p.tier} tier
              </span>
            </div>
            <ProviderMetaLine p={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionList({ title, color, items }) {
  const c = COLOR_CLASSES[color];
  const MAX = 15;
  const shown = (items || []).slice(0, MAX);
  const countLabel =
    (items || []).length > shown.length
      ? `top ${shown.length} of ${items.length}`
      : `${(items || []).length}`;
  return (
    <div className="mb-5">
      <h3 className="font-semibold mb-2 text-slate-800">
        <span
          className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${c.dot}`}
        ></span>
        {title} ({countLabel})
      </h3>
      {!shown.length && <p className="text-slate-500 text-sm">None this month.</p>}
      <div className="space-y-2">
        {shown.map((p) => (
          <div
            key={p.provider}
            className="bg-white rounded-md border border-slate-200 p-3"
          >
            <div className="font-medium text-slate-800">
              {displayName(p.provider)}{' '}
              <span className="text-slate-500 font-mono">{p.trendSymbol || p.arrow}</span>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                {p.tier} tier
              </span>
            </div>
            <ProviderMetaLine p={p} />
            <div className="text-sm text-slate-700 italic mt-1">{p.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
