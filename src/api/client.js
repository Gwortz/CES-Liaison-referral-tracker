const TOKEN_KEY = 'ces_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, headers = {}, isForm = false } = {}) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
  if (body !== undefined) opts.body = isForm ? body : JSON.stringify(body);

  const res = await fetch(path, opts);
  if (res.status === 401) {
    setToken(null);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res;
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request('/api/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  listUsers: () => request('/api/users'),
  createUser: (username, password, role) =>
    request('/api/users', { method: 'POST', body: { username, password, role } }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE' }),
  analyze: (market, file) => {
    const form = new FormData();
    form.append('market', market);
    form.append('file', file);
    return request('/api/reports/analyze', { method: 'POST', body: form, isForm: true });
  },
  downloadPdf: async (market, analysis) => {
    const token = getToken();
    const res = await fetch('/api/reports/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ market, analysis }),
    });
    if (!res.ok) throw new Error('Failed to generate PDF');
    return res.blob();
  },
};
