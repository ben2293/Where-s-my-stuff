import { useState, useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
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

interface UndoPending {
  id: number;
  prevStage: number;
  prevStatus: string;
  relatedIds: number[];
}

export default function App() {
  const [user, setUser]           = useState<User | null>(null);
  const [packages, setPackages]   = useState<Package[]>([]);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [undoPending, setUndoPending] = useState<UndoPending | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const err   = params.get('error');
    if (token) { setToken(token); window.history.replaceState({}, '', window.location.pathname); }
    if (err)   { setAuthError(err === 'auth_failed' ? 'Authentication failed. Please try again.' : `Error: ${err}`); window.history.replaceState({}, '', window.location.pathname); }
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
    if (!pkg) return;

    const prevStage  = pkg.stage;
    const prevStatus = pkg.status;

    // Find related package IDs (same order or tracking) for bulk update
    const relatedIds = packages
      .filter(p => p.id === id
        || (pkg.order_number   && p.order_number   === pkg.order_number)
        || (pkg.tracking_number && p.tracking_number === pkg.tracking_number))
      .map(p => p.id);

    // Optimistic update
    const now = Math.floor(Date.now() / 1000);
    setPackages(prev => prev.map(p =>
      relatedIds.includes(p.id) ? { ...p, stage: 5, status: 'Delivered', updated_at: now } : p
    ));

    await authFetch(`/api/packages/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 5 }),
    });

    // Clear previous undo timer
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    setUndoPending({ id, prevStage, prevStatus, relatedIds });
    undoTimerRef.current = setTimeout(() => setUndoPending(null), 5000);
  }

  async function handleUndo() {
    if (!undoPending) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const { id, prevStage, prevStatus, relatedIds } = undoPending;
    setUndoPending(null);

    setPackages(prev => prev.map(p =>
      relatedIds.includes(p.id) ? { ...p, stage: prevStage, status: prevStatus } : p
    ));

    await authFetch(`/api/packages/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: prevStage }),
    });
  }

  async function handleLogout() {
    await authFetch('/auth/logout', { method: 'POST' });
    clearToken();
    setUser(null); setPackages([]);
  }

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
    </div>
  );

  return (
    <>
      {!user
        ? <LoginScreen authError={authError} />
        : <Dashboard user={user} packages={packages} syncing={syncing} syncError={syncError} onSync={handleSync} onLogout={handleLogout} onMarkDelivered={handleMarkDelivered} onResync={handleResync} />
      }

      {/* Undo toast */}
      {undoPending && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-up">
          <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 shadow-2xl">
            <div className="w-5 h-5 rounded-full bg-green-900 flex items-center justify-center flex-shrink-0">
              <Check className="w-3 h-3 text-green-400" />
            </div>
            <span className="text-sm text-foreground">Marked as delivered</span>
            <div className="w-px h-4 bg-border" />
            <button
              onClick={handleUndo}
              className="text-sm font-semibold text-foreground hover:text-muted-foreground transition-colors"
            >
              Undo
            </button>
            <button
              onClick={() => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); setUndoPending(null); }}
              className="text-muted-foreground hover:text-foreground transition-colors ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
