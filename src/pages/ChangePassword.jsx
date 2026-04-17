import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function ChangePassword() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (next.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Change your password</h1>
        <p className="text-sm text-slate-600 mb-6">
          You must set a new password before continuing.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Current password" value={current} onChange={setCurrent} />
          <Field label="New password" value={next} onChange={setNext} />
          <Field label="Confirm new password" value={confirm} onChange={setConfirm} />
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-sky-700 hover:bg-sky-800 disabled:bg-sky-400 text-white font-medium rounded-lg py-2 transition"
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="password"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  );
}
