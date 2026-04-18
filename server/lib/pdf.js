import PDFDocument from 'pdfkit';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const COLORS = {
  brand: '#0B4D6B',
  accent: '#1E88C4',
  text: '#1F2937',
  muted: '#6B7280',
  zero: '#4B5563',
  strength: '#2F855A',
  weakness: '#B45309',
  opportunity: '#2B6CB0',
  threat: '#9B2C2C',
  border: '#E5E7EB',
};

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '--';
  return typeof n === 'number' ? Math.round(n).toLocaleString() : String(n);
}

function avg(n) {
  if (n == null || Number.isNaN(n)) return '--';
  return typeof n === 'number' ? n.toFixed(1) : String(n);
}

function whole(n) {
  if (n == null || Number.isNaN(n)) return '--';
  return typeof n === 'number' ? Math.round(n).toString() : String(n);
}

function pct(n) {
  if (n == null) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function signed(n) {
  if (n == null) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Math.round(n)}`;
}

function displayName(name) {
  return String(name || '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

export function generateReport({ market, analysis }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderHeader(doc, market, analysis);
      renderLegend(doc);
      renderExecutiveSummary(doc, analysis);
      renderTrailingForecast(doc, analysis);
      renderSWOT(doc, analysis);
      renderActionReport(doc, analysis);
      renderFooter(doc);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function renderHeader(doc, market, analysis) {
  const { year, month } = analysis.reportMonth || { year: '', month: 1 };
  const monthLabel = MONTH_LABELS[(month || 1) - 1];

  doc
    .fillColor(COLORS.brand)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('Commonwealth Eye Surgery', { align: 'left' });

  doc
    .fillColor(COLORS.accent)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Liaison Referral Tracker', { align: 'left' });

  doc
    .fillColor(COLORS.text)
    .font('Helvetica')
    .fontSize(12)
    .text(`${market} -- ${monthLabel} ${year}`, { align: 'left' });

  doc.moveDown(0.5);
  drawHR(doc);
  doc.moveDown(0.5);
}

function renderExecutiveSummary(doc, analysis) {
  sectionTitle(doc, 'Executive Summary');

  const s = analysis.summary;
  const rows = [
    ['Total referrals this month', fmt(s.thisMonthTotal)],
    ['Total referrals last month', fmt(s.lastMonthTotal)],
    ['Total referrals same month last year', fmt(s.sameMonthPriorYearTotal)],
    ['Month-over-month change', pct(s.momPct)],
    ['Year-over-year change', pct(s.yoyPct)],
    ['Active referring providers this month', fmt(s.activeProvidersThisMonth)],
    ['Qualifying providers in analysis', fmt(s.qualifyingCount)],
    ['Providers with zero referrals this month', fmt(s.zeroReferralCount ?? 0)],
    ['Providers on Call List (material decline)', fmt(s.callListCount ?? 0)],
  ];

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  rows.forEach(([k, v]) => {
    doc.text(`${k}: `, { continued: true }).font('Helvetica-Bold').text(v).font('Helvetica');
  });

  doc.moveDown(0.5);
  doc
    .font('Helvetica-Oblique')
    .fillColor(COLORS.muted)
    .fontSize(10)
    .text(s.overallAssessment || s.overallTrend, { align: 'left' });

  if (s.contradictingTrendsNote) {
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fillColor(COLORS.accent)
      .fontSize(10)
      .text(s.contradictingTrendsNote, { align: 'left' });
  }

  // Top 3 per category
  renderTopThreePerCategory(doc, analysis);

  doc.moveDown(1);
}

function renderTopThreePerCategory(doc, analysis) {
  const swot = analysis.swot || {};
  const top3 = (list) =>
    (list || [])
      .slice(0, 3)
      .map((p) => displayName(p.provider))
      .join(', ') || 'none';

  const rows = [
    ['Top 3 Strengths', top3(swot.strengths), COLORS.strength],
    ['Top 3 Threats', top3(swot.threats), COLORS.threat],
    ['Top 3 Weaknesses', top3(swot.weaknesses), COLORS.weakness],
    ['Top 3 Opportunities', top3(swot.opportunities), COLORS.opportunity],
    ['Top 3 Zero Referrals', top3(swot.zeroReferrals), COLORS.zero],
  ];

  doc.moveDown(0.4);
  rows.forEach(([label, names, color]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(color)
      .text(`${label}: `, { continued: true })
      .font('Helvetica')
      .fillColor(COLORS.text)
      .text(names);
  });
}

function renderLegend(doc) {
  sectionTitle(doc, 'Legend — How to read each provider entry');

  const items = [
    ['3-mo monthly avg', 'Average referrals per month over the most recent 3 months (ending in the report month).'],
    ['prev 3-mo', 'The 3 months immediately before that window, for short-term trend comparison. Shows the delta and direction (UP/STABLE/DOWN).'],
    ['12-mo monthly avg', 'Average referrals per month over the most recent 12 months, excluding any months the provider sent zero referrals.'],
    ['prev 12-mo', 'The 12 months immediately before that window, for longer-term trend comparison.'],
    ['prior-year 3-mo monthly avg', 'Average referrals per month for the same 3 months one year earlier, for year-over-year context.'],
    ['abs change', 'Whole-eye total difference between the current 3-month total and the prior-year same-3-month total (not a monthly average).'],
    ['overall trend [3-mo/12-mo]', 'Combined direction at both resolutions. Each is UP (rose materially), STABLE (within the noise band), or DOWN.'],
    ['Tier', 'Volume tier: HIGH (12-mo avg >= 15 eyes/mo), MEDIUM (8-14), STANDARD (4-7), LOW (<4). Higher tiers use larger thresholds before a change is flagged.'],
  ];

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);
  items.forEach(([term, def]) => {
    doc
      .font('Helvetica-Bold')
      .text(`${term}: `, { continued: true })
      .font('Helvetica')
      .text(def);
  });

  doc.moveDown(0.8);
}

function renderTrailingForecast(doc, analysis) {
  sectionTitle(doc, 'Trailing & Forecast');
  const s = analysis.summary;
  const last3 = s.last3MonthsTotal ?? 0;
  const prior3 = s.priorYear3MonthsTotal ?? 0;
  const trailingDelta =
    prior3 > 0 ? ((last3 - prior3) / prior3) * 100 : null;

  const rows = [
    ['Referrals, last 3 months', fmt(last3)],
    [
      'Same 3 months, prior year',
      trailingDelta != null
        ? `${fmt(prior3)}  (${pct(trailingDelta)} vs last 3 months)`
        : `${fmt(prior3)}  (no prior-year data)`,
    ],
    ['Year-to-date referrals (Jan through report month)', fmt(s.ytdTotal ?? 0)],
    [
      'Predicted annual total',
      `${fmt(s.predictedAnnualTotal ?? 0)}  (${s.predictionMethod || 'n/a'})`,
    ],
  ];

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  rows.forEach(([k, v]) => {
    doc
      .text(`${k}: `, { continued: true })
      .font('Helvetica-Bold')
      .text(v)
      .font('Helvetica');
  });
  doc.moveDown(1);
}

function providerLines(p) {
  // Returns an array of strings — rendered as two lines in the PDF.
  // Every number is a monthly average in eyes/month.
  const d3 = p.delta3 == null ? '' : ` (${signedDec(p.delta3)} vs prev 3-mo ${avg(p.prev3Avg)}${p.prev3PeriodLabel ? ', ' + p.prev3PeriodLabel : ''}) ${p.delta3SymbolAscii || ''}`;
  const d12 = p.delta12 == null ? '' : ` (${signedDec(p.delta12)} vs prev 12-mo ${avg(p.prev12Avg)}${p.prev12PeriodLabel ? ', ' + p.prev12PeriodLabel : ''}) ${p.delta12SymbolAscii || ''}`;

  const line1 =
    `3-mo monthly avg: ${avg(p.last3Avg)} eyes/mo${d3.trim() ? d3 : ''}` +
    `  |  12-mo monthly avg: ${avg(p.twelveMoAvg)} eyes/mo${d12.trim() ? d12 : ''}`;

  const line2parts = [];
  if (p.priorAvg != null) {
    line2parts.push(
      `Prior-year 3-mo monthly avg: ${avg(p.priorAvg)} eyes/mo (${p.priorPeriodLabel})`
    );
  } else {
    line2parts.push('No prior-year data');
  }
  if (p.absoluteChange != null) {
    line2parts.push(`abs change ${signed(p.absoluteChange)} eyes`);
  }
  line2parts.push(`overall trend (3-mo/12-mo): ${p.trendSymbolAscii || p.arrow}`);

  return [line1, line2parts.join('  |  ')];
}

function signedDec(n) {
  if (n == null) return '--';
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(1)}`;
}

