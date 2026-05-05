import { useState, useEffect, useRef } from 'react';
import { toast, Toaster } from 'sonner';
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
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('wms_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('wms_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const [user, setUser]           = useState<User | null>(null);
  const [packages, setPackages]   = useState<Package[]>([]);
  const [pkgTotal, setPkgTotal]   = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pastOffset, setPastOffset] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ id: number; type: string; value: string; reason: string }[]>([]);
  const [undoPending, setUndoPending] = useState<UndoPending | null>(null);
  const [reportUndoPending, setReportUndoPending] = useState<{ pkg: Package } | null>(null);
  const undoRef       = useRef<UndoPending | null>(null);
  const reportUndoRef = useRef<{ pkg: Package } | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { undoRef.current = undoPending; }, [undoPending]);
  useEffect(() => { reportUndoRef.current = reportUndoPending; }, [reportUndoPending]);

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
      if (u) {
        if (!u.last_sync) {
          const local = parseInt(localStorage.getItem('wms_last_sync') ?? '0');
          if (local) u.last_sync = local;
        }
        setUser(u); await loadPackages(); await loadBlocks();
      }
    } catch { /* network error */ }
    setLoading(false);
  }

  async function loadBlocks() {
    try {
      const res = await authFetch('/api/blocks');
      if (res.ok) setBlocks(await res.json());
    } catch { /* network error */ }
  }

  async function loadPastOrders() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await authFetch(`/api/packages?limit=10&offset=${pastOffset}&stage_min=5`);
      if (res.ok) {
        const data = await res.json();
        setPackages(prev => [...prev, ...data.packages]);
        setPastOffset(prev => prev + data.packages.length);
      }
    } catch {}
    setLoadingMore(false);
  }

  async function loadPackages() {
    try {
      const res = await authFetch('/api/packages?limit=200&offset=0');
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages);
        setPkgTotal(data.total);
      }
    } catch { /* network error */ }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true); setSyncError(null);
    const tzOffsetMin = new Date().getTimezoneOffset();

    // Poll packages during sync so past orders appear as they're found
    const poll = setInterval(async () => {
      try {
      const r = await authFetch('/api/packages?limit=20&offset=0');
      if (r.ok) {
          const d = await r.json();
          setPackages(d.packages);
          setPkgTotal(d.total ?? d.packages.length);
        }
      } catch {}
    }, 3000);

    try {
      const res = await authFetch('/api/sync', { method: 'POST', body: JSON.stringify({ tzOffsetMin }) });
      if (!res.ok) {
        const data = await res.json();
        setSyncError(data.error || 'Sync failed');
      }
    } catch { setSyncError('Network error. Check your connection.'); }

    clearInterval(poll);
    setSyncing(false);

    // Final refresh to get complete picture
    try {
      const r = await authFetch('/api/packages?limit=200&offset=0');
      if (r.ok) {
        const d = await r.json();
        setPackages(d.packages);
        setPkgTotal(d.total ?? d.packages.length);
      }
    } catch {}
    const now = Date.now();
    localStorage.setItem('wms_last_sync', String(now));
    setUser(u => u ? { ...u, last_sync: now } : u);
  }

  async function handleReport(id: number) {
    const pkg = packages.find(p => p.id === id);
    if (!pkg) return;
    setPackages(prev => prev.filter(p => p.id !== id));
    setReportUndoPending({ pkg });
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);

    toast('Removed from list', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
          const pending = reportUndoRef.current;
          if (pending) {
            setReportUndoPending(null);
            setPackages(prev => [...prev, pending.pkg].sort((a, b) => b.received_date - a.received_date));
          }
        },
      },
    });

    reportTimerRef.current = setTimeout(async () => {
      setReportUndoPending(null);
      try {
        const res = await authFetch(`/api/packages/${id}/report`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          await loadBlocks();
          toast(data.learnedLabel, {
            description: data.reason,
            duration: 8000,
            action: data.blockIds?.length ? {
              label: 'Undo',
              onClick: async () => {
                await Promise.all((data.blockIds as number[]).map((bid: number) =>
                  authFetch(`/api/blocks/${bid}`, { method: 'DELETE' })
                ));
                await loadBlocks();
                toast('Block removed');
              },
            } : undefined,
          });
        }
      } catch { /* network error */ }
    }, 5000);
  }

  async function handleResync(id: number) {
    const tzOffsetMin = new Date().getTimezoneOffset();
    try {
      const res = await authFetch(`/api/packages/${id}/resync`, { method: 'POST', body: JSON.stringify({ tzOffsetMin }) });
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
    const ORDER_BLACKLIST = /^(number|no|id|update|summary|details|status|confirmation|confirmed|regular|express|placed|received|accepted|cancelled|canceled)$/i;
    const validOrder = pkg.order_number && !ORDER_BLACKLIST.test(pkg.order_number) ? pkg.order_number : null;
    const relatedIds = packages
      .filter(p => p.id === id
        || (validOrder && p.order_number === validOrder)
        || (pkg.tracking_number && p.tracking_number === pkg.tracking_number))
      .map(p => p.id);
    const now = Math.floor(Date.now() / 1000);
    setPackages(prev => prev.map(p =>
      relatedIds.includes(p.id) ? { ...p, stage: 5, status: 'Delivered', updated_at: now } : p
    ));
    await authFetch(`/api/packages/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 5 }),
    });
    const pending = { id, prevStage, prevStatus, relatedIds };
    setUndoPending(pending);

    toast('Marked as delivered', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const p = undoRef.current;
          if (!p) return;
          setUndoPending(null);
          setPackages(prev => prev.map(pkg =>
            p.relatedIds.includes(pkg.id) ? { ...pkg, stage: p.prevStage, status: p.prevStatus } : pkg
          ));
          await authFetch(`/api/packages/${p.id}/stage`, {
            method: 'PATCH',
            body: JSON.stringify({ stage: p.prevStage }),
          });
        },
      },
    });
  }

  function handleCleanse() {
    const timer = setTimeout(async () => {
      await authFetch('/api/cleanse', { method: 'POST' });
      setPackages([]); setPkgTotal(0);
      localStorage.removeItem('wms_last_sync');
      setUser(u => u ? { ...u, last_sync: 0 } : u);
      await handleSync();
    }, 5000);
    toast('Resetting all data…', {
      duration: 5000,
      action: { label: 'Undo', onClick: () => clearTimeout(timer) },
    });
  }

  async function handleMoveToActive(id: number) {
    const pkg = packages.find(p => p.id === id);
    if (!pkg) return;
    const ORDER_BLACKLIST = /^(number|no|id|update|summary|details|status|confirmation|confirmed|regular|express|placed|received|accepted|cancelled|canceled)$/i;
    const validOrder = pkg.order_number && !ORDER_BLACKLIST.test(pkg.order_number) ? pkg.order_number : null;
    const relatedIds = packages
      .filter(p => p.id === id
        || (validOrder && p.order_number === validOrder)
        || (pkg.tracking_number && p.tracking_number === pkg.tracking_number)
        || (pkg.thread_id && p.thread_id === pkg.thread_id))
      .map(p => p.id);
    const res = await authFetch(`/api/packages/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 0 }),
    });
    if (res.ok) setPackages(prev => prev.map(p => relatedIds.includes(p.id) ? { ...p, stage: 0, status: 'Ordered' } : p));
  }

  async function handleDeleteBlock(id: number) {
    await authFetch(`/api/blocks/${id}`, { method: 'DELETE' });
    setBlocks(prev => prev.filter(b => b.id !== id));
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
      <Toaster position="bottom-center" richColors closeButton />
      {!user
        ? <LoginScreen authError={authError} />
        : <Dashboard user={user} packages={packages} pkgTotal={pkgTotal} loadingMore={loadingMore} syncing={syncing} syncError={syncError} onSync={handleSync} onCleanse={handleCleanse} onLoadPast={loadPastOrders} onLogout={handleLogout} onMarkDelivered={handleMarkDelivered} onResync={handleResync} onReport={handleReport} onMoveToActive={handleMoveToActive} theme={theme} onToggleTheme={toggleTheme} blocks={blocks} onDeleteBlock={handleDeleteBlock} />
      }
    </>
  );
}
