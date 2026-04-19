import { RefreshCw, LogOut, Package2, Sun, Moon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import type { User } from '../types';

const SYNC_VERBS = [
  'Sniffing…', 'Burrowing…', 'Ingesting…', 'Thinking…', 'Parsing…',
  'Snooping…', 'Untangling…', 'Decoding…', 'Fetching…', 'Brewing…',
  'Digging…', 'Scanning…', 'Crunching…', 'Sleuthing…', 'Mapping…',
];

export function SyncLabel({ syncing }: { syncing: boolean }) {
  const [idx, setIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (!syncing) { setIdx(0); return; }
    const t = setInterval(() => {
      setIdx(i => (i + 1) % SYNC_VERBS.length);
      setAnimKey(k => k + 1);
    }, 1400);
    return () => clearInterval(t);
  }, [syncing]);

  if (!syncing) return <span>Sync</span>;

  return (
    <span className="inline-block overflow-hidden h-[1.1em] align-middle" style={{ minWidth: '7rem' }}>
      <span
        key={animKey}
        className="inline-block"
        style={{ animation: 'tickerUp 0.35s cubic-bezier(0.4,0,0.2,1) both' }}
      >
        {SYNC_VERBS[idx]}
      </span>
      <style>{`
        @keyframes tickerUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </span>
  );
}

interface Props {
  user: User;
  syncing: boolean;
  hasPackages: boolean;
  onSync: () => void;
  onCleanse: () => void;
  onLogout: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

function relativeTime(ts: number): string {
  if (!ts) return 'Never synced';
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'Just synced';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Header({ user, syncing, hasPackages, onSync, onCleanse, onLogout, theme, onToggleTheme }: Props) {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur border-b border-border" role="banner">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center border border-border">
            <Package2 className="w-3.5 h-3.5 text-foreground" strokeWidth={2} />
          </div>
          <span className="font-bold text-sm tracking-tight hidden sm:block">
            Where's My Stuff?
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden md:block">{relativeTime(user.last_sync)}</span>

          <Button
            variant="secondary"
            size="sm"
            onClick={onSync}
            disabled={syncing}
            aria-label={syncing ? 'Syncing…' : 'Sync Gmail'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            {hasPackages ? <SyncLabel syncing={syncing} /> : <span>{syncing ? 'Syncing…' : 'Sync'}</span>}
          </Button>

          {user.picture
            ? <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full border border-border" />
            : <div className="w-7 h-7 bg-secondary rounded-full flex items-center justify-center text-xs font-bold">{user.name?.[0]?.toUpperCase()}</div>
          }

          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="w-8 h-8 text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark'
              ? <Sun className="w-3.5 h-3.5" aria-hidden />
              : <Moon className="w-3.5 h-3.5" aria-hidden />
            }
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onCleanse}
            aria-label="Reset data"
            className="w-8 h-8 text-muted-foreground hover:text-red-400 hover:bg-red-950"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            aria-label="Sign out"
            className="w-8 h-8 text-muted-foreground hover:text-red-400 hover:bg-red-950"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}