function renderSWOT(doc, analysis) {
  sectionTitle(doc, 'SWOT Analysis');

  const swot = analysis.swot;
  const MAX = 15;
  // Strengths/Threats/Weaknesses/Opportunities first (capped at top 15 by the
  // strongest trend within each category), Zero Referrals last.
  const sections = [
    {
      label: 'Strengths (Top volume, stable or growing)',
      color: COLORS.strength,
      items: (swot.strengths || []).slice(0, MAX),
      total: (swot.strengths || []).length,
    },
    {
      label: 'Threats (Material decline)',
      color: COLORS.threat,
      items: (swot.threats || []).slice(0, MAX),
      total: (swot.threats || []).length,
    },
    {
      label: 'Weaknesses (Softening)',
      color: COLORS.weakness,
      items: (swot.weaknesses || []).slice(0, MAX),
      total: (swot.weaknesses || []).length,
    },
    {
      label: 'Opportunities (Emerging)',
      color: COLORS.opportunity,
      items: (swot.opportunities || []).slice(0, MAX),
      total: (swot.opportunities || []).length,
    },
    {
      label: 'Zero Referrals This Month',
      color: COLORS.zero,
      items: (swot.zeroReferrals || []).slice(0, MAX),
      total: (swot.zeroReferrals || []).length,
    },
  ];

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  sections.forEach((q) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
    const x = doc.page.margins.left;
    const y = doc.y;

    doc.save();
    doc.rect(x, y, pageWidth, 16).fill(q.color);
    const total = q.total ?? q.items.length;
    const shown = q.items.length;
    const countLabel = total > shown ? `(top ${shown} of ${total})` : `(${total})`;
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`${q.label} ${countLabel}`, x + 8, y + 3, {
        width: pageWidth - 16,
      });
    doc.restore();

    doc.y = y + 20;

    if (!q.items.length) {
      doc
        .fillColor(COLORS.muted)
        .font('Helvetica-Oblique')
        .fontSize(9)
        .text('None this month.', x + 8);
      doc.moveDown(0.5);
      return;
    }

    q.items.forEach((p) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
      doc
        .font('Helvetica-Bold')
        .fillColor(COLORS.text)
        .fontSize(10)
        .text(`${displayName(p.provider)}  ${p.trendSymbolAscii || p.arrow}`, x + 8);
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
      for (const line of providerLines(p)) {
        doc.text(line, x + 8);
      }
      doc.moveDown(0.15);
    });
    doc.moveDown(0.4);
  });
}

