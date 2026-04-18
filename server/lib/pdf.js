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

export function generateReport({ market, analysis }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      renderHeader(doc, market, analysis);
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

  doc.moveDown(1);
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

function providerLine(p) {
  // "3mo X.X | 12mo Y.Y | prior-yr Z.Z for Oct-Dec 2024 | abs +N | trend ^^"
  const segs = [
    `3mo ${avg(p.last3Avg)}`,
    `12mo ${avg(p.twelveMoAvg)}`,
  ];
  if (p.priorAvg != null) {
    segs.push(`prior-yr ${avg(p.priorAvg)} for ${p.priorPeriodLabel}`);
  } else {
    segs.push('No prior year data');
  }
  if (p.absoluteChange != null) {
    segs.push(`abs ${signed(p.absoluteChange)} eyes`);
  }
  segs.push(`trend ${p.trendSymbolAscii || p.arrow}`);
  return segs.join(' | ');
}

function renderSWOT(doc, analysis) {
  sectionTitle(doc, 'SWOT Analysis');

  const swot = analysis.swot;
  // Render in priority order: Zero Referrals, Strengths, Threats, Weaknesses, Opportunities
  const sections = [
    { label: 'Zero Referrals This Month', color: COLORS.zero, items: swot.zeroReferrals || [] },
    { label: 'Strengths (Surging)', color: COLORS.strength, items: swot.strengths || [] },
    { label: 'Threats (Material Decline)', color: COLORS.threat, items: swot.threats || [] },
    { label: 'Weaknesses (Softening)', color: COLORS.weakness, items: swot.weaknesses || [] },
    { label: 'Opportunities (Emerging)', color: COLORS.opportunity, items: swot.opportunities || [] },
  ];

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  sections.forEach((q) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
    const x = doc.page.margins.left;
    const y = doc.y;

    doc.save();
    doc.rect(x, y, pageWidth, 16).fill(q.color);
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`${q.label} (${q.items.length})`, x + 8, y + 3, {
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
        .text(`${p.provider}  ${p.trendSymbolAscii || p.arrow}`, x + 8);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(providerLine(p), x + 8);
      doc.moveDown(0.15);
    });
    doc.moveDown(0.4);
  });
}

function renderActionReport(doc, analysis) {
  if (doc.y > doc.page.height - 200) doc.addPage();
  sectionTitle(doc, 'Monthly Action Report');

  const lists = [
    { title: 'Call List (Threats -- personal visit or call this week)', color: COLORS.threat, items: analysis.action.callList },
    { title: 'Zero Referrals List (reach out personally)', color: COLORS.zero, items: analysis.action.zeroList || [] },
    { title: 'Watch List (Weaknesses -- monitor next month)', color: COLORS.weakness, items: analysis.action.watchList },
    { title: 'Welcome List (Opportunities -- reach out and encourage)', color: COLORS.opportunity, items: analysis.action.welcomeList },
    { title: 'Thank List (Strengths -- keep the relationship warm)', color: COLORS.strength, items: analysis.action.thankList },
  ];

  lists.forEach((list) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();

    doc
      .font('Helvetica-Bold')
      .fillColor(list.color)
      .fontSize(11)
      .text(list.title);

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
          .text(`${p.provider}  ${p.trendSymbolAscii || p.arrow}`);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text(providerLine(p));
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
