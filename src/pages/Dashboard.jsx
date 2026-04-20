import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const MARKETS = ['East', 'West'];

export default function Dashboard() {
  const navigate = useNavigate();
  const [market, setMarket] = useState('East');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onAnalyze(e) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('Please select an Excel file.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.analyze(market, file);
      // Stash in sessionStorage for the preview page (no server persistence)
      sessionStorage.setItem('ces_last_report', JSON.stringify(res));
      navigate('/report');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Generate a report</h1>
      <p className="text-slate-600 mb-6">
        Upload a monthly Excel file for the selected market. Data is analyzed in memory and is
        not stored on the server.
      </p>

      <form
        onSubmit={onAnalyze}
        className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Market</label>
          <div className="grid grid-cols-2 gap-2">
            {MARKETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarket(m)}
                className={`rounded-lg border px-4 py-3 font-medium transition ${
                  market === m
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Excel file (.xlsx)
          </label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-700
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-medium
              file:bg-sky-50 file:text-sky-700
              hover:file:bg-sky-100"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full sm:w-auto bg-sky-700 hover:bg-sky-800 disabled:bg-sky-400 text-white font-medium rounded-lg py-2 px-5 transition"
        >
          {busy ? 'Analyzing…' : 'Generate report'}
        </button>
      </form>
    </div>
  );
}