function renderActionReport(doc, analysis) {
  if (doc.y > doc.page.height - 200) doc.addPage();
  sectionTitle(doc, 'Monthly Action Report');

  const MAX = 15;
  const cap = (arr) => (arr || []).slice(0, MAX);
  const rawLists = [
    { title: 'Call List (Threats -- personal visit or call this week)', color: COLORS.threat, items: cap(analysis.action.callList), total: (analysis.action.callList || []).length },
    { title: 'Watch List (Weaknesses -- monitor next month)', color: COLORS.weakness, items: cap(analysis.action.watchList), total: (analysis.action.watchList || []).length },
    { title: 'Welcome List (Opportunities -- reach out and encourage)', color: COLORS.opportunity, items: cap(analysis.action.welcomeList), total: (analysis.action.welcomeList || []).length },
    { title: 'Thank List (Strengths -- keep the relationship warm)', color: COLORS.strength, items: cap(analysis.action.thankList), total: (analysis.action.thankList || []).length },
    { title: 'Zero Referrals List (reach out personally)', color: COLORS.zero, items: cap(analysis.action.zeroList), total: (analysis.action.zeroList || []).length },
  ];

  rawLists.forEach((list) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();

    const countSuffix =
      list.total > list.items.length
        ? ` (top ${list.items.length} of ${list.total})`
        : ` (${list.total})`;
    doc
      .font('Helvetica-Bold')
      .fillColor(list.color)
      .fontSize(11)
      .text(`${list.title}${countSuffix}`);

    doc.moveDown(0.2);

    if (!list.items.length) {
      doc
        .font('Helvetica-Oblique')
        .fillColor(COLORS.muted)
        .fontSize(10)
        .text('No providers on this list.');
    } else {
      list.items.forEach((p) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
        doc
          .font('Helvetica-Bold')
          .fillColor(COLORS.text)
          .fontSize(10)
          .text(`${displayName(p.provider)}  ${p.trendSymbolAscii || p.arrow}`);
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
        for (const line of providerLines(p)) {
          doc.text(line);
        }
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor(COLORS.text)
          .text(p.reason);
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(0.5);
  });
}

function renderFooter(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fillColor(COLORS.muted)
      .fontSize(8)
      .text(
        `Generated ${new Date().toLocaleDateString()} | Commonwealth Eye Surgery -- Confidential`,
        doc.page.margins.left,
        doc.page.height - 30,
        { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
      );
  }
}

function sectionTitle(doc, text) {
  doc
    .font('Helvetica-Bold')
    .fillColor(COLORS.brand)
    .fontSize(13)
    .text(text);
  drawHR(doc, COLORS.border);
  doc.moveDown(0.3);
}

function drawHR(doc, color = COLORS.border) {
  const y = doc.y;
  doc
    .save()
    .strokeColor(color)
    .lineWidth(0.75)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke()
    .restore();
  doc.moveDown(0.2);
}
