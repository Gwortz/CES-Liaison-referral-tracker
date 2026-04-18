import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

      <Section title="Executive Summary">
        <SummaryGrid summary={analysis.summary} />
        <p className="mt-3 text-slate-600 italic">{analysis.summary.overallTrend}</p>
      </Section>

      <Section title="Trailing & Forecast">
        <TrailingForecast summary={analysis.summary} />
      </Section>

      <Section title="SWOT Analysis">
        <div className="grid md:grid-cols-2 gap-4">
          <Quadrant label="Strengths" color="emerald" items={analysis.swot.strengths} />
          <Quadrant label="Weaknesses" color="amber" items={analysis.swot.weaknesses} />
          <Quadrant label="Opportunities" color="sky" items={analysis.swot.opportunities} />
          <Quadrant label="Threats" color="red" items={analysis.swot.threats} />
        </div>
      </Section>

      <Section title="Monthly Action Report">
        <ActionList
          title="Thank List — Strengths"
          color="emerald"
          items={analysis.action.thankList}
        />
        <ActionList
          title="Watch List — Weaknesses"
          color="amber"
          items={analysis.action.watchList}
        />
        <ActionList title="Call List — Threats" color="red" items={analysis.action.callList} />
        <ActionList
          title="Welcome List — Opportunities"
          color="sky"
          items={analysis.action.welcomeList}
        />
      </Section>
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
      sub: `trailing through report month`,
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
  },
  amber: {
    header: 'bg-amber-600',
    border: 'border-amber-200',
    tint: 'bg-amber-50',
  },
  sky: {
    header: 'bg-sky-700',
    border: 'border-sky-200',
    tint: 'bg-sky-50',
  },
  red: {
    header: 'bg-red-700',
    border: 'border-red-200',
    tint: 'bg-red-50',
  },
};

function Quadrant({ label, color, items }) {
  const c = COLOR_CLASSES[color];
  return (
    <div className={`rounded-lg border ${c.border} overflow-hidden`}>
      <div className={`${c.header} text-white font-semibold px-3 py-1.5 text-sm`}>
        {label} ({items.length})
      </div>
      <div className={`${c.tint} p-3 space-y-2`}>
        {!items.length && <p className="text-slate-500 text-sm">None this month.</p>}
        {items.map((p) => (
          <div key={p.provider} className="bg-white rounded-md border border-slate-200 p-2">
            <div className="font-medium text-slate-800">
              {p.provider} <span className="text-slate-500">{p.arrow}</span>
            </div>
            <div className="text-xs text-slate-600">
              3mo avg {avg(p.last3Avg)} · prior-yr avg {avg(p.priorAvg)} · {pct(p.pctChange)} · {p.direction}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionList({ title, color, items }) {
  const c = COLOR_CLASSES[color];
  return (
    <div className="mb-5">
      <h3 className={`font-semibold mb-2 text-slate-800`}>
        <span
          className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${c.header}`}
        ></span>
        {title} ({items.length})
      </h3>
      {!items.length && <p className="text-slate-500 text-sm">None this month.</p>}
      <div className="space-y-2">
        {items.map((p) => (
          <div
            key={p.provider}
            className="bg-white rounded-md border border-slate-200 p-3"
          >
            <div className="font-medium text-slate-800">
              {p.provider} <span className="text-slate-500">{p.arrow}</span>
            </div>
            <div className="text-xs text-slate-500 mb-1">
              3mo avg {avg(p.last3Avg)} · total {whole(p.totalEyes)} eyes · {pct(p.pctChange)}
            </div>
            <div className="text-sm text-slate-700 italic">{p.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
