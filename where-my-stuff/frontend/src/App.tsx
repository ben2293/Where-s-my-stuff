import { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import type { User, Package } from './types';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export default function App() {
  const [user, setUser]         = useState<User | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      setAuthError(err === 'auth_failed' ? 'Authentication failed. Please try again.' : `Error: ${err}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
      const { user: u } = await res.json();
      if (u) { setUser(u); await loadPackages(); }
    } catch { /* network error */ }
    setLoading(false);
  }

  async function loadPackages() {
    try {
      const res = await fetch(`${API}/api/packages`, { credentials: 'include' });
      if (res.ok) setPackages(await res.json());
    } catch { /* network error */ }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true); setSyncError(null);
    try {
      const res = await fetch(`${API}/api/sync`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) setSyncError(data.error || 'Sync failed');
      else { setPackages(data.packages); setUser(u => u ? { ...u, last_sync: Date.now() } : u); }
    } catch { setSyncError('Network error. Check your connection.'); }
    setSyncing(false);
  }

  async function handleMarkDelivered(id: number) {
    const pkg = packages.find(p => p.id === id);
    await fetch(`/api/packages/${id}/stage`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 5 }),
    });
    // Mark all sibling emails for the same order (same order_number or tracking_number)
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
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null); setPackages([]);
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return !user
    ? <LoginScreen authError={authError} />
    : <Dashboard user={user} packages={packages} syncing={syncing} syncError={syncError} onSync={handleSync} onLogout={handleLogout} onMarkDelivered={handleMarkDelivered} />;
}
