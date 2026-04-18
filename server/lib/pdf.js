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

/**
 * Generates a PDF and returns a Promise<Buffer>.
 */
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
    .text(s.overallTrend, { align: 'left' });

  doc.moveDown(1);
}

function renderSWOT(doc, analysis) {
  sectionTitle(doc, 'SWOT Analysis');

  const swot = analysis.swot;
  const quadrants = [
    { label: 'Strengths', color: COLORS.strength, items: swot.strengths },
    { label: 'Weaknesses', color: COLORS.weakness, items: swot.weaknesses },
    { label: 'Opportunities', color: COLORS.opportunity, items: swot.opportunities },
    { label: 'Threats', color: COLORS.threat, items: swot.threats },
  ];

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = (pageWidth - 10) / 2;
  const startY = doc.y;
  let leftY = startY;
  let rightY = startY;

  quadrants.forEach((q, i) => {
    const isLeft = i % 2 === 0;
    const x = isLeft ? doc.page.margins.left : doc.page.margins.left + colWidth + 10;
    const y = isLeft ? leftY : rightY;

    doc.save();
    doc.rect(x, y, colWidth, 14).fill(q.color);
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(`${q.label} (${q.items.length})`, x + 6, y + 2, {
        width: colWidth - 12,
      });
    doc.restore();

    let cursor = y + 18;
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(9);

    if (!q.items.length) {
      doc.fillColor(COLORS.muted).text('None this month.', x + 6, cursor, {
        width: colWidth - 12,
      });
      cursor += 14;
    } else {
      q.items.forEach((p) => {
        if (cursor > doc.page.height - doc.page.margins.bottom - 40) {
          doc.addPage();
          cursor = doc.page.margins.top;
        }
        doc
          .font('Helvetica-Bold')
          .fillColor(COLORS.text)
          .fontSize(10)
          .text(`${p.provider} ${p.arrow}`, x + 6, cursor, { width: colWidth - 12 });
        cursor = doc.y;

        const line = `3mo avg ${avg(p.last3Avg)} | prior-yr avg ${avg(
          p.priorAvg
        )} | ${pct(p.pctChange)} | ${p.direction}`;
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor(COLORS.muted)
          .text(line, x + 6, cursor, { width: colWidth - 12 });
        cursor = doc.y + 4;
      });
    }

    if (isLeft) leftY = cursor + 10;
    else rightY = cursor + 10;
  });

  doc.y = Math.max(leftY, rightY);
  doc.moveDown(0.5);
}

function renderActionReport(doc, analysis) {
  if (doc.y > doc.page.height - 200) doc.addPage();
  sectionTitle(doc, 'Monthly Action Report');

  const lists = [
    { title: 'Thank List (Strengths -- keep the relationship)', color: COLORS.strength, items: analysis.action.thankList },
    { title: 'Watch List (Weaknesses -- monitor next month)', color: COLORS.weakness, items: analysis.action.watchList },
    { title: 'Call List (Threats -- personal visit or call)', color: COLORS.threat, items: analysis.action.callList },
    { title: 'Welcome List (Opportunities -- reach out and encourage)', color: COLORS.opportunity, items: analysis.action.welcomeList },
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
          .text(`${p.provider} ${p.arrow}`);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text(
            `3mo avg ${avg(p.last3Avg)} | total ${whole(
              p.totalEyes
            )} eyes | ${pct(p.pctChange)}`
          );
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
