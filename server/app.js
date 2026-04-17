import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import reportsRoutes from './routes/reports.js';
import { seedDefaultAdmin } from './lib/storage.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let seeded = false;
app.use(async (req, res, next) => {
  if (!seeded) {
    try {
      await seedDefaultAdmin();
      seeded = true;
    } catch (e) {
      console.error('seed error', e);
    }
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/reports', reportsRoutes);

export default app;
