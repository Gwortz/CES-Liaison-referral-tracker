import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/dashboard" className="flex flex-col">
            <span className="text-base font-semibold text-slate-800 leading-tight">
              Commonwealth Eye Surgery
            </span>
            <span className="text-xs text-sky-700 font-medium">
              Liaison Referral Tracker
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavItem to="/dashboard">Dashboard</NavItem>
            {user?.role === 'admin' && <NavItem to="/admin">Admin</NavItem>}
            <span className="text-slate-400 mx-2 hidden sm:inline">|</span>
            <span className="hidden sm:inline text-slate-600">{user?.username}</span>
            <button
              onClick={onLogout}
              className="ml-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-md px-2 py-1"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md ${
          isActive
            ? 'bg-sky-50 text-sky-800 font-medium'
            : 'text-slate-700 hover:bg-slate-100'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
