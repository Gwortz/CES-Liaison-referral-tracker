import { Router } from 'express';
import { listUsers, createUser, deleteUser } from '../lib/storage.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json(listUsers());
});

router.post('/', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const user = await createUser({ username, password, role });
    res.status(201).json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete yourself' });
  }
  try {
    deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

export default router;
