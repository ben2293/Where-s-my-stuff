import { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import type { User, Package } from './types';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const TOKEN_KEY = 'wms_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function authFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

export default function App() {
  const [user, setUser]           = useState<User | null>(null);
  const [packages, setPackages]   = useState<Package[]>([]);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const err   = params.get('error');

    if (token) {
      setToken(token);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (err) {
      setAuthError(err === 'auth_failed' ? 'Authentication failed. Please try again.' : `Error: ${err}`);
      window.history.replaceState({}, '', window.location.pathname);
    }

    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await authFetch('/auth/me');
      const { user: u } = await res.json();
      if (u) { setUser(u); await loadPackages(); }
    } catch { /* network error */ }
    setLoading(false);
  }

  async function loadPackages() {
    try {
      const res = await authFetch('/api/packages');
      if (res.ok) setPackages(await res.json());
    } catch { /* network error */ }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true); setSyncError(null);
    try {
      const res = await authFetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setSyncError(data.error || 'Sync failed');
      else { setPackages(data.packages); setUser(u => u ? { ...u, last_sync: Date.now() } : u); }
    } catch { setSyncError('Network error. Check your connection.'); }
    setSyncing(false);
  }

  async function handleResync(id: number) {
    try {
      const res = await authFetch(`/api/packages/${id}/resync`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.package) {
        setPackages(prev => prev.map(p => p.id === id ? data.package : p));
      }
    } catch { /* network error */ }
  }

  async function handleMarkDelivered(id: number) {
    const pkg = packages.find(p => p.id === id);
    await authFetch(`/api/packages/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 5 }),
    });
    const now = Math.floor(Date.now() / 1000);
    setPackages(prev => prev.map(p =>
      p.id === id
      || (pkg?.order_number && p.order_number === pkg.order_number)
      || (pkg?.tracking_number && p.tracking_number === pkg.tracking_number)
        ? { ...p, stage: 5, status: 'Delivered', updated_at: now }
        : p
    ));
  }

  async function handleLogout() {
    await authFetch('/auth/logout', { method: 'POST' });
    clearToken();
    setUser(null); setPackages([]);
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return !user
    ? <LoginScreen authError={authError} />
    : <Dashboard user={user} packages={packages} syncing={syncing} syncError={syncError} onSync={handleSync} onLogout={handleLogout} onMarkDelivered={handleMarkDelivered} onResync={handleResync} />;
}
