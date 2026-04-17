import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// On Vercel, filesystem is read-only except /tmp. In local dev, persist to repo.
const IS_VERCEL = !!process.env.VERCEL;
const REPO_USERS = path.join(__dirname, '..', 'data', 'users.json');
const TMP_USERS = '/tmp/users.json';
const USERS_FILE = IS_VERCEL ? TMP_USERS : REPO_USERS;

function ensureStore() {
  // Seed /tmp from the committed data file on Vercel cold start
  if (IS_VERCEL && !fs.existsSync(TMP_USERS)) {
    if (fs.existsSync(REPO_USERS)) {
      fs.copyFileSync(REPO_USERS, TMP_USERS);
    } else {
      fs.writeFileSync(TMP_USERS, JSON.stringify({ users: [] }, null, 2));
    }
  }
  if (!IS_VERCEL && !fs.existsSync(REPO_USERS)) {
    fs.mkdirSync(path.dirname(REPO_USERS), { recursive: true });
    fs.writeFileSync(REPO_USERS, JSON.stringify({ users: [] }, null, 2));
  }
}

function readUsers() {
  ensureStore();
  const raw = fs.readFileSync(USERS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeUsers(data) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

export async function seedDefaultAdmin() {
  const data = readUsers();
  if (data.users.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    data.users.push({
      id: 'admin-1',
      username: 'admin',
      passwordHash: hash,
      role: 'admin',
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    });
    writeUsers(data);
  }
}

export function findByUsername(username) {
  const data = readUsers();
  return data.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
}

export function findById(id) {
  const data = readUsers();
  return data.users.find((u) => u.id === id);
}

export function listUsers() {
  const data = readUsers();
  return data.users.map(({ passwordHash, ...rest }) => rest);
}

export async function createUser({ username, password, role }) {
  const data = readUsers();
  if (
    data.users.some(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    )
  ) {
    throw new Error('Username already exists');
  }
  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    passwordHash: hash,
    role: role === 'admin' ? 'admin' : 'user',
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  writeUsers(data);
  const { passwordHash, ...safe } = user;
  return safe;
}

export function deleteUser(id) {
  const data = readUsers();
  const before = data.users.length;
  data.users = data.users.filter((u) => u.id !== id);
  if (data.users.length === before) throw new Error('User not found');
  writeUsers(data);
}

export async function updatePassword(id, newPassword) {
  const data = readUsers();
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new Error('User not found');
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  writeUsers(data);
}
