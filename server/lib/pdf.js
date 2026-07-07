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
      renderSignificantMovers(doc, analysis);
      renderLegend(doc);
      renderExecutiveSummary(doc, analysis);
      renderTrailingForecast(doc, analysis);
      renderRelationshipLists(doc, analysis);
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
    [
      'Statistically significant UP',
      s.sigUpCount != null
        ? `${s.sigUpCount} (+${s.likelyUpCount ?? 0} likely)`
        : '--',
    ],
    [
      'Statistically significant DOWN',
      s.sigDownCount != null
        ? `${s.sigDownCount} (+${s.likelyDownCount ?? 0} likely)`
        : '--',
    ],
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

  doc.moveDown(1);
}

function sigTag(p) {
  if (!p.significance) return '';
  const t = p.significance.tier === 'significant' ? 'SIG' : 'LIKELY';
  return `  [${t} ${p.significance.direction === 'up' ? 'UP' : 'DOWN'}]`;
}

function renderSignificantMovers(doc, analysis) {
  const movers = analysis.significantMovers;
  if (!movers) return;

  sectionTitle(doc, 'Statistically Significant Movers');

  doc
    .font('Helvetica-Oblique')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      `Each provider's most recent 3 months (${movers.windowLabel}) are compared with their own prior ` +
        `12-month baseline (${movers.baselineLabel}), adjusted for practice-wide seasonality, using an ` +
        `overdispersed count model that accounts for each provider's normal volatility. SIGNIFICANT movers ` +
        `survive a 10% false-discovery-rate correction across all ${movers.testedCount} providers tested; ` +
        `LIKELY movers reach p < 0.05 individually. All other movement is within normal month-to-month variation.`
    );
  doc.moveDown(0.5);

  const groups = [
    {
      label: 'Significantly UP -- reinforce and thank',
      items: movers.up,
      color: COLORS.strength,
    },
    {
      label: 'Significantly DOWN -- call list, personal visit or call this week',
      items: movers.down,
      color: COLORS.threat,
    },
  ];

  for (const g of groups) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(g.color)
      .text(`${g.label} (${g.items.length})`);
    if (!g.items.length) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text('None this month.');
      doc.moveDown(0.4);
      continue;
    }
    for (const m of g.items) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
      const tier = m.tier === 'significant' ? 'SIGNIFICANT' : 'LIKELY';
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(`${displayName(m.provider)}  [${tier}]`);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(
          `${m.observed} eyes observed vs ${avg(m.expected)} expected (${m.pctChange > 0 ? '+' : ''}${m.pctChange}%) ` +
            `over ${movers.windowLabel}. Chance this is random variation: ${m.chanceLabel}`
        );
      doc.moveDown(0.15);
    }
    doc.moveDown(0.4);
  }

  doc.moveDown(0.4);
}

function renderLegend(doc) {
  sectionTitle(doc, 'Legend — How to read each provider entry');

  const items = [
    ['3-mo monthly avg', 'Average referrals per month over the most recent 3 months (ending in the report month).'],
    ['prev 3-mo', 'The rolling 3-month window ending one month earlier (e.g. Mar-May for a June report), showing how the rolling average moved since last month. Shows the delta and direction (UP/STABLE/DOWN).'],
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

function renderRelationshipLists(doc, analysis) {
  const lists = analysis.lists;
  if (!lists) return;
  if (doc.y > doc.page.height - 200) doc.addPage();
  sectionTitle(doc, 'Relationship Lists');

  doc
    .font('Helvetica-Oblique')
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      'These lists cover what the statistical test cannot: your biggest relationships (Thank), ' +
        'providers too new to test (Welcome), and providers whose silence has not yet reached ' +
        'statistical significance (Silent).'
    );
  doc.moveDown(0.5);

  const groups = [
    {
      title: 'Thank List (top volume -- keep the relationship warm)',
      color: COLORS.strength,
      items: lists.thankList || [],
    },
    {
      title: 'Welcome List (newly qualifying -- reach out and encourage)',
      color: COLORS.opportunity,
      items: lists.welcomeList || [],
    },
    {
      title: 'Silent List (zero this month, not statistically flagged)',
      color: COLORS.zero,
      items: lists.silentList || [],
    },
  ];

  groups.forEach((list) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();

    doc
      .font('Helvetica-Bold')
      .fillColor(list.color)
      .fontSize(11)
      .text(`${list.title} (${list.items.length})`);

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
          .text(`${displayName(p.provider)}  ${p.trendSymbolAscii || p.arrow}${sigTag(p)}`);
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
