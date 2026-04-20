import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../lib/auth.js';
import { parseWorkbook, coalesceEntries } from '../lib/excel.js';
import { analyze } from '../lib/analysis.js';
import { generateReport } from '../lib/pdf.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Markets are labeled East / West in the UI. The master spreadsheet stores
// each referrer's market in a "Territory" column as EAST / WEST, so we map
// the user-facing label to that territory value.
const MARKETS = ['East', 'West'];
const MARKET_TO_TERRITORY = { East: 'EAST', West: 'WEST' };

router.post('/analyze', requireAuth, upload.single('file'), (req, res) => {
  try {
    const market = req.body.market;
    if (!MARKETS.includes(market)) {
      return res.status(400).json({ error: 'Invalid market' });
    }
    if (!req.file) return res.status(400).json({ error: 'Excel file required' });
    const territory = MARKET_TO_TERRITORY[market];
    const entries = coalesceEntries(
      parseWorkbook(req.file.buffer, { territory })
    );
    if (!entries.length) {
      return res.status(400).json({
        error:
          'No valid entries found for the selected market. Make sure the workbook has the East/West Territory column, or that month headers include month + year.',
      });
    }
    const result = analyze(entries);
    res.json({ market, analysis: result, entryCount: entries.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed to analyze file' });
  }
});

router.post('/pdf', requireAuth, async (req, res) => {
  try {
    const { market, analysis } = req.body || {};
    if (!MARKETS.includes(market)) {
      return res.status(400).json({ error: 'Invalid market' });
    }
    if (!analysis || analysis.empty) {
      return res.status(400).json({ error: 'Analysis payload required' });
    }
    const buffer = await generateReport({ market, analysis });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="CES_${market}_${analysis.reportMonth.year}-${String(
        analysis.reportMonth.month
      ).padStart(2, '0')}_Report.pdf"`
    );
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed to generate PDF' });
  }
});

export default router;
