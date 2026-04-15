import { RefreshCw, LogOut, Package2 } from 'lucide-react';
import type { User } from '../types';

interface Props {
  user: User;
  syncing: boolean;
  onSync: () => void;
  onLogout: () => void;
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

export default function Header({ user, syncing, onSync, onLogout }: Props) {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200" role="banner">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-center">
            <Package2 className="w-3.5 h-3.5 text-indigo-600" strokeWidth={2} />
          </div>
          <span className="font-bold text-sm text-gray-900 tracking-tight hidden sm:block">
            Where's My Stuff?
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 hidden md:block">{relativeTime(user.last_sync)}</span>

          <button
            onClick={onSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={syncing ? 'Syncing…' : 'Sync Gmail'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            {syncing ? 'Syncing…' : 'Sync'}
          </button>

          {user.picture
            ? <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full border border-gray-200" />
            : <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-600">{user.name?.[0]?.toUpperCase()}</div>
          }

          <button
            onClick={onLogout}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
